import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";
import { CollectorModule } from "./collector/collector.module";
import { ImportsModule } from "./imports/imports.module";
import { MapModule } from "./map/map.module";
import { MysteriesModule } from "./mysteries/mysteries.module";
import { PrismaService } from "./common/prisma.service";
import { ProfileModule } from "./profile/profile.module";
import { QueueModule } from "./queue/queue.module";
import { StatsModule } from "./stats/stats.module";
import { StorageModule } from "./storage/storage.module";
import { PortabilityModule } from "./portability/portability.module";

@Module({
  imports: [AuthModule, ProfileModule, StorageModule, QueueModule, ImportsModule, StatsModule, MapModule, CollectorModule, MysteriesModule, PortabilityModule],
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [PrismaService]
})
export class AppModule {}
