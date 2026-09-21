import { Body, Controller, Get, Inject, Param, ParseIntPipe, Post, Query } from "@nestjs/common";
import type { Alert, SessionStatus } from "@doslineas/pipeline";
import type { ConfirmedDelivery } from "./status.service.js";
import { StatusService } from "./status.service.js";

@Controller("api")
export class SessionsController {
  constructor(@Inject(StatusService) private readonly status: StatusService) {}

  @Get("overview")
  overview(): ReturnType<StatusService["overview"]> {
    return this.status.overview();
  }

  @Get("sessions")
  sessions(): readonly SessionStatus[] {
    return this.status.sessions();
  }

  @Get("sessions/:session")
  session(@Param("session") session: string): SessionStatus {
    return this.status.session(session);
  }

  @Post("sessions/:session/retry")
  retry(
    @Param("session") session: string,
    @Body() body: { step?: string } | undefined
  ): { readonly restarted: number } {
    return this.status.retry(session, body?.step);
  }

  @Post("sessions/:session/confirm")
  confirm(@Param("session") session: string, @Query("dryRun") dryRun?: string): Promise<ConfirmedDelivery> {
    return this.status.confirm(session, dryRun === "true");
  }

  @Get("alerts")
  alerts(@Query("pending") pending?: string): readonly Alert[] {
    return pending === "false" ? this.status.allAlerts() : this.status.pendingAlerts();
  }

  @Post("alerts/:id/ack")
  acknowledge(@Param("id", ParseIntPipe) id: number): { readonly acknowledged: number } {
    this.status.acknowledge(id);
    return { acknowledged: id };
  }
}
