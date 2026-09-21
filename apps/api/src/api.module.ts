import { Module } from "@nestjs/common";
import type { AlertStore, Delivery, JobQueue, PipelineConfig } from "@doslineas/pipeline";
import { FolderDelivery, SqliteAlertStore, SqliteJobQueue, readConfig } from "@doslineas/pipeline";
import { DashboardController } from "./dashboard.controller.js";
import { SessionsController } from "./sessions.controller.js";
import { StatusService } from "./status.service.js";
import { ALERT_STORE, DELIVERY, JOB_QUEUE, PIPELINE_CONFIG } from "./tokens.js";

@Module({
  controllers: [DashboardController, SessionsController],
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
      provide: DELIVERY,
      inject: [PIPELINE_CONFIG],
      useFactory: (config: PipelineConfig): Delivery => new FolderDelivery({ root: config.deliveryRoot })
    },
    StatusService
  ]
})
export class ApiModule {}
