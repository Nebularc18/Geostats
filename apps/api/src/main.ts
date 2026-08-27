import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { json, raw, urlencoded } from "express";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { envOrDefault, portEnvOrDefault, validateRuntimeEnv } from "./common/env";
import { parseWindows1252Form } from "./common/windows-1252-form";

async function bootstrap() {
  validateRuntimeEnv();
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "dev") {
    throw new Error("AUTH_MODE=dev must not be used in production");
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
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
  const gsakWindows1252Form = raw({
    limit: "3mb",
    type: (request) => {
      const contentType = request.headers["content-type"] ?? "";
      return /^application\/x-www-form-urlencoded\b/i.test(contentType) && /charset\s*=\s*"?windows-1252"?/i.test(contentType);
    }
  });
  app.use("/collector/gsak/import", gsakWindows1252Form, (request: any, _response: any, next: () => void) => {
    if (Buffer.isBuffer(request.body)) request.body = parseWindows1252Form(request.body);
    next();
  });
  app.use(json({ limit: "3mb" }));
  app.use(urlencoded({ extended: true, limit: "3mb" }));
  app.use(cookieParser());

  const port = portEnvOrDefault("API_PORT", 3001);
  await app.listen(port);
}

bootstrap();
