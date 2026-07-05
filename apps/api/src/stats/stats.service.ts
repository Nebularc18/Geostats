import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { countableFindWhere, Prisma } from "@geostats/db";
import { calculateHideStats, calculateStats, normalizedGcUsername } from "@geostats/stats";
import { PrismaService } from "../common/prisma.service";

const STATS_VERSION = 17;
const DEFAULT_FTF_FIND_LIMIT = 100;
const MAX_FTF_FIND_LIMIT = 200;
const MAX_FTF_LOG_TEXT_LENGTH = 1_000;
type PrismaClientLike = PrismaService | Prisma.TransactionClient;
type FtfFindRow = {
  id: string;
  foundAt: Date;
  isFtf: boolean;
  logText: string | null;
  cache: {
    gcCode: string;
    name: string;
    cacheType: string | null;
    country: string | null;
    region: string | null;
  };
};

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function elevationFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = (raw as Record<string, unknown>).ele;
  const text = value && typeof value === "object" && "text" in value ? (value as { text?: unknown }).text : value;
  const elevation = Number(text);
  return Number.isFinite(elevation) ? elevation : null;
}

@Injectable()
export class StatsService {
  private readonly recalculationsByUser = new Map<string, Promise<any>>();

  constructor(private readonly prisma: PrismaService) {}

  async snapshotForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId } });
    const latest = await this.prisma.statSnapshot.findFirst({
      where: { userId },
      orderBy: { generatedAt: "desc" }
    });
    if (latest) {
      const stats = latest.statsJson as any;
      const needsHomeDistance = profile?.homeLatitude != null && profile.homeLongitude != null && !stats.distanceStats;
      if (stats.statsVersion === STATS_VERSION && !needsHomeDistance) {
        return stats;
      }

      return this.recalculateSnapshotForUser(userId, profile);
    }

    return this.recalculateSnapshotForUser(userId, profile);
  }

  async publicSnapshotForUsername(username: string) {
    const cleanUsername = username.trim();
    if (!cleanUsername) {
      throw new NotFoundException("Profile not found");
    }

    const profiles = await this.prisma.geocachingProfile.findMany({
      where: {
        gcUsername: {
          equals: cleanUsername,
          mode: "insensitive"
        }
      },
      select: {
        userId: true,
        gcUsername: true
      },
      orderBy: { updatedAt: "desc" }
    });

    if (!profiles.length) {
      throw new NotFoundException("Profile not found");
    }
    const latestImports = await this.prisma.import.findMany({
      where: {
        userId: { in: profiles.map((profile) => profile.userId) },
        status: "COMPLETED"
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        userId: true,
        createdAt: true,
        updatedAt: true
      },
      take: 1
    });
    const latestImport = latestImports[0] ?? null;
    const profile = latestImport
      ? (profiles.find((candidate) => candidate.userId === latestImport.userId) ?? profiles[0]!)
      : profiles[0]!;
    const stats = await this.snapshotForUser(profile.userId);

    return {
      profile,
      stats: {
        ...stats,
        latestImportAt: latestImport?.updatedAt?.toISOString() ?? latestImport?.createdAt?.toISOString() ?? null
      }
    };
  }

  async buildSnapshotForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId } });
    return this.calculateSnapshot(userId, profile, this.prisma);
  }

  async replaceSnapshotForUser(userId: string, stats: unknown, prisma: PrismaClientLike = this.prisma) {
    await prisma.statSnapshot.deleteMany({ where: { userId } });
    await prisma.statSnapshot.create({
      data: {
        userId,
        statsJson: stats as Prisma.InputJsonValue
      }
    });
  }

  private async recalculateSnapshotForUser(
    userId: string,
    profile?: { gcUsername?: string | null; homeLatitude: unknown; homeLongitude: unknown } | null
  ) {
    const inFlight = this.recalculationsByUser.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const recalculation = this.calculateSnapshot(userId, profile, this.prisma)
      .then(async (stats) => {
        await this.prisma.$transaction((tx) => this.replaceSnapshotForUser(userId, stats, tx));
        return stats;
      })
      .finally(() => {
        this.recalculationsByUser.delete(userId);
      });
    this.recalculationsByUser.set(userId, recalculation);
    return recalculation;
  }

  private async calculateSnapshot(
    userId: string,
    profile?: { gcUsername?: string | null; homeLatitude: unknown; homeLongitude: unknown } | null,
    prisma: PrismaClientLike = this.prisma
  ) {
    const hides = await prisma.hide.findMany({
      where: { userId },
      include: {
        cache: {
          include: {
            corrections: {
              where: { userId }
            }
          }
        }
      },
      orderBy: { placedAt: "asc" }
    });
    const gcUsername = normalizedGcUsername(profile);
    const finds = await prisma.find.findMany({
      where: countableFindWhere(userId, gcUsername),
      include: {
        cache: {
          include: {
            corrections: {
              where: { userId }
            }
          }
        }
      },
      orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }]
    });
    const stats = calculateStats(
      finds.map((find) => ({
        foundAt: find.foundAt,
        isFtf: find.isFtf,
        logText: find.logText,
        cache: {
          latitude: Number(find.cache.corrections[0]?.latitude ?? find.cache.latitude),
          longitude: Number(find.cache.corrections[0]?.longitude ?? find.cache.longitude),
          gcCode: find.cache.gcCode,
          name: find.cache.name,
          cacheType: find.cache.cacheType,
          difficulty: find.cache.difficulty ? Number(find.cache.difficulty) : null,
          terrain: find.cache.terrain ? Number(find.cache.terrain) : null,
          size: find.cache.size,
          country: find.cache.country,
          region: find.cache.region,
          county: find.cache.county,
          hiddenDate: find.cache.hiddenDate,
          ownerName: find.cache.ownerName,
          elevationMeters: elevationFromRaw(find.cache.raw),
          raw: find.cache.raw
        }
      })),
      {
        homeLatitude: profile?.homeLatitude == null ? null : Number(profile.homeLatitude),
        homeLongitude: profile?.homeLongitude == null ? null : Number(profile.homeLongitude)
      }
    );
    stats.hideStats = calculateHideStats(
      hides.map((hide) => ({
        placedAt: hide.placedAt,
        receivedLogCount: hide.receivedLogCount,
        receivedLogsRaw: hide.receivedLogsRaw,
        cache: {
          latitude: Number(hide.cache.corrections[0]?.latitude ?? hide.cache.latitude),
          longitude: Number(hide.cache.corrections[0]?.longitude ?? hide.cache.longitude),
          gcCode: hide.cache.gcCode,
          name: hide.cache.name,
          cacheType: hide.cache.cacheType,
          difficulty: hide.cache.difficulty ? Number(hide.cache.difficulty) : null,
          terrain: hide.cache.terrain ? Number(hide.cache.terrain) : null,
          size: hide.cache.size,
          country: hide.cache.country,
          region: hide.cache.region,
          county: hide.cache.county,
          hiddenDate: hide.cache.hiddenDate,
          ownerName: hide.cache.ownerName,
          elevationMeters: elevationFromRaw(hide.cache.raw),
          raw: hide.cache.raw
        }
      }))
    );
    stats.achievementStats.hostedEventCaches = stats.hideStats.hostedEventCaches;

    return stats;
  }

  async ftfFindsForUser(userId: string, options: { cursor?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_FTF_FIND_LIMIT, 1), MAX_FTF_FIND_LIMIT);
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId }, select: { gcUsername: true } });
    const gcUsername = normalizedGcUsername(profile);
    let finds: FtfFindRow[];
    try {
      finds = await this.prisma.find.findMany({
        where: countableFindWhere(userId, gcUsername),
        select: {
          id: true,
          foundAt: true,
          isFtf: true,
          logText: true,
          cache: {
            select: {
              gcCode: true,
              name: true,
              cacheType: true,
              country: true,
              region: true
            }
          }
        },
        orderBy: [{ foundAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
      });
    } catch (error) {
      if (isPrismaError(error, "P2025")) {
        throw new BadRequestException("invalid cursor");
      }
      throw error;
    }
    const page = finds.slice(0, limit);

    return {
      finds: page.map((find) => ({
        id: find.id,
        foundAt: find.foundAt.toISOString(),
        isFtf: find.isFtf,
        logText: find.logText?.slice(0, MAX_FTF_LOG_TEXT_LENGTH) ?? null,
        cache: {
          gcCode: find.cache.gcCode,
          name: find.cache.name,
          cacheType: find.cache.cacheType,
          country: find.cache.country,
          region: find.cache.region
        }
      })),
      nextCursor: finds.length > limit ? page.at(-1)?.id ?? null : null
    };
  }

  async updateFtfFlag(userId: string, findId: string, isFtf: boolean) {
    const result = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.find.updateMany({
        where: { id: findId, userId, isFtf: !isFtf },
        data: { isFtf, isFtfManual: true }
      });
      if (updateResult.count > 0) {
        await tx.statSnapshot.deleteMany({ where: { userId } });
        return { found: true };
      }

      const existingFind = await tx.find.findFirst({
        where: { id: findId, userId },
        select: { id: true }
      });
      return { found: existingFind !== null };
    });
    if (!result.found) {
      throw new NotFoundException("Find not found");
    }

    return { id: findId, isFtf };
  }
}
