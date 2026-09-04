import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
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
import { ChallengeCheckersModule } from "./challenge-checkers/challenge-checkers.module";
import { TrackablesModule } from "./trackables/trackables.module";
import { AdminModule } from "./admin/admin.module";
import { APP_THROTTLERS } from "./common/rate-limits";

@Module({
  imports: [
    ThrottlerModule.forRoot(APP_THROTTLERS),
    AuthModule,
    ProfileModule,
    StorageModule,
    QueueModule,
    ImportsModule,
    StatsModule,
    MapModule,
    CollectorModule,
    MysteriesModule,
    PortabilityModule,
    ChallengeCheckersModule,
    TrackablesModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [PrismaService],
})
export class AppModule {}
