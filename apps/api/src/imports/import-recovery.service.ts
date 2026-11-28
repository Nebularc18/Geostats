import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { IMPORT_LEASE_MS, ImportSource, MAX_IMPORT_CRASH_RECOVERIES } from "@geostats/shared";
import { PrismaService } from "../common/prisma.service";
import { ImportQueueService } from "../queue/import-queue.service";
import { StorageService } from "../storage/storage.service";
import { ABANDONED_UPLOAD_RETENTION_MS, activeStoredCacheImport, COMPLETED_IMPORT_RETENTION_MS, FAILED_IMPORT_RETENTION_MS, storedCacheImport } from "./import-storage";

const RECONCILE_INTERVAL_MS = 30_000;
const CLEANUP_RETRY_MS = 60_000;

function eligibleForCleanup(now: Date): Prisma.ImportWhereInput {
  const before = (delay: number) => new Date(now.getTime() - delay);
  return {
    ...storedCacheImport,
    status: { in: ["UPLOADED", "FAILED", "COMPLETED"] },
    OR: [
      { objectCleanupAttemptedAt: { lte: before(CLEANUP_RETRY_MS) } },
      { objectCleanupAttemptedAt: null, OR: [
        { status: "UPLOADED", updatedAt: { lte: before(ABANDONED_UPLOAD_RETENTION_MS) } },
        { status: "COMPLETED", updatedAt: { lte: before(COMPLETED_IMPORT_RETENTION_MS) } },
        { status: "FAILED", updatedAt: { lte: before(FAILED_IMPORT_RETENTION_MS) } }
      ] }
    ]
  };
}

@Injectable()
export class ImportRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private cleaning = false;

  constructor(private readonly prisma: PrismaService, private readonly queue: ImportQueueService, private readonly storage: StorageService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile();
      void this.cleanupExpiredObjects();
    }, RECONCILE_INTERVAL_MS);
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
          ...activeStoredCacheImport,
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

  async cleanupExpiredObjects() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const eligible = eligibleForCleanup(new Date());
      const expired = await this.prisma.import.findMany({
        where: eligible,
        orderBy: [{ objectCleanupAttemptedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "asc" }, { id: "asc" }],
        select: { id: true, status: true, updatedAt: true, objectKey: true, objectCleanupAttemptedAt: true },
        take: 25
      });

      for (const row of expired) {
        const claimed = await this.prisma.import.updateMany({
          where: { ...eligible, id: row.id, objectKey: row.objectKey, objectCleanupAttemptedAt: row.objectCleanupAttemptedAt, status: row.status, updatedAt: row.updatedAt },
          data: {
            objectCleanupAttemptedAt: new Date(),
            updatedAt: row.updatedAt,
            ...(row.status === "UPLOADED" ? { status: "FAILED", errorMessage: "The upload stopped before its file was stored. Upload it again to retry." } : {})
          }
        });
        if (!claimed.count) continue;
        try {
          await this.storage.deleteObject(row.objectKey);
          await this.prisma.import.updateMany({
            where: { id: row.id, objectKey: row.objectKey },
            // File deletion must not change the last completed import time.
            data: { objectKey: "", objectSizeBytes: null, updatedAt: row.updatedAt }
          });
        } catch (error) {
          this.logger.warn(error instanceof Error ? error.message : "Could not remove an expired import source file");
        }
      }
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : "Could not process expired import source files");
    } finally {
      this.cleaning = false;
    }
  }
}
