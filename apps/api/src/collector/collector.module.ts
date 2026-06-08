import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { StatsModule } from "../stats/stats.module";
import { CollectorController, CollectorTokenController } from "./collector.controller";

@Module({
  imports: [AuthModule, StatsModule],
  controllers: [CollectorController, CollectorTokenController],
  providers: [PrismaService]
})
export class CollectorModule {}
