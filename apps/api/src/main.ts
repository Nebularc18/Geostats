import "reflect-metadata";
import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  app.enableCors({
    origin: webOrigin,
    credentials: true
  });
  app.use(cookieParser());

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
}

bootstrap();
