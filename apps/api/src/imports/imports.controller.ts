import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthUser, ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";
import { ImportQueueService } from "../queue/import-queue.service";
import { StorageService } from "../storage/storage.service";

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
      limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES ?? 52_428_800) }
    })
  )
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException("Upload a GPX or ZIP file using the file field");
    }

    const fileType = this.detectFileType(file.originalname);
    const source = this.detectSource(file.originalname, fileType);
    const objectKey = `${user.id}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

    await this.storage.putObject(objectKey, file.buffer, file.mimetype || "application/octet-stream");
    const created = await this.prisma.import.create({
      data: {
        userId: user.id,
        fileName: file.originalname,
        fileType,
        source,
        status: ImportStatus.UPLOADED,
        objectKey
      }
    });

    await this.queue.enqueue({ importId: created.id, userId: user.id, objectKey, source });
    await this.prisma.import.update({
      where: { id: created.id },
      data: { status: ImportStatus.QUEUED }
    });

    return {
      import: {
        ...created,
        status: ImportStatus.QUEUED
      }
    };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const imports = await this.prisma.import.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return { imports };
  }

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const found = await this.prisma.import.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { finds: true } } }
    });
    if (!found) {
      throw new BadRequestException("Import not found");
    }
    return { import: found };
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

  private detectSource(fileName: string, fileType: ImportFileType): ImportSource {
    const lower = fileName.toLowerCase();
    if (lower.includes("my_hides") || lower.includes("my-hides") || lower.includes("my hides")) {
      return ImportSource.MY_HIDES_GPX;
    }
    return fileType === ImportFileType.ZIP ? ImportSource.POCKET_QUERY : ImportSource.MY_FINDS_GPX;
  }
}
