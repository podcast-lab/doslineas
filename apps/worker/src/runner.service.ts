import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { PipelineConfig, SessionPipeline } from "@doslineas/pipeline";
import { PIPELINE_CONFIG, SESSION_PIPELINE } from "./tokens.js";
import { workerName } from "./worker.module.js";

@Injectable()
export class RunnerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RunnerService.name);
  private stopping = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    @Inject(SESSION_PIPELINE) private readonly pipeline: SessionPipeline,
    @Inject(PIPELINE_CONFIG) private readonly config: PipelineConfig
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(`${workerName()} is taking jobs`);
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      let processed = null;
      try {
        processed = await this.pipeline.processNext();
      } catch (failure) {
        this.logger.error(`the queue is not answering: ${(failure as Error).message}`);
      }

      if (processed === null) {
        await new Promise((wake) => setTimeout(wake, this.config.idleMs));
        continue;
      }

      const line = `${processed.job.session} · ${processed.job.step} · ${processed.outcome} in ${processed.seconds.toFixed(1)} s`;
      if (processed.outcome === "failed") this.logger.error(line);
      else this.logger.log(line);
    }
  }
}
