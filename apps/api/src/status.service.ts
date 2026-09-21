import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Alert, AlertStore, JobQueue, PipelineConfig, SessionStatus, StepName } from "@doslineas/pipeline";
import { STEP_NAMES, confirmDelivery } from "@doslineas/pipeline";
import { ALERT_STORE, JOB_QUEUE, PIPELINE_CONFIG } from "./tokens.js";

export interface ConfirmedDelivery {
  readonly session: string;
  readonly target: string;
  readonly removedFiles: readonly string[];
  readonly freedBytes: number;
}

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(ALERT_STORE) private readonly alerts: AlertStore,
    @Inject(PIPELINE_CONFIG) private readonly config: PipelineConfig
  ) {}

  sessions(): readonly SessionStatus[] {
    return this.queue.sessions(this.config.studio);
  }

  session(name: string): SessionStatus {
    const found = this.queue.session(this.config.studio, name);
    if (found === null) throw new NotFoundException(`no session called ${name}`);
    return found;
  }

  retry(name: string, step: string | undefined): { readonly restarted: number } {
    const session = this.session(name);
    if (step === undefined) return { restarted: this.queue.retry(session.studio, session.session) };

    if (!STEP_NAMES.includes(step as StepName)) {
      throw new UnprocessableEntityException(`${step} is not one of ${STEP_NAMES.join(", ")}`);
    }
    return { restarted: this.queue.retry(session.studio, session.session, step as StepName) };
  }

  async confirm(name: string, dryRun: boolean): Promise<ConfirmedDelivery> {
    const session = this.session(name);

    let result;
    try {
      result = await confirmDelivery(session.directory, { dryRun });
    } catch (failure) {
      throw new UnprocessableEntityException((failure as Error).message);
    }

    if (!dryRun) {
      const megabytes = (result.removed.bytes / 1e6).toFixed(0);
      this.logger.log(`${name} confirmed: ${result.removed.files.length} raw files gone, ${megabytes} MB free`);
      this.alerts.raise({
        studio: session.studio,
        session: session.session,
        kind: "raw-removed",
        message: `the raw footage of ${session.session} is gone: ${result.removed.files.length} files, ${megabytes} MB`
      });
    }

    return {
      session: session.session,
      target: result.receipt.target,
      removedFiles: result.removed.files,
      freedBytes: result.removed.bytes
    };
  }

  pendingAlerts(): readonly Alert[] {
    return this.alerts.list({ pending: true });
  }

  allAlerts(): readonly Alert[] {
    return this.alerts.list();
  }

  acknowledge(id: number): void {
    this.alerts.acknowledge(id);
  }

  overview(): {
    readonly studio: string;
    readonly sessionsRoot: string;
    readonly deliveryRoot: string;
    readonly sessions: readonly SessionStatus[];
    readonly alerts: readonly Alert[];
  } {
    return {
      studio: this.config.studio,
      sessionsRoot: this.config.sessionsRoot,
      deliveryRoot: this.config.deliveryRoot,
      sessions: this.sessions(),
      alerts: this.pendingAlerts()
    };
  }
}
