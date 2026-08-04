import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../common/prisma.service";
import { requiredEnv } from "../common/env";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { MobileExchangeCodeService } from "./mobile-exchange-code.service";

@Module({
  imports: [
    JwtModule.register({
      secret: requiredEnv("JWT_SECRET"),
      signOptions: { expiresIn: "30d" }
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, MobileExchangeCodeService, PrismaService],
  exports: [AuthService, AuthGuard]
})
export class AuthModule {}
