import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { TravelPlansController } from "./travel-plans.controller";
import { MapController } from "./map.controller";
import { TravelSearchService } from "./travel-search.service";

@Module({
  imports: [AuthModule],
  controllers: [MapController, TravelPlansController],
  providers: [PrismaService, TravelSearchService]
})
export class MapModule {}
