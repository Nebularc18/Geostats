import { Prisma, PrismaClient } from "@prisma/client";
import {
  calculateHideStats,
  calculateStats,
  normalizedGcUsername,
} from "@geostats/stats";

type StatsProfile = {
  gcUsername?: string | null;
  homeLatitude: unknown;
  homeLongitude: unknown;
};
type CacheWithUserData = Prisma.CacheGetPayload<{
  include: { userData: true; corrections: true };
}>;

export function countableFindWhere(
  userId: string,
  gcUsername: string | null,
): Prisma.FindWhereInput {
  const filters: Prisma.FindWhereInput[] = [
    {
      cache: {
        hides: {
          none: { userId },
        },
      },
    },
  ];
  if (gcUsername) {
    filters.push({
      cache: {
        OR: [
          { ownerName: null },
          { ownerName: { not: gcUsername, mode: "insensitive" } },
        ],
      },
    });
  }
  return { userId, AND: filters };
}

function elevationFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = (raw as Record<string, unknown>).ele;
  const text =
    value && typeof value === "object" && "text" in value
      ? (value as { text?: unknown }).text
      : value;
  const elevation = Number(text);
  return Number.isFinite(elevation) ? elevation : null;
}

function statsCache(cache: CacheWithUserData) {
  return {
    latitude: Number(cache.corrections[0]?.latitude ?? cache.latitude),
    longitude: Number(cache.corrections[0]?.longitude ?? cache.longitude),
    gcCode: cache.gcCode,
    name: cache.name,
    cacheType: cache.cacheType,
    difficulty: cache.difficulty ? Number(cache.difficulty) : null,
    terrain: cache.terrain ? Number(cache.terrain) : null,
    size: cache.size,
    country: cache.country,
    region: cache.region,
    county: cache.county,
    hiddenDate: cache.hiddenDate,
    ownerName: cache.ownerName,
    elevationMeters: elevationFromRaw(cache.userData[0]?.raw),
    raw: cache.userData[0]?.raw,
  };
}

export async function calculateUserStats(
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string,
  profile?: StatsProfile | null,
) {
  if (profile === undefined) {
    profile = await prisma.geocachingProfile.findUnique({ where: { userId } });
  }
  const hides = await prisma.hide.findMany({
    where: { userId },
    include: {
      cache: {
        include: {
          userData: { where: { userId }, take: 1 },
          corrections: { where: { userId } },
        },
      },
    },
    orderBy: { placedAt: "asc" },
  });
  const ownerFinderCountryStats = await prisma.ownerFinderCountryStat.findMany({
    where: { userId },
    orderBy: [{ count: "desc" }, { country: "asc" }],
  });
  const gcUsername = normalizedGcUsername(profile);
  const finds = await prisma.find.findMany({
    where: countableFindWhere(userId, gcUsername),
    include: {
      cache: {
        include: {
          userData: { where: { userId }, take: 1 },
          corrections: { where: { userId } },
        },
      },
    },
    orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }],
  });
  const stats = calculateStats(
    finds.map((find) => ({
      foundAt: find.foundAt,
      isFtf: find.isFtf,
      logText: find.logText,
      cache: statsCache(find.cache),
    })),
    {
      homeLatitude:
        profile?.homeLatitude == null ? null : Number(profile.homeLatitude),
      homeLongitude:
        profile?.homeLongitude == null ? null : Number(profile.homeLongitude),
    },
  );
  stats.hideStats = calculateHideStats(
    hides.map((hide) => ({
      placedAt: hide.placedAt,
      receivedLogCount: hide.receivedLogCount,
      receivedLogsRaw: hide.receivedLogsRaw,
      cache: statsCache(hide.cache),
    })),
    {
      finderCountryBuckets: ownerFinderCountryStats.map((row) => ({
        key: row.country,
        count: row.count,
      })),
    },
  );
  stats.achievementStats.hostedEventCaches = stats.hideStats.hostedEventCaches;

  return stats;
}
