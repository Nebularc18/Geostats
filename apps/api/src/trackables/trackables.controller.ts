import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Prisma } from "@geostats/db";
import { AuthUser } from "@geostats/shared";
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";
import { TrackablesImportService } from "./trackables-import.service";

export const TRACKABLE_STATES = ["OWNED", "DISCOVERED", "RETRIEVED", "DROPPED", "VISITED", "MISSING"] as const;
export type TrackableState = (typeof TRACKABLE_STATES)[number];

class CreateTrackableDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  trackingCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsIn(TRACKABLE_STATES)
  state!: TrackableState;

  @IsOptional()
  @IsDateString()
  lastSeenAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lastSeenLocation?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  distanceKm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string | null;
}

class UpdateTrackableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(TRACKABLE_STATES)
  state?: TrackableState;

  @IsOptional()
  @IsDateString()
  lastSeenAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lastSeenLocation?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  distanceKm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  notes?: string | null;
}

const STUCK_AFTER_DAYS = 90;

function cleanText(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function cacheNameForDisplay(cache: { gcCode: string; name: string } | null | undefined) {
  if (!cache) return null;
  const name = cleanText(cache.name);
  return name && name.toUpperCase() !== cache.gcCode.toUpperCase() ? name : null;
}

function requiredText(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${label} must not be empty`);
  return trimmed;
}

function dateValue(value: string | null | undefined) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException("lastSeenAt must be a valid date");
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function decimalValue(value: number | null | undefined) {
  return value == null ? null : new Prisma.Decimal(value);
}

function dateEstimated(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).__geostatsKmlDateEstimated === true);
}

function isStuck(state: string, lastSeenAt: Date | null) {
  if (!lastSeenAt || (state !== "DROPPED" && state !== "VISITED")) return false;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - STUCK_AFTER_DAYS);
  return lastSeenAt.getTime() < cutoff.getTime();
}

function responseRow(row: any) {
  return {
    ...row,
    distanceKm: row.distanceKm == null ? null : Number(row.distanceKm),
    stuck: isStuck(row.state, row.lastSeenAt)
  };
}

@Controller("trackables")
@UseGuards(AuthGuard)
export class TrackablesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: TrackablesImportService
  ) {}

  @Get("map")
  async map(@CurrentUser() user: AuthUser) {
    // This endpoint intentionally returns movement rows rather than one row per
    // cache. A trackable can visit the same cache more than once, and the map
    // uses the chronological rows to draw its journey.
    const rows = await this.prisma.trackableLog.findMany({
      where: { userId: user.id },
      orderBy: [{ loggedAt: "asc" }, { id: "asc" }],
      take: 20_000,
      include: {
        trackable: { select: { id: true, trackingCode: true, name: true } },
        cache: { select: { id: true, gcCode: true, name: true, latitude: true, longitude: true } }
      }
    });
    const totalByTrackable = new Map<string, number>();
    for (const row of rows) {
      totalByTrackable.set(row.trackable.id, (totalByTrackable.get(row.trackable.id) ?? 0) + 1);
    }
    const sequenceByTrackable = new Map<string, number>();
    const points = rows.map((row) => {
      const sequence = (sequenceByTrackable.get(row.trackable.id) ?? 0) + 1;
      sequenceByTrackable.set(row.trackable.id, sequence);
      return {
        id: row.id,
        trackableId: row.trackable.id,
        trackingCode: row.trackable.trackingCode,
        name: row.trackable.name,
        logType: row.logType,
        loggedAt: row.loggedAt.toISOString(),
        sequence,
        sequenceTotal: totalByTrackable.get(row.trackable.id) ?? sequence,
        gcCode: row.cache?.gcCode ?? null,
        cacheName: cacheNameForDisplay(row.cache),
        dateEstimated: dateEstimated(row.raw),
        locationName: row.locationName,
        holderName: row.holderName,
        latitude: row.latitude == null ? row.cache == null ? null : Number(row.cache.latitude) : Number(row.latitude),
        longitude: row.longitude == null ? row.cache == null ? null : Number(row.cache.longitude) : Number(row.longitude),
        notes: row.notes
      };
    });
    return { points, total: points.length, unmapped: points.filter((point) => point.latitude == null || point.longitude == null).length };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const rows = await this.prisma.trackable.findMany({
      where: { userId: user.id },
      orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }, { name: "asc" }]
    });
    const trackables = rows.map(responseRow);
    const summary = TRACKABLE_STATES.reduce<Record<string, number>>((counts, state) => {
      counts[state] = rows.filter((row) => row.state === state).length;
      return counts;
    }, {});
    return {
      trackables,
      summary: {
        total: rows.length,
        stuck: trackables.filter((row) => row.stuck).length,
        byState: summary
      }
    };
  }

  @Get(":id/history")
  async history(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const row = await this.prisma.trackable.findFirst({
      where: { id, userId: user.id },
      include: {
        logs: {
          orderBy: [{ loggedAt: "asc" }, { id: "asc" }],
          include: { cache: { select: { id: true, gcCode: true, name: true, latitude: true, longitude: true } } }
        }
      }
    });
    if (!row) throw new NotFoundException("Trackable not found");
    return {
      trackable: responseRow(row),
      logs: row.logs.map((log) => ({
        id: log.id,
        logType: log.logType,
        loggedAt: log.loggedAt.toISOString(),
        locationName: log.locationName,
        holderName: log.holderName,
        gcCode: log.cache?.gcCode ?? null,
        cacheName: cacheNameForDisplay(log.cache),
        dateEstimated: dateEstimated(log.raw),
        latitude: log.latitude == null ? log.cache == null ? null : Number(log.cache.latitude) : Number(log.latitude),
        longitude: log.longitude == null ? log.cache == null ? null : Number(log.cache.longitude) : Number(log.longitude),
        notes: log.notes,
        source: log.source
      }))
    };
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  async importHistory(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File, @Body("trackingCode") suppliedTrackingCode?: string) {
    if (!file) throw new BadRequestException("Upload a GPX, ZIP, KMZ, CSV, KML, or JSON trackable export using the file field");
    try {
      return { import: await this.imports.import(user.id, file.originalname, file.buffer, suppliedTrackingCode) };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Trackable import failed");
    }
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateTrackableDto) {
    try {
      const trackable = await this.prisma.trackable.create({
        data: {
          userId: user.id,
          trackingCode: requiredText(body.trackingCode, "trackingCode").toUpperCase(),
          name: requiredText(body.name, "name"),
          state: body.state,
          lastSeenAt: dateValue(body.lastSeenAt),
          lastSeenLocation: cleanText(body.lastSeenLocation),
          distanceKm: decimalValue(body.distanceKm),
          notes: cleanText(body.notes)
        }
      });
      return { trackable: responseRow(trackable) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That tracking code is already in your logbook");
      }
      throw error;
    }
  }

  @Patch(":id")
  async update(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: UpdateTrackableDto) {
    const existing = await this.prisma.trackable.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw new NotFoundException("Trackable not found");
    const data: Prisma.TrackableUpdateInput = {};
    if (body.trackingCode !== undefined) data.trackingCode = requiredText(body.trackingCode, "trackingCode").toUpperCase();
    if (body.name !== undefined) data.name = requiredText(body.name, "name");
    if (body.state !== undefined) data.state = body.state;
    if (body.lastSeenAt !== undefined) data.lastSeenAt = dateValue(body.lastSeenAt);
    if (body.lastSeenLocation !== undefined) data.lastSeenLocation = cleanText(body.lastSeenLocation);
    if (body.distanceKm !== undefined) data.distanceKm = decimalValue(body.distanceKm);
    if (body.notes !== undefined) data.notes = cleanText(body.notes);
    try {
      const trackable = await this.prisma.trackable.update({ where: { id }, data });
      return { trackable: responseRow(trackable) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("That tracking code is already in your logbook");
      }
      throw error;
    }
  }

  @Delete(":id")
  async remove(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const result = await this.prisma.trackable.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) throw new NotFoundException("Trackable not found");
    return { deleted: true };
  }
}
