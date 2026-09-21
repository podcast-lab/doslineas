import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import type { FolderWatcher, PipelineConfig } from "@doslineas/pipeline";
import { FOLDER_WATCHER, PIPELINE_CONFIG } from "./tokens.js";

@Injectable()
export class WatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    @Inject(FOLDER_WATCHER) private readonly watcher: FolderWatcher,
    @Inject(PIPELINE_CONFIG) private readonly config: PipelineConfig
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(
      `watching ${this.config.sessionsRoot} every ${this.config.scanSeconds} s, accepting sessions quiet for ${this.config.quietSeconds} s`
    );
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.config.scanSeconds * 1000);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;

    try {
      const round = await this.watcher.round();
      for (const candidate of round.accepted) this.logger.log(`queued ${candidate.session}`);
      for (const candidate of round.incomplete) {
        this.logger.warn(`${candidate.session} is incomplete: ${candidate.problems.join("; ")}`);
      }
    } catch (failure) {
      this.logger.error(`the scan of ${this.config.sessionsRoot} failed: ${(failure as Error).message}`);
    } finally {
      this.scanning = false;
    }
  }
}
