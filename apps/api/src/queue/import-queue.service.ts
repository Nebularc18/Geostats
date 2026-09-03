import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { IMPORT_QUEUE_NAME, ImportJobPayload } from "@geostats/shared";
import { requiredEnv } from "../common/env";

const HEALTH_PING_TIMEOUT_MS = 1_000;

export function importJobId(importId: string) {
  return `import-${importId}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(requiredEnv("REDIS_URL"), {
    maxRetriesPerRequest: null
  });
  private readonly queue = new Queue<ImportJobPayload>(IMPORT_QUEUE_NAME, { connection: this.connection });

  async enqueue(payload: ImportJobPayload) {
    await this.queue.add("process-import", payload, {
      jobId: importJobId(payload.importId),
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: true,
      removeOnFail: true
    });
  }

  async ping() {
    const result = await withTimeout(
      this.connection.ping(),
      HEALTH_PING_TIMEOUT_MS,
      `Redis ping timed out after ${HEALTH_PING_TIMEOUT_MS}ms`
    );
    if (result !== "PONG") {
      throw new Error(`Redis ping returned ${result}`);
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.connection.quit();
  }
}
