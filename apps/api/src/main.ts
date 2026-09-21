import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { readConfig } from "@doslineas/pipeline";
import { ApiModule } from "./api.module.js";

async function bootstrap(): Promise<void> {
  const config = readConfig();
  const app = await NestFactory.create(ApiModule, { logger: ["error", "warn", "log"] });
  app.enableShutdownHooks();
  await app.listen(config.port);

  new Logger("api").log(`the panel of ${config.studio} is at http://localhost:${config.port}`);
}

await bootstrap();
