import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { envOrDefault, portEnvOrDefault, validateRuntimeEnv } from "./common/env";

async function bootstrap() {
  validateRuntimeEnv();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const webOrigin = envOrDefault("WEB_ORIGIN", "http://localhost:3000");
  const corsOrigins = envOrDefault("API_CORS_ORIGINS", webOrigin);
  const allowedOrigins = new Set([
    ...corsOrigins
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  ]);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  app.use(json({ limit: "3mb" }));
  app.use(urlencoded({ extended: true, limit: "3mb" }));
  app.use(cookieParser());

  const port = portEnvOrDefault("API_PORT", 3001);
  await app.listen(port);
}

bootstrap();
