import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthUser } from "@geostats/shared";
import { Response } from "express";
import { unlink } from "node:fs/promises";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import {
  portabilityDiskStorage,
  PortabilityUploadAdmissionInterceptor,
} from "./portability-upload.interceptor";
import { PortabilityService } from "./portability.service";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

export function portabilityMaxBytes() {
  const configured = Number(process.env.PORTABILITY_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_ARCHIVE_BYTES)
    : MAX_ARCHIVE_BYTES;
}

@Controller("portability")
@UseGuards(AuthGuard)
export class PortabilityController {
  constructor(private readonly portability: PortabilityService) {}

  @Get("export")
  @Header("Content-Type", "application/json; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="geostats-export.json"')
  exportData(@CurrentUser() user: AuthUser) {
    return this.portability.exportData(user);
  }

  @Post("import")
  @UseInterceptors(
    PortabilityUploadAdmissionInterceptor,
    FileInterceptor("file", {
      limits: { fileSize: portabilityMaxBytes(), files: 1 },
      storage: portabilityDiskStorage,
    }),
  )
  async importData(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("Choose a Geostats JSON export to import");
    }
    try {
      return await this.portability.importFile(user, file.path, file.originalname);
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
  }

  @Delete("account")
  async deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body() body: { confirmation?: unknown },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (body.confirmation !== "DELETE") {
      throw new BadRequestException(
        'Type "DELETE" to confirm account deletion',
      );
    }
    await this.portability.deleteAccount(user);
    response.clearCookie("geostats_session");
    return { deleted: true };
  }
}
