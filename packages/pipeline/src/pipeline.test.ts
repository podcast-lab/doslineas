import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryAlertStore } from "./alerts.js";
import { FolderDelivery, RECEIPT_FILE } from "./delivery.js";
import type { Job } from "./jobs.js";
import { SessionPipeline } from "./pipeline.js";
import type { StepLogger, StepRunner } from "./runner.js";
import { SqliteJobQueue } from "./sqlite-queue.js";
import { plannedJobs, stepDefinition } from "./steps.js";

class RecordingRunner implements StepRunner {
  readonly ran: string[] = [];
  readonly failures = new Map<string, string>();
  readonly contents = new Map<string, string>();

  constructor(private readonly directory: string) {}

  async run(job: Job, log: StepLogger): Promise<void> {
    this.ran.push(job.step);
    const failure = this.failures.get(job.step);
    if (failure !== undefined) throw new Error(failure);

    log(`pretending to run ${job.step}`);
    for (const artifact of stepDefinition(job.step).produces) {
      const body = this.contents.get(artifact) ?? `${artifact} of ${job.session}`;
      await writeFile(join(this.directory, artifact), body, "utf8");
    }
  }
}

function edl(input4Role: "screen" | "guest3"): unknown {
  return {
    version: 1,
    session: "ep12",
    fps: 25,
    profile: "podcast-v1",
    sources: [
      { input: 1, role: "wide", video: "iso1.mp4", audio: "program.mp4", durationSeconds: 60 },
      { input: 2, role: "speaker1", video: "iso2.mp4", audio: null, durationSeconds: 60 },
      { input: 3, role: "speaker2", video: "iso3.mp4", audio: null, durationSeconds: 60 },
      { input: 4, role: input4Role, video: "iso4.mp4", audio: null, durationSeconds: 60 }
    ],
    segments: [{ tOut: 0, dur: 60, input: 1, tIn: 0, reason: "initial" }],
    discards: [],
    audio: { source: "program", gains: {} }
  };
}

describe("SessionPipeline", () => {
  let root: string;
  let directory: string;
  let deliveryRoot: string;
  let queue: SqliteJobQueue;
  let alerts: MemoryAlertStore;
  let runner: RecordingRunner;
  let pipeline: SessionPipeline;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-pipeline-"));
    directory = join(root, "ep12");
    deliveryRoot = join(root, "delivered");
    await mkdir(directory, { recursive: true });

    queue = new SqliteJobQueue(":memory:");
    alerts = new MemoryAlertStore();
    runner = new RecordingRunner(directory);
    pipeline = new SessionPipeline(queue, runner, new FolderDelivery({ root: deliveryRoot }), alerts, {
      owner: "worker-test",
      leaseMs: 60_000,
      heartbeatMs: 30_000
    });

    runner.contents.set("edl.json", JSON.stringify(edl("screen")));
    queue.enqueue(plannedJobs("doslineas", "ep12", directory, 2));
  });

  afterEach(async () => {
    queue.close();
    await rm(root, { recursive: true, force: true });
  });

  async function drain(): Promise<string[]> {
    const outcomes: string[] = [];
    for (let step = 0; step < 20; step += 1) {
      const processed = await pipeline.processNext();
      if (processed === null) break;
      outcomes.push(`${processed.job.step}:${processed.outcome}`);
    }
    return outcomes;
  }

  it("walks a session from edit to delivery", async () => {
    const outcomes = await drain();

    expect(outcomes).toEqual([
      "edit:done",
      "brand:done",
      "transcribe:done",
      "captions:done",
      "clips:done",
      "explainer:done",
      "deliver:done"
    ]);
    expect(queue.session("doslineas", "ep12")?.state).toBe("delivered");
  });

  it("skips the explainer when input 4 carries a third guest", async () => {
    runner.contents.set("edl.json", JSON.stringify(edl("guest3")));
    const outcomes = await drain();

    expect(outcomes).toContain("explainer:skipped");
    expect(runner.ran).not.toContain("explainer");
    expect(queue.jobs({ session: "ep12" }).find((job) => job.step === "explainer")?.note).toContain("third guest");
  });

  it("does not redo a step whose output is already there", async () => {
    await writeFile(join(directory, "edl.json"), JSON.stringify(edl("screen")), "utf8");
    await writeFile(join(directory, "edit.fcpxml"), "already", "utf8");
    await writeFile(join(directory, "master.mp4"), "already", "utf8");

    const first = await pipeline.processNext();

    expect(first?.outcome).toBe("fresh");
    expect(runner.ran).not.toContain("edit");
  });

  it("redoes a step when its input is newer than its output", async () => {
    for (const artifact of ["brand-plan.json", "master-branded.mp4"]) {
      await writeFile(join(directory, artifact), `old ${artifact}`, "utf8");
      await utimes(join(directory, artifact), new Date(2026, 0, 1), new Date(2026, 0, 1));
    }
    await writeFile(join(directory, "edl.json"), JSON.stringify(edl("screen")), "utf8");
    await writeFile(join(directory, "edit.fcpxml"), "fresh", "utf8");
    await writeFile(join(directory, "master.mp4"), "fresh", "utf8");

    const edit = await pipeline.processNext();
    expect(edit?.outcome).toBe("fresh");

    const brand = await pipeline.processNext();
    expect(brand?.outcome).toBe("done");
    expect(runner.ran).toContain("brand");
  });

  it("retries a failing step and gives up with an alert", async () => {
    runner.failures.set("edit", "ffmpeg exited with code 1");

    const first = await pipeline.processNext();
    expect(first?.outcome).toBe("failed");
    expect(first?.job.state).toBe("pending");
    expect(alerts.list()).toHaveLength(0);

    const second = await pipeline.processNext();
    expect(second?.job.state).toBe("failed");
    expect(alerts.list({ pending: true }).map((alert) => alert.kind)).toContain("step-failed");

    expect(await pipeline.processNext()).toBeNull();
  });

  it("a failed step stops the ones behind it", async () => {
    runner.failures.set("brand", "remotion could not start");

    await drain();
    const session = queue.session("doslineas", "ep12");

    expect(session?.state).toBe("failed");
    expect(session?.steps.filter((step) => step.state === "pending")).toHaveLength(5);
    expect(runner.ran).not.toContain("clips");
  });

  it("writes a receipt and raises the alert that asks for confirmation", async () => {
    await drain();

    const receipt = JSON.parse(await readFile(join(directory, RECEIPT_FILE), "utf8")) as {
      items: { kind: string; target: string }[];
      confirmedAt: string | null;
    };

    expect(receipt.confirmedAt).toBeNull();
    expect(receipt.items.some((item) => item.kind === "master")).toBe(true);
    for (const item of receipt.items) expect((await stat(item.target)).size).toBeGreaterThan(0);
    expect(alerts.list().map((alert) => alert.kind)).toContain("delivery-ready");
  });

  it("delivers the branded master and leaves the plain one out", async () => {
    runner.contents.set("edl.json", JSON.stringify(edl("guest3")));
    await drain();

    const receipt = JSON.parse(await readFile(join(directory, RECEIPT_FILE), "utf8")) as {
      items: { target: string }[];
    };
    const names = receipt.items.map((item) => item.target.split(/[\\/]/).at(-1));

    expect(names).toContain("master-branded.mp4");
    expect(names).not.toContain("master.mp4");
  });
});
