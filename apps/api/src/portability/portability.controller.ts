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
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PortabilityService } from "./portability.service";

const DEFAULT_MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

function maxArchiveBytes() {
  const configured = Number(process.env.PORTABILITY_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_ARCHIVE_BYTES;
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
    FileInterceptor("file", {
      limits: { fileSize: maxArchiveBytes(), files: 1 },
    }),
  )
  async importData(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException("Choose a Geostats JSON export to import");
    }
    return this.portability.importData(user, file.buffer);
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
