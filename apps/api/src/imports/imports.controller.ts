import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { AuthUser, CACHE_IMPORT_MODES, ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";
import { ImportQueueRejectedError, ImportQueueService } from "../queue/import-queue.service";
import { StorageService } from "../storage/storage.service";
import { ABANDONED_UPLOAD_RETENTION_MS, activeStoredCacheImport, claimFailedImportRetry, failedImportRetryCutoff, reserveImportStorage, storedCacheImport, uploadMaxBytes } from "./import-storage";

export function importSourceFor(fileName: string, fileType: ImportFileType, purpose?: string) {
  if (purpose === "finds") return ImportSource.MY_FINDS_GPX;
  if (purpose === "hides") return ImportSource.MY_HIDES_GPX;
  if (purpose === "travel" || purpose === "cache-list") {
    return ImportSource.POCKET_QUERY;
  }
  const lower = fileName.toLowerCase();
  if (lower.includes("my_hides") || lower.includes("my-hides") || lower.includes("my hides")) {
    return ImportSource.MY_HIDES_GPX;
  }
  return fileType === ImportFileType.ZIP ? ImportSource.POCKET_QUERY : ImportSource.MY_FINDS_GPX;
}

@Controller("imports")
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: ImportQueueService
  ) {}

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: uploadMaxBytes() }
    })
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
    @Body("purpose") purpose?: string
  ) {
    if (!file?.buffer.length) {
      throw new BadRequestException("Upload a GPX or ZIP file using the file field");
    }

    const fileType = this.detectFileType(file.originalname);
    if (purpose && purpose !== "travel" && !CACHE_IMPORT_MODES.some(({ value }) => value === purpose)) {
      throw new BadRequestException("Choose My Finds, My Hides, or Cache list");
    }
    const source = importSourceFor(file.originalname, fileType, purpose);
    const mode = purpose || (source === ImportSource.MY_HIDES_GPX ? "hides" : "finds");
    const objectKey = `${user.id}/${randomUUID()}${fileType === ImportFileType.ZIP ? ".zip" : ".gpx"}`;

    const created = await this.prisma.$transaction(async (tx) => {
      await reserveImportStorage(tx, user.id, file.buffer.length);
      return tx.import.create({
        data: {
          userId: user.id,
          fileName: file.originalname,
          fileType,
          source,
          purpose: mode,
          status: ImportStatus.UPLOADED,
          objectKey,
          objectSizeBytes: file.buffer.length
        }
      });
    });

    const activeUpload = { id: created.id, ...activeStoredCacheImport, status: ImportStatus.UPLOADED };
    const claimedAt = new Date();
    const claimed = await this.prisma.import.updateMany({
      where: { ...activeUpload, updatedAt: { gt: new Date(claimedAt.getTime() - ABANDONED_UPLOAD_RETENTION_MS) } },
      data: { updatedAt: claimedAt }
    });
    if (!claimed.count || Date.now() - claimedAt.getTime() >= ABANDONED_UPLOAD_RETENTION_MS / 2) {
      throw new NotFoundException("Import reservation is no longer available");
    }
    try {
      await this.storage.putObject(objectKey, file.buffer, file.mimetype || "application/octet-stream");
    } catch {
      // The PUT may have succeeded despite the error. Keep the reservation
      // charged until scheduled cleanup confirms that the file is gone.
      await this.prisma.import.updateMany({
        where: activeUpload,
        data: {
          status: ImportStatus.FAILED,
          objectCleanupAttemptedAt: new Date(),
          errorMessage: "The file could not be stored. Upload it again to retry."
        }
      });
      throw new ServiceUnavailableException("The file could not be stored. Upload it again to retry.");
    }
    const queued = await this.prisma.import.updateMany({
      where: activeUpload,
      data: { status: ImportStatus.QUEUED }
    });
    if (!queued.count) throw new NotFoundException("Import reservation is no longer available");

    return { import: { id: created.id, status: await this.submit(created) } };
  }

  @Post(":id/retry")
  async retry(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const row = await this.prisma.$transaction((tx) => claimFailedImportRetry(tx, user.id, id));
    return { import: { id, status: await this.submit(row) } };
  }

  private async submit(row: { id: string; userId: string; source: string; objectKey: string }) {
    try {
      await this.queue.enqueue({ importId: row.id, userId: row.userId, source: row.source as ImportSource, objectKey: row.objectKey });
    } catch (error) {
      if (error instanceof ImportQueueRejectedError) {
        const failed = await this.prisma.import.updateMany({
          where: { id: row.id, status: ImportStatus.QUEUED },
          data: { status: ImportStatus.FAILED, errorMessage: "The import queue rejected this file. Retry the import from history." }
        });
        if (failed.count) return ImportStatus.FAILED;
      }
      // An uncertain enqueue keeps its database row and file. The periodic
      // reconciler can submit the same job ID again when the queue recovers.
    }
    return ImportStatus.QUEUED;
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const [imports, latestCompleted] = await Promise.all([
      this.prisma.import.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.import.findFirst({
        where: { userId: user.id, status: ImportStatus.COMPLETED },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true }
      })
    ]);
    const cutoff = failedImportRetryCutoff();
    return {
      lastCompletedAt: latestCompleted?.updatedAt ?? null,
      imports: imports.map(({ leaseToken: _token, leaseExpiresAt: _expiry, objectKey, objectSizeBytes: _size, objectCleanupAttemptedAt, recoveryAttempts: _attempts, ...row }) => ({
        ...row,
        retryable: row.status === ImportStatus.FAILED && Boolean(objectKey) && !objectCleanupAttemptedAt && row.updatedAt > cutoff
          && storedCacheImport.fileType.in.some((type) => type === row.fileType)
          && storedCacheImport.source.in.some((source) => source === row.source)
      }))
    };
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const found = await this.prisma.import.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { finds: true } } }
    });
    if (!found) {
      throw new NotFoundException("Import not found");
    }
    const { leaseToken: _token, leaseExpiresAt: _expiry, objectSizeBytes: _size, objectCleanupAttemptedAt: _cleanup, recoveryAttempts: _attempts, ...visible } = found;
    return { import: visible };
  }

  private detectFileType(fileName: string): ImportFileType {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".gpx")) {
      return ImportFileType.GPX;
    }
    if (lower.endsWith(".zip")) {
      return ImportFileType.ZIP;
    }
    throw new BadRequestException("Only GPX and ZIP files are supported");
  }
}
