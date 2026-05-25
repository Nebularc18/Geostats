import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { ImportsModule } from "./imports/imports.module";
import { MapModule } from "./map/map.module";
import { PrismaService } from "./common/prisma.service";
import { ProfileModule } from "./profile/profile.module";
import { QueueModule } from "./queue/queue.module";
import { StatsModule } from "./stats/stats.module";
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [AuthModule, ProfileModule, StorageModule, QueueModule, ImportsModule, StatsModule, MapModule],
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [PrismaService]
})
export class AppModule {}
