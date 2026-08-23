import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { countableFindWhere, Prisma } from "@geostats/db";
import { calculateHideStats, calculateStats, normalizedGcUsername, STATS_VERSION } from "@geostats/stats";
import { PrismaService } from "../common/prisma.service";
import { countryExtremes, CountryExtremeEntry } from "./country-extremes";
import { swedenRegionExtremes } from "./sweden-region-extremes";

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

export type ExtremeCacheEntry = {
  gcCode: string;
  name: string;
  cacheType: string | null;
  country: string | null;
  region: string | null;
  latitude: number;
  longitude: number;
  hiddenDate: string | null;
  elevationMeters: number | null;
  found: boolean;
};

export type ReferenceExtremeEntry = CountryExtremeEntry & { found: boolean };

export type ReferenceExtremes = {
  country: string;
  region: string | null;
  extremes: {
    northernmost: ReferenceExtremeEntry;
    southernmost: ReferenceExtremeEntry;
    easternmost: ReferenceExtremeEntry;
    westernmost: ReferenceExtremeEntry;
    highest: ReferenceExtremeEntry;
    lowest: ReferenceExtremeEntry;
  };
};

type ExtremeCacheRow = {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  country: string | null;
  region: string | null;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  hiddenDate: Date | null;
  elevationMeters?: number | bigint | string | null;
};

function toExtremeCache(row: ExtremeCacheRow, foundCacheIds: Set<string>): ExtremeCacheEntry {
  const elevation = row.elevationMeters == null ? null : Number(row.elevationMeters);
  return {
    gcCode: row.gcCode,
    name: row.name,
    cacheType: row.cacheType,
    country: row.country,
    region: row.region,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    hiddenDate: row.hiddenDate ? row.hiddenDate.toISOString().slice(0, 10) : null,
    elevationMeters: elevation != null && Number.isFinite(elevation) ? elevation : null,
    found: foundCacheIds.has(row.id)
  };
}

function elevationExtremeSql(direction: "ASC" | "DESC", region: string | null): string {
  return `
  WITH candidates AS (
    SELECT u."cache_id" AS cache_id,
           CASE WHEN jsonb_typeof(u."raw"->'ele') = 'object'
                THEN u."raw"->'ele'->>'text'
                ELSE u."raw"->>'ele'
           END AS ele_text
    FROM "user_cache_data" u
    WHERE jsonb_typeof(u."raw") = 'object' AND jsonb_exists(u."raw", 'ele')
  ),
  valid AS (
    SELECT cache_id, MAX(CAST(ele_text AS double precision)) AS elevation
    FROM candidates
    WHERE ele_text ~ '^-?[0-9]+([.][0-9]+)?$'
    GROUP BY cache_id
  )
  SELECT c."id"::text AS id, c."gc_code" AS "gcCode", c."name" AS name,
         c."cache_type" AS "cacheType", c."country" AS country, c."region" AS region,
         c."latitude", c."longitude", c."hidden_date" AS "hiddenDate",
         v.elevation AS "elevationMeters"
  FROM "caches" c
  JOIN valid v ON v.cache_id = c."id"
  WHERE ($1::text IS NULL OR c."country" = $1)
    AND ($2::text IS NULL OR c."region" = $2)
  ORDER BY v.elevation ${direction}
  LIMIT 1
`;
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
    const [stats, extremeCaches] = await Promise.all([
      this.snapshotForUser(profile.userId),
      this.extremeCachesForUser(profile.userId, null)
    ]);

    return {
      profile,
      stats: {
        ...stats,
        extremeCaches: extremeCaches.extremes,
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
            userData: { where: { userId }, take: 1 },
            corrections: {
              where: { userId }
            }
          }
        }
      },
      orderBy: { placedAt: "asc" }
    });
    const ownerFinderCountryStats = await prisma.ownerFinderCountryStat.findMany({
      where: { userId },
      orderBy: [{ count: "desc" }, { country: "asc" }]
    });
    const gcUsername = normalizedGcUsername(profile);
    const finds = await prisma.find.findMany({
      where: countableFindWhere(userId, gcUsername),
      include: {
        cache: {
          include: {
            userData: { where: { userId }, take: 1 },
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
          elevationMeters: elevationFromRaw(find.cache.userData[0]?.raw),
          raw: find.cache.userData[0]?.raw
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
          elevationMeters: elevationFromRaw(hide.cache.userData[0]?.raw),
          raw: hide.cache.userData[0]?.raw
        }
      })),
      {
        finderCountryBuckets: ownerFinderCountryStats.map((row) => ({ key: row.country, count: row.count }))
      }
    );
    stats.achievementStats.hostedEventCaches = stats.hideStats.hostedEventCaches;

    return stats;
  }

  private async referenceExtremesFoundFor(
    userId: string,
    label: { country: string; region: string | null },
    entries: {
      northernmost: CountryExtremeEntry;
      southernmost: CountryExtremeEntry;
      easternmost: CountryExtremeEntry;
      westernmost: CountryExtremeEntry;
      highest: CountryExtremeEntry;
      lowest: CountryExtremeEntry;
    }
  ): Promise<ReferenceExtremes> {
    const list = Object.values(entries);
    const caches = await this.prisma.cache.findMany({
      where: { gcCode: { in: list.map((item) => item.gcCode) } },
      select: { id: true, gcCode: true }
    });
    const cacheIdByCode = new Map(caches.map((cache) => [cache.gcCode, cache.id]));

    const foundCacheIds = new Set<string>();
    if (caches.length > 0) {
      const finds = await this.prisma.find.findMany({
        where: { userId, cacheId: { in: caches.map((cache) => cache.id) } },
        select: { cacheId: true },
        distinct: ["cacheId"]
      });
      for (const find of finds) {
        foundCacheIds.add(find.cacheId);
      }
    }

    const toReference = (item: CountryExtremeEntry): ReferenceExtremeEntry => ({
      ...item,
      found: foundCacheIds.has(cacheIdByCode.get(item.gcCode) ?? "")
    });

    return {
      country: label.country,
      region: label.region,
      extremes: {
        northernmost: toReference(entries.northernmost),
        southernmost: toReference(entries.southernmost),
        easternmost: toReference(entries.easternmost),
        westernmost: toReference(entries.westernmost),
        highest: toReference(entries.highest),
        lowest: toReference(entries.lowest)
      }
    };
  }

  private async referenceExtremesFor(userId: string, country: string): Promise<ReferenceExtremes | null> {
    const entry = countryExtremes.find((item) => item.country === country);
    if (!entry) {
      return null;
    }

    return this.referenceExtremesFoundFor(userId, { country: entry.country, region: null }, entry.extremes);
  }

  private async referenceRegionExtremesFor(userId: string, country: string, region: string): Promise<ReferenceExtremes | null> {
    if (country !== "Sweden") {
      return null;
    }
    const entry = swedenRegionExtremes.find((item) => item.region === region);
    if (!entry) {
      return null;
    }

    return this.referenceExtremesFoundFor(userId, { country: entry.country, region: entry.region }, entry.extremes);
  }

  async extremeCachesForUser(userId: string, country?: string | null, region?: string | null) {
    const cleanCountry = country?.trim() || null;
    const cleanRegion = region?.trim() || null;
    const locationWhere: { country?: string; region?: string } = {};
    if (cleanCountry) {
      locationWhere.country = cleanCountry;
    }
    if (cleanRegion) {
      locationWhere.region = cleanRegion;
    }

    const countries = await this.prisma.cache.groupBy({
      by: ["country"],
      where: { country: { not: null } },
      orderBy: { country: "asc" }
    });

    const referenceRegions = cleanCountry
      ? swedenRegionExtremes.filter((item) => item.country === cleanCountry).map((item) => item.region)
      : [];

    const [northernmost, southernmost, easternmost, westernmost, oldest] = await Promise.all([
      this.prisma.cache.findFirst({ where: locationWhere, orderBy: { latitude: "desc" } }),
      this.prisma.cache.findFirst({ where: locationWhere, orderBy: { latitude: "asc" } }),
      this.prisma.cache.findFirst({ where: locationWhere, orderBy: { longitude: "desc" } }),
      this.prisma.cache.findFirst({ where: locationWhere, orderBy: { longitude: "asc" } }),
      this.prisma.cache.findFirst({
        where: { ...locationWhere, hiddenDate: { not: null } },
        orderBy: { hiddenDate: "asc" }
      })
    ]);

    const [highestRows, lowestRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(elevationExtremeSql("DESC", cleanRegion), cleanCountry, cleanRegion),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(elevationExtremeSql("ASC", cleanRegion), cleanCountry, cleanRegion)
    ]);

    const rows = [northernmost, southernmost, easternmost, westernmost, oldest, highestRows[0], lowestRows[0]].filter(
      (row): row is ExtremeCacheRow => row != null
    );
    const foundCacheIds = new Set<string>();
    if (rows.length > 0) {
      const finds = await this.prisma.find.findMany({
        where: { userId, cacheId: { in: rows.map((row) => row.id) } },
        select: { cacheId: true },
        distinct: ["cacheId"]
      });
      for (const find of finds) {
        foundCacheIds.add(find.cacheId);
      }
    }

    const reference =
      cleanCountry && cleanRegion
        ? await this.referenceRegionExtremesFor(userId, cleanCountry, cleanRegion)
        : cleanCountry
          ? await this.referenceExtremesFor(userId, cleanCountry)
          : null;

    return {
      countries: countries.map((row) => row.country).filter((name): name is string => name != null),
      selectedCountry: cleanCountry,
      selectedRegion: cleanRegion,
      referenceRegions,
      reference,
      extremes: {
        northernmost: northernmost ? toExtremeCache(northernmost, foundCacheIds) : null,
        southernmost: southernmost ? toExtremeCache(southernmost, foundCacheIds) : null,
        easternmost: easternmost ? toExtremeCache(easternmost, foundCacheIds) : null,
        westernmost: westernmost ? toExtremeCache(westernmost, foundCacheIds) : null,
        highestElevation: highestRows[0] ? toExtremeCache(highestRows[0], foundCacheIds) : null,
        lowestElevation: lowestRows[0] ? toExtremeCache(lowestRows[0], foundCacheIds) : null,
        oldest: oldest ? toExtremeCache(oldest, foundCacheIds) : null
      }
    };
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
