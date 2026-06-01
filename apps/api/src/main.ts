import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { envOrDefault, integerEnvOrDefault, validateRuntimeEnv } from "./common/env";

async function bootstrap() {
  validateRuntimeEnv();
  const app = await NestFactory.create(AppModule);
  const webOrigin = envOrDefault("WEB_ORIGIN", "http://localhost:3000");
  const allowedOrigins = new Set([
    ...webOrigin
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
  app.use(cookieParser());

  const port = integerEnvOrDefault("API_PORT", 3001);
  await app.listen(port);
}

bootstrap();
