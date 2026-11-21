import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../common/prisma.service";
import { QueueModule } from "../queue/queue.module";
import { StorageModule } from "../storage/storage.module";
import { ImportRecoveryService } from "./import-recovery.service";
import { ImportsController } from "./imports.controller";

@Module({
  imports: [AuthModule, StorageModule, QueueModule],
  controllers: [ImportsController],
  providers: [PrismaService, ImportRecoveryService]
})
export class ImportsModule {}
