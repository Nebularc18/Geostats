import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../common/prisma.service";
import { requiredEnv } from "../common/env";
import { AuthController } from "./auth.controller";
import { AUTH_SESSION_SECONDS, AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";

@Module({
  imports: [
    JwtModule.register({
      secret: requiredEnv("JWT_SECRET"),
      signOptions: { expiresIn: AUTH_SESSION_SECONDS }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PrismaService],
  exports: [AuthService, AuthGuard]
})
export class AuthModule {}
