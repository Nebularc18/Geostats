import { BadRequestException, HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { ImportStatus } from "@geostats/shared";

const DEFAULT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const MAX_STORED_IMPORT_BYTES = 256 * 1024 * 1024;
const MAX_STORED_IMPORT_OBJECTS = 50;
const MAX_PENDING_IMPORTS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
export const COMPLETED_IMPORT_RETENTION_MS = DAY_MS;
export const FAILED_IMPORT_RETENTION_MS = 7 * DAY_MS;
export const ABANDONED_UPLOAD_RETENTION_MS = 15 * 60 * 1000;

export const storedCacheImport = {
  fileType: { in: ["GPX", "ZIP"] },
  source: { in: ["MY_FINDS_GPX", "MY_HIDES_GPX", "POCKET_QUERY"] },
  objectKey: { not: "" }
} satisfies Prisma.ImportWhereInput;

export const activeStoredCacheImport = { ...storedCacheImport, objectCleanupAttemptedAt: null };

export function uploadMaxBytes() {
  const parsed = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_STORED_IMPORT_BYTES) : DEFAULT_UPLOAD_MAX_BYTES;
}

export async function lockImportAccount(tx: Prisma.TransactionClient, userId: string) {
  const [user] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${userId} FOR NO KEY UPDATE
  `;
  if (!user) throw new NotFoundException("Account not found");
}

async function assertPendingImportCapacity(tx: Prisma.TransactionClient, userId: string) {
  const pending = await tx.import.count({
    where: {
      userId,
      ...activeStoredCacheImport,
      status: { in: [ImportStatus.UPLOADED, ImportStatus.QUEUED, ImportStatus.PROCESSING] }
    }
  });
  if (pending >= MAX_PENDING_IMPORTS) {
    throw new HttpException("You have too many pending imports. Wait for some to finish and try again.", HttpStatus.TOO_MANY_REQUESTS);
  }
}

export async function reserveImportStorage(tx: Prisma.TransactionClient, userId: string, bytes: number) {
  await lockImportAccount(tx, userId);
  await assertPendingImportCapacity(tx, userId);
  const stored = await tx.import.aggregate({
    where: { userId, ...storedCacheImport },
    _count: { _all: true, objectSizeBytes: true },
    _sum: { objectSizeBytes: true }
  });
  // Pre-migration uploads have no recorded size. Charge the default or current
  // per-file maximum until those objects leave the retention window.
  const legacyObjects = stored._count._all - stored._count.objectSizeBytes;
  const reservedBytes = (stored._sum.objectSizeBytes ?? 0) + legacyObjects * Math.max(uploadMaxBytes(), DEFAULT_UPLOAD_MAX_BYTES);
  if (stored._count._all >= MAX_STORED_IMPORT_OBJECTS || reservedBytes + bytes > MAX_STORED_IMPORT_BYTES) {
    throw new HttpException("Your retained import files have reached the storage limit. Try again after older files expire.", HttpStatus.TOO_MANY_REQUESTS);
  }
}

export function failedImportRetryCutoff() {
  return new Date(Date.now() - FAILED_IMPORT_RETENTION_MS);
}

export async function claimFailedImportRetry(tx: Prisma.TransactionClient, userId: string, id: string) {
  await lockImportAccount(tx, userId);
  const row = await tx.import.findFirst({ where: { id, userId, ...storedCacheImport } });
  if (!row) throw new NotFoundException("Import source file is no longer available");
  if (row.status !== ImportStatus.FAILED) throw new BadRequestException("Only failed imports can be retried");
  const cutoff = failedImportRetryCutoff();
  if (row.objectCleanupAttemptedAt || row.updatedAt <= cutoff) {
    throw new NotFoundException("Import source file is no longer available");
  }
  await assertPendingImportCapacity(tx, userId);
  const claimed = await tx.import.updateMany({
    where: { id, userId, ...activeStoredCacheImport, status: ImportStatus.FAILED, updatedAt: { gt: cutoff } },
    data: { status: ImportStatus.QUEUED, errorMessage: null, recoveryAttempts: 0 }
  });
  if (!claimed.count) throw new BadRequestException("Import is no longer available to retry");
  return row;
}
