import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { StatsModule } from "../stats/stats.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

@Module({
  imports: [AuthModule, StatsModule],
  controllers: [GoalsController],
  providers: [GoalsService, PrismaService],
  exports: [GoalsService]
})
export class GoalsModule {}
