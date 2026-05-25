import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { MapController } from "./map.controller";

@Module({
  imports: [AuthModule],
  controllers: [MapController],
  providers: [PrismaService]
})
export class MapModule {}
