import { BadRequestException, Body, Controller, Get, Post, Put, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AuthGuard } from "../auth/auth.guard";
import { normalizeCountry } from "../common/geocaching.utils";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

class ProfileDto {
  @IsNotEmpty()
  @MaxLength(60)
  gcUsername!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  homeLatitude?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  homeLongitude?: number | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  timeZone!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  ftfDetectionTerms?: string[];

  @IsOptional()
  @IsBoolean()
  publicStatsEnabled?: boolean;
}

class PublicStatsDto {
  @IsBoolean()
  publicStatsEnabled!: boolean;
}

type FinderCountryRow = {
  country?: unknown;
  count?: unknown;
};

function cleanFtfDetectionTerms(terms: string[] | undefined): string[] {
  const cleaned = (terms ?? [])
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return [...new Set(cleaned)].slice(0, 20);
}

function cleanTimeZone(timeZone: string): string {
  const value = timeZone.trim() || "Europe/Stockholm";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return "Europe/Stockholm";
  }
}

function parseFinderCountryText(text: unknown): Array<{ country: string; count: number }> {
  const rows: Array<{ country: string; count: number }> = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || /^(country|finders by country)\b/i.test(line)) {
      continue;
    }
    const match = line.match(/^(?:\d+\s*[–-]\s*)?(.+?)\s+(\d+)\s+\d+(?:[.,]\d+)?%?$/);
    if (!match) {
      continue;
    }
    const country = normalizeCountry(match[1]);
    const count = Number(match[2]);
    if (country && Number.isInteger(count) && count > 0) {
      rows.push({ country, count });
    }
  }
  return rows;
}

function normalizeFinderCountryRows(body: { rows?: FinderCountryRow[]; text?: unknown }): Array<{ country: string; count: number }> {
  const parsedRows = Array.isArray(body.rows)
    ? body.rows
        .map((row) => {
          const country = normalizeCountry(row.country);
          const count = Number(row.count);
          return country && Number.isInteger(count) && count > 0 ? { country, count } : null;
        })
        .filter((row): row is { country: string; count: number } => Boolean(row))
    : parseFinderCountryText(body.text);
  const byCountry = new Map<string, number>();
  for (const row of parsedRows) {
    byCountry.set(row.country, (byCountry.get(row.country) ?? 0) + row.count);
  }
  return [...byCountry.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

@Controller("profile")
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getProfile(@CurrentUser() user: AuthUser) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId: user.id } });
    return { profile };
  }

  @Put()
  async updateProfile(@CurrentUser() user: AuthUser, @Body() body: ProfileDto) {
    const gcUsername = body.gcUsername.trim();
    if (!gcUsername) {
      throw new BadRequestException("Geocaching username is required");
    }
    const profile = await this.prisma.$transaction(async (tx) => {
      const ftfDetectionTerms = cleanFtfDetectionTerms(body.ftfDetectionTerms);
      const ftfDetectionData = body.ftfDetectionTerms === undefined ? {} : { ftfDetectionTerms };
      const publicStatsData = body.publicStatsEnabled === undefined ? {} : { publicStatsEnabled: body.publicStatsEnabled };
      const timeZone = cleanTimeZone(body.timeZone);
      const updated = await tx.geocachingProfile.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          gcUsername,
          homeLatitude: body.homeLatitude ?? null,
          homeLongitude: body.homeLongitude ?? null,
          timeZone,
          ...ftfDetectionData,
          ...publicStatsData
        },
        update: {
          gcUsername,
          homeLatitude: body.homeLatitude ?? null,
          homeLongitude: body.homeLongitude ?? null,
          timeZone,
          ...ftfDetectionData,
          ...publicStatsData
        }
      });
      await tx.statSnapshot.deleteMany({ where: { userId: user.id } });
      return updated;
    });
    return { profile };
  }

  @Put("public-stats")
  async updatePublicStats(@CurrentUser() user: AuthUser, @Body() body: PublicStatsDto) {
    const existing = await this.prisma.geocachingProfile.findUnique({ where: { userId: user.id } });
    if (!existing) {
      throw new BadRequestException("Create a Geocaching profile before publishing statistics");
    }
    const profile = await this.prisma.geocachingProfile.update({
      where: { userId: user.id },
      data: { publicStatsEnabled: body.publicStatsEnabled }
    });
    return { profile };
  }

  @Post("owner-finder-countries")
  async importOwnerFinderCountries(@CurrentUser() user: AuthUser, @Body() body: { rows?: FinderCountryRow[]; text?: unknown }) {
    const rows = normalizeFinderCountryRows(body);
    if (rows.length === 0) {
      throw new BadRequestException("No finder-country rows found");
    }
    if (rows.length > 250) {
      throw new BadRequestException("Too many finder-country rows");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ownerFinderCountryStat.deleteMany({ where: { userId: user.id } });
      await tx.ownerFinderCountryStat.createMany({
        data: rows.map((row) => ({
          userId: user.id,
          country: row.country,
          count: row.count
        }))
      });
      await tx.statSnapshot.deleteMany({ where: { userId: user.id } });
    });
    return { rows };
  }
}
