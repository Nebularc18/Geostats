import { Worker } from "bullmq";
import IORedis from "ioredis";
import { IMPORT_QUEUE_NAME, ImportJobPayload } from "@geostats/shared";
import { PrismaClient } from "@geostats/db";
import { optionalPositiveIntegerEnv, requiredEnv, validateRuntimeEnv } from "./config/env";
import { ImportProcessor } from "./imports/import-processor";
import { ObjectStorage } from "./storage/object-storage";

validateRuntimeEnv();
const connection = new IORedis(requiredEnv("REDIS_URL"), {
  maxRetriesPerRequest: null
});
const prisma = new PrismaClient();
const storage = new ObjectStorage();
const processor = new ImportProcessor(prisma, storage);

const worker = new Worker<ImportJobPayload>(
  IMPORT_QUEUE_NAME,
  async (job) => {
    await processor.process(job.data, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1
    });
  },
  { connection, concurrency: optionalPositiveIntegerEnv("IMPORT_WORKER_CONCURRENCY", 2) }
);

worker.on("completed", (job) => {
  console.log(`Completed import job ${job.id}`);
});

worker.on("failed", (job, error) => {
  console.error(`Import job ${job?.id ?? "unknown"} failed`, error);
});

async function shutdown() {
  await worker.close();
  await connection.quit();
  await prisma.$disconnect();
}

process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
