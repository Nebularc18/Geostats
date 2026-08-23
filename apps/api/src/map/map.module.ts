import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { MapController } from "./map.controller";
import { TravelSearchService } from "./travel-search.service";

@Module({
  imports: [AuthModule],
  controllers: [MapController],
  providers: [PrismaService, TravelSearchService]
})
export class MapModule {}
