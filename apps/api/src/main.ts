import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { envOrDefault } from "./common/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = envOrDefault("WEB_ORIGIN", "http://localhost:3000");

  app.enableCors({
    origin: webOrigin,
    credentials: true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );
  app.use(cookieParser());

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

bootstrap();
