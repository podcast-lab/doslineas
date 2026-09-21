import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEdl } from "@doslineas/core";
import type { AlertStore } from "./alerts.js";
import type { Delivery } from "./delivery.js";
import { collectDeliverables } from "./delivery.js";
import type { Job } from "./jobs.js";
import type { JobQueue } from "./queue.js";
import type { StepLogger, StepRunner } from "./runner.js";
import { artifactFreshness, missingInputs, stepDefinition } from "./steps.js";

export type StepOutcome = "done" | "fresh" | "skipped" | "failed";

export interface ProcessedStep {
  readonly job: Job;
  readonly outcome: StepOutcome;
  readonly note: string;
  readonly seconds: number;
}

export interface PipelineOptions {
  readonly owner: string;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly log?: StepLogger;
}

async function input4Role(directory: string): Promise<"screen" | "guest3" | null> {
  try {
    const edl = parseEdl(JSON.parse(await readFile(join(directory, "edl.json"), "utf8")));
    const fourth = edl.sources.find((source) => source.input === 4);
    if (fourth === undefined) return null;
    return fourth.role === "screen" ? "screen" : "guest3";
  } catch {
    return null;
  }
}

export class SessionPipeline {
  private readonly log: StepLogger;

  constructor(
    private readonly queue: JobQueue,
    private readonly runner: StepRunner,
    private readonly delivery: Delivery,
    private readonly alerts: AlertStore,
    private readonly options: PipelineOptions
  ) {
    this.log = options.log ?? ((): void => {});
  }

  reclaim(): void {
    for (const job of this.queue.reclaimExpired()) {
      this.alerts.raise({
        studio: job.studio,
        session: job.session,
        kind: "lease-expired",
        message: `${job.step} of ${job.session} was left mid-flight and goes back to the queue as ${job.state}`
      });
    }
  }

  async processNext(): Promise<ProcessedStep | null> {
    this.reclaim();

    const job = this.queue.lease(this.options.owner, this.options.leaseMs);
    if (job === null) return null;

    const started = Date.now();
    const seconds = (): number => (Date.now() - started) / 1000;
    const prefix = `[${job.session}/${job.step}]`;
    const log: StepLogger = (line) => this.log(`${prefix} ${line}`);

    try {
      const skipped = await this.skipReason(job);
      if (skipped !== null) {
        this.queue.skip(job.id, this.options.owner, skipped);
        log(skipped);
        return { job, outcome: "skipped", note: skipped, seconds: seconds() };
      }

      const step = stepDefinition(job.step);
      const freshness = await artifactFreshness(step, job.directory);
      if (freshness.fresh) {
        const note = `${step.produces.join(", ")} are already up to date`;
        this.queue.complete(job.id, this.options.owner, note);
        log(note);
        return { job, outcome: "fresh", note, seconds: seconds() };
      }

      const missing = await missingInputs(step, job.directory);
      if (missing.length > 0) throw new Error(`${job.step} cannot start without ${missing.join(", ")}`);

      const note = await this.execute(job, log);
      this.queue.complete(job.id, this.options.owner, note);
      log(`done in ${seconds().toFixed(1)} s`);
      return { job, outcome: "done", note, seconds: seconds() };
    } catch (failure) {
      const message = (failure as Error).message;
      const after = this.queue.fail(job.id, this.options.owner, message);
      log(`failed: ${message}`);
      if (after.state === "failed") {
        this.alerts.raise({
          studio: job.studio,
          session: job.session,
          kind: "step-failed",
          message: `${job.step} of ${job.session} gave up after ${after.attempts} attempts: ${message}`
        });
      }
      return { job: after, outcome: "failed", note: message, seconds: seconds() };
    }
  }

  private async skipReason(job: Job): Promise<string | null> {
    const step = stepDefinition(job.step);
    if (!step.onlyWithScreen) return null;

    const role = await input4Role(job.directory);
    if (role === "screen") return null;
    return role === null
      ? `${job.step} needs an edl.json that says what input 4 carries`
      : "input 4 carries a third guest, not a screen, so this session has no explainer";
  }

  private async execute(job: Job, log: StepLogger): Promise<string> {
    const controller = new AbortController();
    const beat = setInterval(() => {
      try {
        this.queue.heartbeat(job.id, this.options.owner, this.options.leaseMs);
      } catch (failure) {
        log(`losing the lease: ${(failure as Error).message}`);
        controller.abort();
      }
    }, this.options.heartbeatMs);

    try {
      if (job.step === "deliver") return await this.deliver(job, log);
      await this.runner.run(job, log, controller.signal);
      return `${stepDefinition(job.step).produces.join(", ")} written`;
    } finally {
      clearInterval(beat);
    }
  }

  private async deliver(job: Job, log: StepLogger): Promise<string> {
    const items = await collectDeliverables(job.directory);
    log(`delivering ${items.length} files through ${this.delivery.name}`);

    const receipt = await this.delivery.deliver(
      { studio: job.studio, session: job.session, directory: job.directory },
      items
    );
    const megabytes = receipt.items.reduce((total, item) => total + item.bytes, 0) / 1e6;

    this.alerts.raise({
      studio: job.studio,
      session: job.session,
      kind: "delivery-ready",
      message: `${job.session} is delivered to ${receipt.target}; confirm it to drop the raw footage`
    });

    return `${receipt.items.length} files (${megabytes.toFixed(1)} MB) delivered to ${receipt.target}`;
  }
}
