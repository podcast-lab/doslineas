import { hostname } from "node:os";
import { Logger, Module } from "@nestjs/common";
import type { AlertStore, Delivery, JobQueue, PipelineConfig, StepRunner } from "@doslineas/pipeline";
import {
  CliStepRunner,
  FolderDelivery,
  FolderWatcher,
  SessionPipeline,
  SqliteAlertStore,
  SqliteJobQueue,
  readConfig
} from "@doslineas/pipeline";
import { RunnerService } from "./runner.service.js";
import { WatcherService } from "./watcher.service.js";
import { ALERT_STORE, DELIVERY, FOLDER_WATCHER, JOB_QUEUE, PIPELINE_CONFIG, SESSION_PIPELINE, STEP_RUNNER } from "./tokens.js";

export function workerName(): string {
  return `${hostname()}-${process.pid}`;
}

@Module({
  providers: [
    { provide: PIPELINE_CONFIG, useFactory: (): PipelineConfig => readConfig() },
    {
      provide: JOB_QUEUE,
      inject: [PIPELINE_CONFIG],
      useFactory: (config: PipelineConfig): JobQueue => new SqliteJobQueue(config.database)
    },
    {
      provide: ALERT_STORE,
      inject: [PIPELINE_CONFIG],
      useFactory: (config: PipelineConfig): AlertStore => new SqliteAlertStore(config.database)
    },
    {
      provide: STEP_RUNNER,
      inject: [PIPELINE_CONFIG],
      useFactory: (config: PipelineConfig): StepRunner =>
        new CliStepRunner({
          repoRoot: config.repoRoot,
          ...(config.transcriber === "mock" ? { commands: { transcribe: "mock-transcript" } } : {})
        })
    },
    {
      provide: DELIVERY,
      inject: [PIPELINE_CONFIG],
      useFactory: (config: PipelineConfig): Delivery => new FolderDelivery({ root: config.deliveryRoot })
    },
    {
      provide: SESSION_PIPELINE,
      inject: [PIPELINE_CONFIG, JOB_QUEUE, STEP_RUNNER, DELIVERY, ALERT_STORE],
      useFactory: (
        config: PipelineConfig,
        queue: JobQueue,
        runner: StepRunner,
        delivery: Delivery,
        alerts: AlertStore
      ): SessionPipeline => {
        const logger = new Logger("step");
        return new SessionPipeline(queue, runner, delivery, alerts, {
          owner: workerName(),
          leaseMs: config.leaseMs,
          heartbeatMs: config.heartbeatMs,
          log: (line) => logger.log(line)
        });
      }
    },
    {
      provide: FOLDER_WATCHER,
      inject: [PIPELINE_CONFIG, JOB_QUEUE, ALERT_STORE],
      useFactory: (config: PipelineConfig, queue: JobQueue, alerts: AlertStore): FolderWatcher =>
        new FolderWatcher(queue, alerts, {
          root: config.sessionsRoot,
          studio: config.studio,
          quietSeconds: config.quietSeconds,
          maxAttempts: config.maxAttempts
        })
    },
    WatcherService,
    RunnerService
  ]
})
export class WorkerModule {}
