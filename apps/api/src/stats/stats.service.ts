import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { calculateHideStats, calculateStats } from "@geostats/stats";
import { PrismaService } from "../common/prisma.service";

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
      if (stats.statsVersion === 14 && !needsHomeDistance) {
        return stats;
      }

      return this.recalculateSnapshotForUser(userId, profile);
    }

    return this.recalculateSnapshotForUser(userId, profile);
  }

  private async recalculateSnapshotForUser(
    userId: string,
    profile?: { homeLatitude: unknown; homeLongitude: unknown } | null
  ) {
    const inFlight = this.recalculationsByUser.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const recalculation = this.recalculateSnapshot(userId, profile).finally(() => {
      this.recalculationsByUser.delete(userId);
    });
    this.recalculationsByUser.set(userId, recalculation);
    return recalculation;
  }

  private async recalculateSnapshot(
    userId: string,
    profile?: { homeLatitude: unknown; homeLongitude: unknown } | null
  ) {
    const finds = await this.prisma.find.findMany({
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
      orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }]
    });
    const hides = await this.prisma.hide.findMany({
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
    const stats = calculateStats(
      finds.map((find) => ({
        foundAt: find.foundAt,
        isFtf: find.isFtf,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.statSnapshot.deleteMany({ where: { userId } });
      await tx.statSnapshot.create({
        data: {
          userId,
          statsJson: stats as unknown as Prisma.InputJsonValue
        }
      });
    });

    return stats;
  }

  async ftfFindsForUser(userId: string) {
    const finds = await this.prisma.find.findMany({
      where: { userId },
      include: { cache: true },
      orderBy: [{ foundAt: "desc" }, { createdAt: "desc" }]
    });

    return finds.map((find) => ({
      id: find.id,
      foundAt: find.foundAt.toISOString(),
      isFtf: find.isFtf,
      logText: find.logText,
      cache: {
        gcCode: find.cache.gcCode,
        name: find.cache.name,
        cacheType: find.cache.cacheType,
        country: find.cache.country,
        region: find.cache.region
      }
    }));
  }

  async updateFtfFlag(userId: string, findId: string, isFtf: boolean) {
    const result = await this.prisma.find.updateMany({
      where: { id: findId, userId },
      data: { isFtf }
    });
    if (result.count === 0) {
      throw new NotFoundException("Find not found");
    }

    await this.prisma.statSnapshot.deleteMany({ where: { userId } });
    return { id: findId, isFtf };
  }
}
