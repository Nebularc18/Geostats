import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { IMPORT_LEASE_MS, ImportSource, MAX_IMPORT_CRASH_RECOVERIES } from "@geostats/shared";
import { PrismaService } from "../common/prisma.service";
import { ImportQueueService } from "../queue/import-queue.service";

const RECONCILE_INTERVAL_MS = 30_000;

export const storedCacheImport = {
  fileType: { in: ["GPX", "ZIP"] },
  source: { in: ["MY_FINDS_GPX", "MY_HIDES_GPX", "POCKET_QUERY"] },
  objectKey: { not: "" }
} satisfies Prisma.ImportWhereInput;

@Injectable()
export class ImportRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly queue: ImportQueueService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      // Check queue availability once before inspecting a batch.
      await this.queue.ping();
      const now = new Date();
      const staleProcessing = {
        status: "PROCESSING",
        OR: [
          { leaseExpiresAt: { lte: now } },
          { leaseExpiresAt: null, updatedAt: { lte: new Date(now.getTime() - IMPORT_LEASE_MS) } }
        ]
      } satisfies Prisma.ImportWhereInput;
      const candidates = await this.prisma.import.findMany({
        where: {
          ...storedCacheImport,
          OR: [
            { status: "QUEUED", updatedAt: { lte: new Date(now.getTime() - RECONCILE_INTERVAL_MS) } },
            staleProcessing
          ]
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: 25
      });

      for (const row of candidates) {
        if (row.status === "PROCESSING" && row.recoveryAttempts >= MAX_IMPORT_CRASH_RECOVERIES) {
          await this.prisma.import.updateMany({
            where: { id: row.id, ...staleProcessing, recoveryAttempts: { gte: MAX_IMPORT_CRASH_RECOVERIES } },
            data: {
              status: "FAILED",
              leaseToken: null,
              leaseExpiresAt: null,
              errorMessage: "Processing stopped repeatedly. Retry this import to try again."
            }
          });
          continue;
        }
        await this.queue.enqueue({
          importId: row.id,
          userId: row.userId,
          objectKey: row.objectKey,
          source: row.source as ImportSource
        });
        // Rotate the batches so old jobs waiting in Redis do not hide later rows.
        if (row.status === "QUEUED") {
          await this.prisma.import.updateMany({
            where: { id: row.id, status: "QUEUED", updatedAt: row.updatedAt },
            data: { updatedAt: now }
          });
        }
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "Could not reconcile imports");
    } finally {
      this.running = false;
    }
  }
}
