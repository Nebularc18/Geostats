import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { IMPORT_QUEUE_NAME, ImportJobPayload } from "@geostats/shared";
import { requiredEnv } from "../common/env";

@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(requiredEnv("REDIS_URL"), {
    maxRetriesPerRequest: null
  });
  private readonly queue = new Queue<ImportJobPayload>(IMPORT_QUEUE_NAME, { connection: this.connection });

  async enqueue(payload: ImportJobPayload) {
    await this.queue.add("process-import", payload, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 100
    });
  }

  async ping() {
    const result = await this.connection.ping();
    if (result !== "PONG") {
      throw new Error(`Redis ping returned ${result}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
