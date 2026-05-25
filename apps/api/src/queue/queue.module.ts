import { Module } from "@nestjs/common";
import { ImportQueueService } from "./import-queue.service";

@Module({
  providers: [ImportQueueService],
  exports: [ImportQueueService]
})
export class QueueModule {}
