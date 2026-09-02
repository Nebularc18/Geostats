import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { TrackablesController } from "./trackables.controller";
import { TrackablesImportService } from "./trackables-import.service";

@Module({
  imports: [AuthModule],
  controllers: [TrackablesController],
  providers: [PrismaService, TrackablesImportService]
})
export class TrackablesModule {}
