import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { StatsModule } from "../stats/stats.module";
import { CollectorController, CollectorTokenController } from "./collector.controller";
import { CollectorTokenAuthService } from "./collector-token-auth.service";
import { GsakImportService } from "./gsak-import.service";

@Module({
  imports: [AuthModule, StatsModule],
  controllers: [CollectorController, CollectorTokenController],
  providers: [PrismaService, CollectorTokenAuthService, GsakImportService],
  exports: [CollectorTokenAuthService]
})
export class CollectorModule {}
