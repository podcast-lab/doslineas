import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { readConfig } from "@doslineas/pipeline";
import { WorkerModule, workerName } from "./worker.module.js";

async function bootstrap(): Promise<void> {
  const config = readConfig();
  const context = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"]
  });
  context.enableShutdownHooks();

  new Logger("worker").log(
    `${workerName()} · studio ${config.studio} · sessions in ${config.sessionsRoot} · delivering to ${config.deliveryRoot}`
  );
}

await bootstrap();
