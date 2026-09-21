import { describe, expect, it } from "vitest";
import { SqliteJobQueue } from "./sqlite-queue.js";
import { plannedJobs } from "./steps.js";

function queueAt(clock: { value: number }): SqliteJobQueue {
  return new SqliteJobQueue(":memory:", { now: () => clock.value });
}

function seed(queue: SqliteJobQueue, session = "ep12"): void {
  queue.enqueue(plannedJobs("doslineas", session, `/sessions/${session}`, 3));
}

describe("SqliteJobQueue", () => {
  it("hands out the steps of a session in order", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const first = queue.lease("worker-1", 60_000);
    expect(first?.step).toBe("edit");

    expect(queue.lease("worker-2", 60_000)).toBeNull();

    queue.complete(first!.id, "worker-1");
    expect(queue.lease("worker-2", 60_000)?.step).toBe("brand");
    queue.close();
  });

  it("runs different sessions in parallel", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue, "ep12");
    seed(queue, "ep13");

    const first = queue.lease("worker-1", 60_000);
    const second = queue.lease("worker-2", 60_000);
    expect(first?.session).toBe("ep12");
    expect(second?.session).toBe("ep13");
    queue.close();
  });

  it("skipping a step lets the next one through", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const edit = queue.lease("worker-1", 60_000);
    queue.complete(edit!.id, "worker-1");
    const brand = queue.lease("worker-1", 60_000);
    queue.skip(brand!.id, "worker-1", "no brand kit");

    expect(queue.lease("worker-1", 60_000)?.step).toBe("transcribe");
    queue.close();
  });

  it("puts a failed step back until the attempts run out", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    queue.enqueue(plannedJobs("doslineas", "ep12", "/sessions/ep12", 2));

    let job = queue.lease("worker-1", 60_000)!;
    expect(queue.fail(job.id, "worker-1", "ffmpeg died").state).toBe("pending");

    job = queue.lease("worker-1", 60_000)!;
    expect(job.attempts).toBe(2);
    const exhausted = queue.fail(job.id, "worker-1", "ffmpeg died again");
    expect(exhausted.state).toBe("failed");
    expect(queue.lease("worker-1", 60_000)).toBeNull();
    queue.close();
  });

  it("reclaims a lease that expired and counts the attempt", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const job = queue.lease("worker-1", 60_000)!;
    clock.value += 60_001;

    const reclaimed = queue.reclaimExpired();
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.state).toBe("pending");
    expect(reclaimed[0]?.note).toContain("lease");

    const again = queue.lease("worker-2", 60_000);
    expect(again?.id).toBe(job.id);
    expect(again?.attempts).toBe(2);
    queue.close();
  });

  it("a heartbeat keeps the lease alive", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const job = queue.lease("worker-1", 60_000)!;
    clock.value += 50_000;
    queue.heartbeat(job.id, "worker-1", 60_000);
    clock.value += 20_000;

    expect(queue.reclaimExpired()).toHaveLength(0);
    queue.close();
  });

  it("refuses a heartbeat from a worker that no longer owns the job", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const job = queue.lease("worker-1", 60_000)!;
    expect(() => queue.heartbeat(job.id, "worker-2", 60_000)).toThrow(/no longer leased/);
    queue.close();
  });

  it("enqueueing the same session twice does not duplicate its steps", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);
    const again = queue.enqueue(plannedJobs("doslineas", "ep12", "/sessions/ep12", 3));

    expect(again).toHaveLength(7);
    expect(queue.jobs({ session: "ep12" })).toHaveLength(7);
    queue.close();
  });

  it("retry puts the failed steps of a session back in line", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    queue.enqueue(plannedJobs("doslineas", "ep12", "/sessions/ep12", 1));

    const job = queue.lease("worker-1", 60_000)!;
    queue.fail(job.id, "worker-1", "ffmpeg died");
    expect(queue.session("doslineas", "ep12")?.state).toBe("failed");

    expect(queue.retry("doslineas", "ep12")).toBe(1);
    expect(queue.lease("worker-1", 60_000)?.step).toBe("edit");
    queue.close();
  });

  it("retrying one finished step alone re-runs just that step", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);

    const edit = queue.lease("worker-1", 60_000)!;
    queue.complete(edit.id, "worker-1");
    const brand = queue.lease("worker-1", 60_000)!;
    queue.complete(brand.id, "worker-1");

    expect(queue.retry("doslineas", "ep12", "brand")).toBe(1);
    expect(queue.lease("worker-1", 60_000)?.step).toBe("brand");
    queue.close();
  });

  it("reports the state of a session from its steps", () => {
    const clock = { value: 1_000 };
    const queue = queueAt(clock);
    seed(queue);
    expect(queue.session("doslineas", "ep12")?.state).toBe("waiting");

    const job = queue.lease("worker-1", 60_000)!;
    expect(queue.session("doslineas", "ep12")?.state).toBe("running");

    queue.complete(job.id, "worker-1");
    for (const step of queue.jobs({ session: "ep12", state: "pending" })) {
      const leased = queue.lease("worker-1", 60_000)!;
      queue.complete(leased.id, "worker-1", step.step);
    }

    const session = queue.session("doslineas", "ep12");
    expect(session?.state).toBe("delivered");
    expect(session?.finishedAt).not.toBeNull();
    queue.close();
  });

  it("survives being reopened on the same file", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const directory = await mkdtemp(join(tmpdir(), "doslineas-queue-"));
    const file = join(directory, "state", "jobs.db");

    const first = new SqliteJobQueue(file);
    seed(first);
    const leased = first.lease("worker-1", 60_000)!;
    first.complete(leased.id, "worker-1");
    first.close();

    const second = new SqliteJobQueue(file);
    expect(second.lease("worker-1", 60_000)?.step).toBe("brand");
    second.close();

    await rm(directory, { recursive: true, force: true });
  });
});
