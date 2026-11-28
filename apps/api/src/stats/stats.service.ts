import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { calculateUserStats, countableFindWhere, personalCacheMetadata, Prisma } from "@geostats/db";
import { mysteryFinalCoordinate, validCoordinatePair } from "@geostats/shared";
import { hideLogs, normalizedGcUsername, STATS_VERSION } from "@geostats/stats";
import { PrismaService } from "../common/prisma.service";
import { countryExtremes, CountryExtremeEntry } from "./country-extremes";
import { swedenRegionExtremes } from "./sweden-region-extremes";
import { friendComparisonStats } from "./friend-comparison";
import { MAX_ELEVATION_METERS, MAX_ELEVATION_TEXT_LENGTH, MIN_ELEVATION_METERS } from "../common/elevation";

const DEFAULT_FTF_FIND_LIMIT = 100;
const MAX_FTF_FIND_LIMIT = 200;
const MAX_FTF_LOG_TEXT_LENGTH = 1_000;
// PostgreSQL's POSIX space class does not include every code point removed by
// JavaScript trim(), so include the remaining ECMAScript whitespace characters
// explicitly when matching legacy profile values.
const USERNAME_TRIM_WHITESPACE = "\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const USERNAME_TRIM_PATTERN = `^[[:space:]${USERNAME_TRIM_WHITESPACE}]+|[[:space:]${USERNAME_TRIM_WHITESPACE}]+$`;
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
    difficulty: Prisma.Decimal | number | null;
    terrain: Prisma.Decimal | number | null;
    size: string | null;
    country: string | null;
    region: string | null;
    metadataTrusted?: boolean;
    userData?: Array<{ raw: unknown }>;
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
  hiddenDate: Date | string | null;
  elevationMeters?: number | bigint | string | null;
};

function toExtremeCache(row: ExtremeCacheRow, foundCacheIds: Set<string>): ExtremeCacheEntry {
  const elevation = row.elevationMeters == null ? null : Number(row.elevationMeters);
  const hiddenDate = row.hiddenDate ? new Date(row.hiddenDate) : null;
  return {
    gcCode: row.gcCode,
    name: row.name,
    cacheType: row.cacheType,
    country: row.country,
    region: row.region,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    hiddenDate: hiddenDate && Number.isFinite(hiddenDate.getTime()) ? hiddenDate.toISOString().slice(0, 10) : null,
    elevationMeters: elevation != null && Number.isFinite(elevation) ? elevation : null,
    found: foundCacheIds.has(row.id)
  };
}

// Bind $3 to the requesting account. Private metadata never enters the shared catalog.
export function effectiveExtremeCachesSql(): string {
  const coordinate = (key: string, maximum: number) => `CASE
    WHEN length(m->>'${key}') <= 32 AND m->>'${key}' ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$'
    THEN CASE WHEN (m->>'${key}')::double precision BETWEEN -${maximum} AND ${maximum}
              THEN (m->>'${key}')::double precision END END`;
  return `effective_caches AS (
    SELECT c.id, c.gc_code, c.name, c.cache_type, c.country, c.region,
           c.latitude::double precision, c.longitude::double precision, to_char(c.hidden_date, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hidden_date
    FROM caches c WHERE c.metadata_trusted = true
    UNION ALL
    SELECT c.id, c.gc_code, COALESCE(m->>'name', c.gc_code), m->>'cacheType',
           NULLIF(btrim(m->>'country'), ''), NULLIF(btrim(m->>'region'), ''),
           ${coordinate("latitude", 90)}, ${coordinate("longitude", 180)}, m->>'hiddenDate'
    FROM caches c JOIN user_cache_data u ON u.cache_id = c.id AND u.user_id = $3
    CROSS JOIN LATERAL (SELECT u.raw->'geostatsMetadata' AS m) metadata
    WHERE c.metadata_trusted = false
  )`;
}

export function locationExtremeSql(field: "latitude" | "longitude" | "hidden_date", direction: "ASC" | "DESC"): string {
  return `WITH ${effectiveExtremeCachesSql()}
    SELECT id::text, gc_code AS "gcCode", name, cache_type AS "cacheType", country, region,
           latitude, longitude, hidden_date AS "hiddenDate"
    FROM effective_caches
    WHERE ($1::text IS NULL OR country = $1) AND ($2::text IS NULL OR region = $2)
      AND latitude IS NOT NULL AND longitude IS NOT NULL
      ${field === "hidden_date" ? "AND hidden_date IS NOT NULL" : ""}
    ORDER BY ${field} ${direction}, id LIMIT 1`;
}

export function elevationExtremeSql(direction: "ASC" | "DESC", region: string | null): string {
  return `
  WITH ${effectiveExtremeCachesSql()}, candidates AS (
    SELECT u."cache_id" AS cache_id,
           CASE WHEN jsonb_typeof(u."raw"->'ele') = 'object'
                THEN u."raw"->'ele'->>'text'
                ELSE u."raw"->>'ele'
           END AS ele_text
    FROM "user_cache_data" u
    WHERE u."user_id" = $3 AND jsonb_typeof(u."raw") = 'object' AND jsonb_exists(u."raw", 'ele')
  ),
  converted AS (
    SELECT cache_id,
           CASE WHEN length(ele_text) <= ${MAX_ELEVATION_TEXT_LENGTH}
                     AND ele_text ~ '^-?[0-9]+([.][0-9]+)?$'
                THEN CAST(ele_text AS double precision)
                ELSE NULL
           END AS elevation
    FROM candidates
  ),
  valid AS (
    SELECT cache_id, MAX(elevation) AS elevation
    FROM converted
    WHERE elevation BETWEEN ${MIN_ELEVATION_METERS} AND ${MAX_ELEVATION_METERS}
    GROUP BY cache_id
  )
  SELECT c."id"::text AS id, c."gc_code" AS "gcCode", c."name" AS name,
         c."cache_type" AS "cacheType", c."country" AS country, c."region" AS region,
         c."latitude", c."longitude", c."hidden_date" AS "hiddenDate",
         v.elevation AS "elevationMeters"
  FROM effective_caches c
  JOIN valid v ON v.cache_id = c."id"
  WHERE ($1::text IS NULL OR c."country" = $1)
    AND ($2::text IS NULL OR c."region" = $2)
    AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
  ORDER BY v.elevation ${direction}
  LIMIT 1
`;
}

@Injectable()
export class StatsService {
  private readonly recalculationsByUser = new Map<string, Promise<any>>();

  constructor(private readonly prisma: PrismaService) {}

  async snapshotForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId }
    });
    const latest = await this.prisma.statSnapshot.findFirst({
      where: { userId, serverGenerated: true },
      orderBy: { generatedAt: "desc" }
    });
    if (latest) {
      const stats = latest.statsJson as any;
      const needsHomeDistance = profile?.homeLatitude != null && profile.homeLongitude != null && !stats.distanceStats;
      const maintenanceNeedsRefresh = stats.hideStats?.activeHides > 0 &&
        latest.generatedAt.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);
      if (stats.statsVersion === STATS_VERSION && !needsHomeDistance && !maintenanceNeedsRefresh) {
        return stats;
      }

      return this.recalculateSnapshotForUser(userId, profile);
    }

    return this.recalculateSnapshotForUser(userId, profile);
  }

  async profileSnapshotForUser(userId: string) {
    const [profile, stats] = await Promise.all([
      this.prisma.geocachingProfile.findUnique({
        where: { userId },
        select: { gcUsername: true }
      }),
      this.snapshotForUser(userId)
    ]);

    return {
      profile: { gcUsername: profile?.gcUsername?.trim() || "Geocacher" },
      stats
    };
  }

  private async friendProfileForUsername(username: string) {
    const normalizedUsername = normalizedGcUsername(username);
    if (!normalizedUsername) {
      throw new NotFoundException("No matching profile has enabled friend sharing");
    }

    const profiles = await this.prisma.$queryRaw<Array<{ userId: string; gcUsername: string; friendStatsEnabled: boolean }>>(Prisma.sql`
      SELECT "user_id" AS "userId", "gc_username" AS "gcUsername", "friend_stats_enabled" AS "friendStatsEnabled"
      FROM "geocaching_profiles"
      WHERE LOWER(REGEXP_REPLACE("gc_username", ${USERNAME_TRIM_PATTERN}, '', 'g')) = ${normalizedUsername}
      LIMIT 2
    `);

    if (profiles.length !== 1 || !profiles[0]?.friendStatsEnabled) {
      throw new NotFoundException("No matching profile has enabled friend sharing");
    }
    return profiles[0];
  }

  async publicSnapshotForLink(username?: string, profileId?: string) {
    const legacyAlias = normalizedGcUsername(username);
    const identity = profileId ? { id: profileId } : legacyAlias ? { legacyPublicStatsUsername: legacyAlias } : null;
    if (!identity) throw new NotFoundException("Profile not found");
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: {
        ...identity,
        publicStatsEnabled: true
      },
      select: { id: true, userId: true, gcUsername: true }
    });
    if (!profile) throw new NotFoundException("Profile not found");
    const [stats, latestImport, extremeCaches] = await Promise.all([
      this.snapshotForUser(profile.userId),
      this.prisma.import.findFirst({
        where: { userId: profile.userId, status: "COMPLETED" },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { createdAt: true, updatedAt: true }
      }),
      this.extremeCachesForUser(profile.userId, null)
    ]);

    return {
      profile,
      stats: {
        ...stats,
        latestImportAt: latestImport?.updatedAt?.toISOString() ?? latestImport?.createdAt?.toISOString() ?? null,
        extremeCaches: extremeCaches.extremes
      }
    };
  }

  async friendComparisonForUser(userId: string, username: string) {
    const friendProfile = await this.friendProfileForUsername(username);
    if (friendProfile.userId === userId) {
      throw new BadRequestException("Enter another geocaching username");
    }
    const [ownProfile, ownStats, friendStats, ownLatestImport] = await Promise.all([
      this.prisma.geocachingProfile.findUnique({
        where: { userId },
        select: { gcUsername: true }
      }),
      this.snapshotForUser(userId),
      this.snapshotForUser(friendProfile.userId),
      this.prisma.import.findFirst({
        where: { userId, status: "COMPLETED" },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        select: { createdAt: true, updatedAt: true }
      })
    ]);

    if (!ownProfile) {
      throw new NotFoundException("Profile not found");
    }
    const [ownFindIds, friendFindIds] = await Promise.all([
      this.prisma.find.findMany({
        where: { userId },
        select: {
          cacheId: true,
          foundAt: true,
          cache: {
            select: {
              gcCode: true,
              name: true,
              cacheType: true,
              difficulty: true,
              terrain: true,
              country: true
            }
          }
        },
        orderBy: { foundAt: "desc" }
      }),
      this.prisma.find.findMany({
        where: { userId: friendProfile.userId, user: { profile: { is: { friendStatsEnabled: true } } } },
        distinct: ["cacheId"],
        select: { cacheId: true }
      })
    ]);

    const friendCacheIds = new Set(friendFindIds.map((item) => item.cacheId));
    const sharedFinds = ownFindIds
      .filter((item) => friendCacheIds.has(item.cacheId))
      .map((item) => ({
        gcCode: item.cache.gcCode,
        name: item.cache.name,
        cacheType: item.cache.cacheType,
        difficulty: item.cache.difficulty === null ? null : Number(item.cache.difficulty),
        terrain: item.cache.terrain === null ? null : Number(item.cache.terrain),
        country: item.cache.country,
        yourFoundAt: item.foundAt.toISOString()
      }));

    const dtKeys = (stats: any) =>
      new Set<string>(
        Array.isArray(stats?.difficultyTerrain)
          ? stats.difficultyTerrain
              .filter((cell: any) => Number(cell?.count ?? 0) > 0)
              .map((cell: any) => `${Number(cell.difficulty).toFixed(1)}/${Number(cell.terrain).toFixed(1)}`)
          : []
      );
    const jasmerKeys = (stats: any) =>
      new Set<string>(
        Array.isArray(stats?.hiddenMonthMatrix)
          ? stats.hiddenMonthMatrix
              .filter((entry: any) => Number(entry?.count ?? 0) > 0 && typeof entry?.key === "string")
              .map((entry: any) => entry.key)
          : []
      );

    const ownDt = dtKeys(ownStats);
    const friendDt = dtKeys(friendStats);
    const dtBoth = [...ownDt].filter((key) => friendDt.has(key)).length;

    const ownJasmer = jasmerKeys(ownStats);
    const friendJasmer = jasmerKeys(friendStats);
    const jasmerBoth = [...ownJasmer].filter((key) => friendJasmer.has(key)).length;

    return {
      you: {
        username: ownProfile.gcUsername,
        latestImportAt: ownLatestImport?.updatedAt?.toISOString() ?? ownLatestImport?.createdAt?.toISOString() ?? null,
        stats: friendComparisonStats(ownStats)
      },
      friend: {
        username: friendProfile.gcUsername,
        latestImportAt: null,
        stats: friendComparisonStats(friendStats)
      },
      sharedFindsCount: sharedFinds.length,
      recentSharedFinds: sharedFinds.slice(0, 25),
      dtOverlap: {
        both: dtBoth,
        onlyYou: ownDt.size - dtBoth,
        onlyFriend: friendDt.size - dtBoth
      },
      jasmerOverlap: {
        both: jasmerBoth,
        onlyYou: ownJasmer.size - jasmerBoth,
        onlyFriend: friendJasmer.size - jasmerBoth
      }
    };
  }

  async savedFriendsForUser(userId: string) {
    const [ownProfile, ownStats, savedRows] = await Promise.all([
      this.prisma.geocachingProfile.findUnique({
        where: { userId },
        select: { gcUsername: true, friendStatsEnabled: true }
      }),
      this.snapshotForUser(userId),
      this.prisma.savedFriend.findMany({
        where: { userId, friendUser: { profile: { is: { friendStatsEnabled: true } } } },
        orderBy: { createdAt: "desc" },
        select: {
          friendUserId: true,
          friendUser: {
            select: {
              profile: { select: { gcUsername: true } }
            }
          }
        }
      })
    ]);

    const friendEntries = await Promise.all(
      savedRows
        .filter((row) => row.friendUser.profile?.gcUsername)
        .map(async (row) => {
          const stats = await this.snapshotForUser(row.friendUserId);
          return {
            username: row.friendUser.profile!.gcUsername,
            isYou: false,
            stats: friendComparisonStats(stats)
          };
        })
    );

    const leaderboard = [
      ...(ownProfile
        ? [{ username: ownProfile.gcUsername, isYou: true, stats: friendComparisonStats(ownStats) }]
        : []),
      ...friendEntries
    ];

    return {
      accountId: userId,
      friendStatsEnabled: ownProfile?.friendStatsEnabled ?? false,
      friends: friendEntries.map((entry) => entry.username),
      leaderboard
    };
  }

  async saveFriendForUser(userId: string, username: string) {
    const target = await this.friendProfileForUsername(username);
    if (target.userId === userId) {
      throw new BadRequestException("Enter another geocaching username");
    }
    await this.prisma.savedFriend.upsert({
      where: { userId_friendUserId: { userId, friendUserId: target.userId } },
      create: { userId, friendUserId: target.userId },
      update: {}
    });
    return this.savedFriendsForUser(userId);
  }

  async removeSavedFriendForUser(userId: string, username: string) {
    const normalized = normalizedGcUsername(username);
    if (!normalized) {
      return this.savedFriendsForUser(userId);
    }
    const savedRows = await this.prisma.savedFriend.findMany({
      where: { userId },
      select: {
        id: true,
        friendUser: { select: { profile: { select: { gcUsername: true } } } }
      }
    });
    const toDelete = savedRows
      .filter((row) => normalizedGcUsername(row.friendUser.profile?.gcUsername) === normalized)
      .map((row) => row.id);
    if (toDelete.length > 0) {
      await this.prisma.savedFriend.deleteMany({ where: { userId, id: { in: toDelete } } });
    }
    return this.savedFriendsForUser(userId);
  }

  async cacheDetailForUser(userId: string, rawGcCode: string) {
    const gcCode = rawGcCode.trim().toUpperCase();
    if (!/^GC[A-Z0-9]{2,12}$/.test(gcCode)) {
      throw new BadRequestException("Invalid GC code");
    }

    const [cache, mysteryWorkspace, trackableLogs] = await Promise.all([
      this.prisma.cache.findUnique({
        where: {
          gcCode,
          OR: [
            { metadataTrusted: true }, { userData: { some: { userId } } },
            { finds: { some: { userId } } }, { hides: { some: { userId } } },
            { corrections: { some: { userId } } }
          ]
        },
        include: {
          finds: { where: { userId }, orderBy: { foundAt: "desc" }, take: 5 },
          hides: { where: { userId }, take: 1 },
          corrections: { where: { userId }, take: 1 },
          userData: { where: { userId }, take: 1, select: { raw: true } }
        }
      }),
      this.prisma.mysteryWorkspace.findFirst({
        where: { ownerId: userId, gcCode },
        select: { id: true, clientId: true, data: true, updatedAt: true }
      }),
      this.prisma.trackableLog.findMany({
        where: { userId, gcCode },
        orderBy: { loggedAt: "desc" },
        take: 15,
        select: {
          id: true,
          logType: true,
          loggedAt: true,
          trackable: { select: { trackingCode: true, name: true, state: true } }
        }
      })
    ]);

    if (!cache && !mysteryWorkspace) {
      throw new NotFoundException(`No local Geostats data found for ${gcCode}`);
    }

    const personal = cache ? personalCacheMetadata(cache, cache.userData?.[0]?.raw) : null;
    const merged = cache ? { ...cache, ...personal } : null;
    const correction = cache?.corrections[0] ?? null;
    const mysteryData = (mysteryWorkspace?.data ?? null) as any;

    const workspaceFinal = mysteryFinalCoordinate(mysteryData?.attempts);
    const workspacePublished = validCoordinatePair(mysteryData?.publishedLatitude, mysteryData?.publishedLongitude);
    const published = (cache?.metadataTrusted && merged
      ? validCoordinatePair(Number(merged.latitude), Number(merged.longitude))
      : validCoordinatePair(personal?.latitude, personal?.longitude)) ?? workspacePublished;
    const final = (correction ? validCoordinatePair(Number(correction.latitude), Number(correction.longitude)) : null) ?? workspaceFinal;

    let friendsWhoFound: Array<{ username: string }> = [];
    if (cache) {
      const friendFinds = await this.prisma.find.findMany({
        where: {
          cacheId: cache.id,
          user: { savedByFriends: { some: { userId } }, profile: { is: { friendStatsEnabled: true } } }
        },
        distinct: ["userId"],
        select: { userId: true, user: { select: { profile: { select: { gcUsername: true } } } } }
      });
      friendsWhoFound = friendFinds.flatMap(({ user }) => user.profile ? [{ username: user.profile.gcUsername }] : []);
    }

    const latestFind = cache?.finds[0] ?? null;
    const hide = cache?.hides[0] ?? null;

    return {
      gcCode,
      cache: merged
        ? {
            id: cache!.id,
            gcCode: merged.gcCode,
            name: merged.name,
            cacheType: merged.cacheType ?? null,
            difficulty: merged.difficulty == null ? null : Number(merged.difficulty),
            terrain: merged.terrain == null ? null : Number(merged.terrain),
            size: merged.size ?? null,
            latitude: published?.latitude ?? null,
            longitude: published?.longitude ?? null,
            correctedLatitude: final?.latitude ?? null,
            correctedLongitude: final?.longitude ?? null,
            country: merged.country ?? null,
            region: merged.region ?? null,
            county: merged.county ?? null,
            hiddenDate: merged.hiddenDate ? merged.hiddenDate.toISOString().slice(0, 10) : null,
            ownerName: merged.ownerName ?? null
          }
        : {
            id: mysteryWorkspace!.id,
            gcCode,
            name: String(mysteryData?.name ?? gcCode),
            cacheType: "Mystery Cache",
            difficulty: null,
            terrain: null,
            size: null,
            latitude: published?.latitude ?? null,
            longitude: published?.longitude ?? null,
            correctedLatitude: final?.latitude ?? null,
            correctedLongitude: final?.longitude ?? null,
            country: mysteryData?.country ?? null,
            region: mysteryData?.region ?? null,
            county: mysteryData?.county ?? null,
            hiddenDate: null,
            ownerName: null
          },
      find: latestFind
        ? {
            id: latestFind.id,
            foundAt: latestFind.foundAt.toISOString(),
            foundDate: latestFind.foundAt.toISOString().slice(0, 10),
            isFtf: latestFind.isFtf,
            logText: latestFind.logText ?? null
          }
        : null,
      hide: hide
        ? {
            id: hide.id,
            placedAt: hide.placedAt ? hide.placedAt.toISOString().slice(0, 10) : null,
            receivedLogCount: hide.receivedLogCount,
            receivedLogs: hideLogs({ receivedLogsRaw: hide.receivedLogsRaw, cache: merged! })
              .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)
          }
        : null,
      mystery: mysteryData
        ? {
            clientId: mysteryWorkspace!.clientId,
            status: mysteryData.status ?? "solving",
            notes: mysteryData.notes ?? "",
            fieldNotes: mysteryData.fieldNotes ?? "",
            clues: Array.isArray(mysteryData.clues) ? mysteryData.clues : [],
            attemptsCount: Array.isArray(mysteryData.attempts) ? mysteryData.attempts.length : 0,
            updatedAt: mysteryWorkspace!.updatedAt.toISOString()
          }
        : null,
      friendsWhoFound,
      trackables: trackableLogs.map((log) => ({
        id: log.id,
        trackingCode: log.trackable.trackingCode,
        name: log.trackable.name,
        state: log.trackable.state,
        logType: log.logType,
        loggedAt: log.loggedAt.toISOString().slice(0, 10)
      }))
    };
  }

  async findsForUser(
    userId: string,
    query: {
      q?: string;
      cacheType?: string;
      size?: string;
      country?: string;
      region?: string;
      county?: string;
      difficulty?: number;
      terrain?: number;
      foundMonthDay?: string;
      hiddenYearMonth?: string;
      year?: string;
      owner?: string;
      ftfOnly?: boolean;
      sort?: string;
      offset?: number;
      limit?: number;
      includeFacets?: boolean;
    }
  ) {
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
    const gcUsername = normalizedGcUsername(profile);
    const safeLimit = Math.min(Math.max(1, Number.isFinite(query.limit) ? Math.floor(query.limit!) : 50), 200);
    const safeOffset = Math.max(0, Number.isFinite(query.offset) ? Math.floor(query.offset!) : 0);
    const sort = query.sort ?? "foundAt_desc";
    const q = query.q?.trim().toLowerCase() ?? "";
    const year = query.year?.trim();
    const where: Prisma.FindWhereInput = {
      ...countableFindWhere(userId, gcUsername),
      ...(query.ftfOnly ? { isFtf: true } : {}),
      ...(year && /^[0-9]{4}$/.test(year) && year !== "9999" ? {
        foundAt: {
          gte: new Date(`${year}-01-01T00:00:00Z`),
          lt: new Date(`${String(Number(year) + 1).padStart(4, "0")}-01-01T00:00:00Z`)
        }
      } : {})
    };

    const token = q.match(/[a-z0-9]{2,}/g)?.sort((a, b) => b.length - a.length)[0];
    if (token) {
      // A contiguous alphanumeric token cannot span two fields in the rendered
      // search text. Narrow candidates in SQL, then match the exact text in JS
      // so legacy imports and phrases across fields still work.
      const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT f.id
        FROM finds f
        JOIN caches c ON c.id = f.cache_id
        LEFT JOIN user_cache_data u ON u.cache_id = c.id AND u.user_id = f.user_id
          AND NOT c.metadata_trusted
        WHERE f.user_id = ${userId}
          AND strpos(lower(concat_ws(' ', c.gc_code, c.name, c.owner_name,
            c.country, c.region, c.county, f.log_text, u.raw::text)), ${token}) > 0
        LIMIT 2001
      `;
      if (candidates.length <= 2000) where.id = { in: candidates.map(({ id }) => id) };
    }

    const useDatabasePage = !gcUsername && !q && !query.cacheType && !query.size && !query.country &&
      !query.region && !query.county && query.difficulty === undefined && query.terrain === undefined &&
      !query.foundMonthDay && !query.hiddenYearMonth && !year && !query.owner &&
      (sort === "foundAt_desc" || sort === "foundAt_asc") && safeOffset <= 2_147_483_647;
    const includeLogs = Boolean(q) || sort === "logLength_desc";
    const [rows, count, snapshot] = await Promise.all([
      this.prisma.find.findMany({
        where,
        ...(useDatabasePage ? { skip: safeOffset, take: safeLimit } : {}),
        select: {
          id: true,
          foundAt: true,
          isFtf: true,
          logText: includeLogs,
          cache: {
            select: {
              id: true,
              gcCode: true,
              name: true,
              cacheType: true,
              difficulty: true,
              terrain: true,
              size: true,
              latitude: true,
              longitude: true,
              country: true,
              region: true,
              county: true,
              hiddenDate: true,
              ownerName: true,
              metadataTrusted: true,
              userData: { where: { userId }, take: 1, select: { raw: true } }
            }
          }
        },
        orderBy: [{ foundAt: sort === "foundAt_asc" ? "asc" : "desc" }, { id: "desc" }]
      }),
      useDatabasePage ? this.prisma.find.count({ where }) : null,
      query.includeFacets === false ? null : this.snapshotForUser(userId)
    ]);

    const normalized = rows
      .map((find) => {
        const merged = {
          ...find.cache,
          ...personalCacheMetadata(find.cache, find.cache.userData?.[0]?.raw)
        };
        return {
          id: find.id,
          foundAt: find.foundAt.toISOString(),
          foundDate: find.foundAt.toISOString().slice(0, 10),
          foundMonthDay: find.foundAt.toISOString().slice(5, 10),
          foundYear: find.foundAt.toISOString().slice(0, 4),
          isFtf: find.isFtf,
          logText: find.logText ?? null,
          gcCode: merged.gcCode,
          name: merged.name,
          cacheType: merged.cacheType ?? null,
          difficulty: merged.difficulty === null || merged.difficulty === undefined ? null : Number(merged.difficulty),
          terrain: merged.terrain === null || merged.terrain === undefined ? null : Number(merged.terrain),
          size: merged.size ?? null,
          latitude: Number(merged.latitude),
          longitude: Number(merged.longitude),
          country: merged.country ?? null,
          region: merged.region ?? null,
          county: merged.county ?? null,
          hiddenDate: merged.hiddenDate ? merged.hiddenDate.toISOString().slice(0, 10) : null,
          hiddenYearMonth: merged.hiddenDate ? merged.hiddenDate.toISOString().slice(0, 7) : null,
          ownerName: merged.ownerName ?? null
        };
      })
      .filter((item) => !gcUsername || !item.ownerName || item.ownerName.trim().toLowerCase() !== gcUsername);

    const keys = (buckets: Array<{ key: string }> | undefined) =>
      (buckets ?? []).map(({ key }) => key).filter((key) => key !== "Unknown").sort();
    const cacheTypes = keys(snapshot?.cacheTypes);
    const countries = keys(snapshot?.countries);
    const years = keys(snapshot?.findsByYear).reverse();

    const filtered = normalized.filter((item) => {
      if (q) {
        const haystack = [item.gcCode, item.name, item.ownerName, item.logText, item.country, item.region, item.county]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (query.cacheType && item.cacheType?.toLowerCase() !== query.cacheType.trim().toLowerCase()) return false;
      if (query.size && item.size?.toLowerCase() !== query.size.trim().toLowerCase()) return false;
      if (query.country && item.country?.toLowerCase() !== query.country.trim().toLowerCase()) return false;
      if (query.region && item.region?.toLowerCase() !== query.region.trim().toLowerCase()) return false;
      if (query.county && item.county?.toLowerCase() !== query.county.trim().toLowerCase()) return false;
      if (query.difficulty !== undefined && Number.isFinite(query.difficulty) && item.difficulty !== query.difficulty) return false;
      if (query.terrain !== undefined && Number.isFinite(query.terrain) && item.terrain !== query.terrain) return false;
      if (query.foundMonthDay && item.foundMonthDay !== query.foundMonthDay.trim()) return false;
      if (query.hiddenYearMonth && item.hiddenYearMonth !== query.hiddenYearMonth.trim()) return false;
      if (query.year && item.foundYear !== query.year.trim()) return false;
      if (query.owner && item.ownerName?.toLowerCase() !== query.owner.trim().toLowerCase()) return false;
      if (query.ftfOnly && !item.isFtf) return false;
      return true;
    });

    if (sort === "dt_desc") {
      filtered.sort(
        (a, b) =>
          (b.difficulty ?? 0) + (b.terrain ?? 0) - ((a.difficulty ?? 0) + (a.terrain ?? 0)) ||
          b.foundAt.localeCompare(a.foundAt)
      );
    } else if (sort === "logLength_desc") {
      filtered.sort((a, b) => (b.logText?.length ?? 0) - (a.logText?.length ?? 0) || b.foundAt.localeCompare(a.foundAt));
    }

    const page = useDatabasePage ? filtered : filtered.slice(safeOffset, safeOffset + safeLimit);
    const total = count ?? filtered.length;
    if (!includeLogs && page.length > 0) {
      const logs = await this.prisma.find.findMany({
        where: { userId, id: { in: page.map(({ id }) => id) } },
        select: { id: true, logText: true }
      });
      const logById = new Map(logs.map(({ id, logText }) => [id, logText]));
      for (const find of page) find.logText = logById.get(find.id) ?? null;
    }

    return {
      finds: page,
      total,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + page.length < total,
      facets: { cacheTypes, countries, years }
    };
  }

  async buildSnapshotForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId }
    });
    return calculateUserStats(this.prisma, userId, profile);
  }

  async replaceSnapshotForUser(userId: string, stats: unknown, prisma: PrismaClientLike = this.prisma) {
    await prisma.statSnapshot.deleteMany({ where: { userId } });
    await prisma.statSnapshot.create({
      data: {
        userId,
        statsJson: stats as Prisma.InputJsonValue,
        serverGenerated: true
      }
    });
  }

  private async recalculateSnapshotForUser(
    userId: string,
    profile?: {
      gcUsername?: string | null;
      homeLatitude: unknown;
      homeLongitude: unknown;
    } | null
  ) {
    const inFlight = this.recalculationsByUser.get(userId);
    if (inFlight) {
      return inFlight;
    }

    const recalculation = calculateUserStats(this.prisma, userId, profile)
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

  private async foundCacheIdsFor(userId: string, cacheIds: string[]): Promise<Set<string>> {
    const foundCacheIds = new Set<string>();
    if (cacheIds.length === 0) {
      return foundCacheIds;
    }
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
    const finds = await this.prisma.find.findMany({
      where: {
        ...countableFindWhere(userId, normalizedGcUsername(profile)),
        cacheId: { in: cacheIds }
      },
      select: { cacheId: true },
      distinct: ["cacheId"]
    });
    for (const find of finds) {
      foundCacheIds.add(find.cacheId);
    }
    return foundCacheIds;
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

    const foundCacheIds = await this.foundCacheIdsFor(
      userId,
      caches.map((cache) => cache.id)
    );

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
    const countries = await this.prisma.$queryRawUnsafe<Array<{ country: string }>>(
      `WITH ${effectiveExtremeCachesSql()} SELECT DISTINCT country FROM effective_caches
       WHERE country IS NOT NULL AND btrim(country) <> ''
         AND ($1::text IS NULL OR country = $1) AND ($2::text IS NULL OR region = $2) ORDER BY country`, null, null, userId
    );

    const referenceRegions = cleanCountry ? swedenRegionExtremes.filter((item) => item.country === cleanCountry).map((item) => item.region) : [];

    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
    const firstHomeFind = await this.prisma.find.findFirst({
      where: {
        ...countableFindWhere(userId, normalizedGcUsername(profile)),
        cache: { OR: [
          { metadataTrusted: true, country: { not: null } },
          { metadataTrusted: false, userData: { some: { userId, AND: [
            { raw: { path: ["geostatsMetadata", "country"], not: "" } },
            { raw: { path: ["geostatsMetadata", "country"], not: Prisma.JsonNull } }
          ] } } }
        ] }
      },
      orderBy: [{ foundAt: "asc" }, { id: "asc" }],
      select: { cache: { select: { country: true, metadataTrusted: true, userData: { where: { userId }, take: 1, select: { raw: true } } } } }
    });
    const homeCache = firstHomeFind ? { ...firstHomeFind.cache, ...personalCacheMetadata(firstHomeFind.cache, firstHomeFind.cache.userData?.[0]?.raw) } : null;
    const homeCountry = homeCache?.country?.trim() || null;

    const [northRows, southRows, eastRows, westRows, oldestRows, highestRows, lowestRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(locationExtremeSql("latitude", "DESC"), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(locationExtremeSql("latitude", "ASC"), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(locationExtremeSql("longitude", "DESC"), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(locationExtremeSql("longitude", "ASC"), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(locationExtremeSql("hidden_date", "ASC"), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(elevationExtremeSql("DESC", cleanRegion), cleanCountry, cleanRegion, userId),
      this.prisma.$queryRawUnsafe<ExtremeCacheRow[]>(elevationExtremeSql("ASC", cleanRegion), cleanCountry, cleanRegion, userId)
    ]);
    const [northernmost, southernmost, easternmost, westernmost, oldest] = [northRows[0], southRows[0], eastRows[0], westRows[0], oldestRows[0]];

    const rows = [northernmost, southernmost, easternmost, westernmost, oldest, highestRows[0], lowestRows[0]].filter((row): row is ExtremeCacheRow => row != null);
    const foundCacheIds = await this.foundCacheIdsFor(
      userId,
      rows.map((row) => row.id)
    );

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
      homeCountry,
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
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
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
              difficulty: true,
              terrain: true,
              size: true,
              country: true,
              region: true,
              metadataTrusted: true,
              userData: { where: { userId }, take: 1, select: { raw: true } }
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
    const effectiveFinds = finds.map((find) => ({ ...find, cache: {
      ...find.cache,
      ...personalCacheMetadata(find.cache, find.cache.userData?.[0]?.raw)
    } })).filter((find) => !gcUsername || !find.cache.ownerName || find.cache.ownerName.trim().toLowerCase() !== gcUsername);
    const page = effectiveFinds.slice(0, limit);

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
          difficulty: find.cache.difficulty == null ? null : Number(find.cache.difficulty),
          terrain: find.cache.terrain == null ? null : Number(find.cache.terrain),
          size: find.cache.size,
          country: find.cache.country,
          region: find.cache.region
        }
      })),
      nextCursor: finds.length > limit ? (effectiveFinds.length > limit ? page.at(-1)?.id : finds.at(-1)?.id) ?? null : null
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
