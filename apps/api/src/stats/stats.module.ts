import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { PublicStatsController } from "./public-stats.controller";
import { StatsController } from "./stats.controller";
import { StatsService } from "./stats.service";

@Module({
  imports: [AuthModule],
  controllers: [StatsController, PublicStatsController],
  providers: [StatsService, PrismaService],
  exports: [StatsService]
})
export class StatsModule {}
