import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { PortabilityController } from "./portability.controller";
import { PortabilityUploadAdmissionInterceptor } from "./portability-upload.interceptor";
import { PortabilityService } from "./portability.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [PortabilityController],
  providers: [
    PrismaService,
    PortabilityService,
    PortabilityUploadAdmissionInterceptor,
  ],
})
export class PortabilityModule {}
