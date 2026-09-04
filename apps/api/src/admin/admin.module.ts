import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { QueueModule } from "../queue/queue.module";
import { StatsModule } from "../stats/stats.module";
import { StorageModule } from "../storage/storage.module";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, QueueModule, StatsModule, StorageModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, PrismaService],
})
export class AdminModule {}
