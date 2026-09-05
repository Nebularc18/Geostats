import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthUser, ImportSource, ImportStatus } from "@geostats/shared";
import { Prisma } from "@geostats/db";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../common/prisma.service";
import {
  ImportQueueRejectedError,
  ImportQueueService,
} from "../queue/import-queue.service";
import { StatsService } from "../stats/stats.service";
import { StorageService } from "../storage/storage.service";

const STALE_IMPORT_AGE_MS = 30 * 60 * 1_000;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;

type MissingCacheSource =
  | "trackableLogs"
  | "mysteryWorkspaces"
  | "challengeCheckers";

type MissingCacheCandidate = {
  gcCode: string;
  referenceCount: number;
  users: number;
  sources: Record<MissingCacheSource, number>;
  name: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  lastSeenAt: string | null;
};

type MissingCacheAccumulator = Omit<
  MissingCacheCandidate,
  "users" | "lastSeenAt"
> & {
  userIds: Set<string>;
  lastSeenAt: Date | null;
};

type AdminActivityDetails = Record<string, string | number | boolean | null>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeGcCode(value: unknown): string | null {
  const normalized = cleanText(value)?.toUpperCase();
  return normalized && /^GC[A-Z0-9]+$/.test(normalized) ? normalized : null;
}

function coordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const normalized = cleanText(value);
  if (!normalized) throw new BadRequestException(`${label} is required`);
  if (normalized.length > maximum) {
    throw new BadRequestException(
      `${label} must be ${maximum} characters or fewer`,
    );
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  const normalized = cleanText(value);
  if (normalized && normalized.length > maximum) {
    throw new BadRequestException(
      `${label} must be ${maximum} characters or fewer`,
    );
  }
  return normalized;
}

function requiredCoordinate(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = coordinate(value, minimum, maximum);
  if (parsed === null) throw new BadRequestException(`Invalid ${label}`);
  return parsed;
}

function optionalNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | null {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return parsed;
}

function optionalDate(value: unknown, label: string): Date | null {
  const normalized = optionalText(value, label, 10);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new BadRequestException(`Invalid ${label}`);
  }
  return parsed;
}

function addMissingCacheReference(
  candidates: Map<string, MissingCacheAccumulator>,
  reference: {
    gcCode: unknown;
    userId: string;
    source: MissingCacheSource;
    lastSeenAt: Date;
    name?: unknown;
    location?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    country?: unknown;
    region?: unknown;
    county?: unknown;
  },
) {
  const gcCode = normalizeGcCode(reference.gcCode);
  if (!gcCode) return;

  let candidate = candidates.get(gcCode);
  if (!candidate) {
    candidate = {
      gcCode,
      referenceCount: 0,
      userIds: new Set<string>(),
      sources: {
        trackableLogs: 0,
        mysteryWorkspaces: 0,
        challengeCheckers: 0,
      },
      name: null,
      location: null,
      latitude: null,
      longitude: null,
      country: null,
      region: null,
      county: null,
      lastSeenAt: null,
    };
    candidates.set(gcCode, candidate);
  }

  candidate.referenceCount += 1;
  candidate.userIds.add(reference.userId);
  candidate.sources[reference.source] += 1;
  if (!candidate.name) candidate.name = cleanText(reference.name);
  if (!candidate.location) candidate.location = cleanText(reference.location);
  if (candidate.latitude === null)
    candidate.latitude = coordinate(reference.latitude, -90, 90);
  if (candidate.longitude === null)
    candidate.longitude = coordinate(reference.longitude, -180, 180);
  if (!candidate.country) candidate.country = cleanText(reference.country);
  if (!candidate.region) candidate.region = cleanText(reference.region);
  if (!candidate.county) candidate.county = cleanText(reference.county);
  if (!candidate.lastSeenAt || reference.lastSeenAt > candidate.lastSeenAt) {
    candidate.lastSeenAt = reference.lastSeenAt;
  }
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly queue: ImportQueueService,
    private readonly storage: StorageService,
    private readonly stats: StatsService,
  ) {}

  isAdmin(user: AuthUser) {
    return this.auth.isAdmin(user);
  }

  async overview() {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    const staleImportBefore = new Date(Date.now() - STALE_IMPORT_AGE_MS);

    const [
      userCount,
      profileCount,
      cacheCount,
      findCount,
      hideCount,
      trackableCount,
      checkerCount,
      mysteryCount,
      importsLastSevenDays,
      pendingDeletionCount,
      recentUsers,
      recentImports,
      importStatusRows,
      staleProcessingCount,
      services,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.geocachingProfile.count(),
      this.prisma.cache.count(),
      this.prisma.find.count(),
      this.prisma.hide.count(),
      this.prisma.trackable.count(),
      this.prisma.challengeChecker.count(),
      this.prisma.mysteryWorkspace.count(),
      this.prisma.import.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.pendingObjectDeletion.count(),
      this.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
          profile: { select: { gcUsername: true } },
          _count: { select: { finds: true, hides: true, imports: true } },
        },
      }),
      this.prisma.import.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          fileName: true,
          fileType: true,
          source: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { username: true, email: true } },
          _count: { select: { finds: true, hides: true } },
        },
      }),
      this.prisma.import.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma.import.count({
        where: {
          status: ImportStatus.PROCESSING,
          updatedAt: { lt: staleImportBefore },
        },
      }),
      this.serviceHealth(),
    ]);

    const importsByStatus = Object.fromEntries(
      importStatusRows.map((row) => [row.status, row._count._all]),
    );

    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        users: userCount,
        profiles: profileCount,
        caches: cacheCount,
        finds: findCount,
        hides: hideCount,
        trackables: trackableCount,
        challengeCheckers: checkerCount,
        mysteries: mysteryCount,
        importsLastSevenDays,
      },
      imports: {
        byStatus: importsByStatus,
        failed: importsByStatus[ImportStatus.FAILED] ?? 0,
        staleProcessing: staleProcessingCount,
      },
      storage: {
        pendingDeletions: pendingDeletionCount,
      },
      services,
      recentUsers,
      recentImports,
    };
  }

  async missingCaches() {
    const [trackableLogs, mysteryWorkspaces, challengeCheckers] =
      await Promise.all([
        this.prisma.trackableLog.findMany({
          where: { cacheId: null, gcCode: { not: null } },
          orderBy: [{ loggedAt: "desc" }, { id: "asc" }],
          select: {
            id: true,
            userId: true,
            gcCode: true,
            cacheName: true,
            locationName: true,
            latitude: true,
            longitude: true,
            loggedAt: true,
          },
        }),
        this.prisma.mysteryWorkspace.findMany({
          where: { gcCode: { not: null } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          select: { ownerId: true, gcCode: true, data: true, updatedAt: true },
        }),
        this.prisma.challengeChecker.findMany({
          where: { gcCode: { not: null } },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          select: { userId: true, gcCode: true, name: true, updatedAt: true },
        }),
      ]);

    const codes = [
      ...trackableLogs.map((row) => normalizeGcCode(row.gcCode)),
      ...mysteryWorkspaces.map((row) => normalizeGcCode(row.gcCode)),
      ...challengeCheckers.map((row) => normalizeGcCode(row.gcCode)),
    ].filter((code): code is string => Boolean(code));
    const existingCaches = codes.length
      ? await this.prisma.cache.findMany({
          where: { gcCode: { in: [...new Set(codes)] } },
          select: { gcCode: true },
        })
      : [];
    const existingCodes = new Set(
      existingCaches.map((cache) => normalizeGcCode(cache.gcCode)),
    );
    const candidates = new Map<string, MissingCacheAccumulator>();

    for (const row of trackableLogs) {
      addMissingCacheReference(candidates, {
        gcCode: row.gcCode,
        userId: row.userId,
        source: "trackableLogs",
        lastSeenAt: row.loggedAt,
        name: row.cacheName,
        location: row.locationName,
        latitude: row.latitude,
        longitude: row.longitude,
      });
    }
    for (const row of mysteryWorkspaces) {
      const data = record(row.data);
      addMissingCacheReference(candidates, {
        gcCode: row.gcCode,
        userId: row.ownerId,
        source: "mysteryWorkspaces",
        lastSeenAt: row.updatedAt,
        name: data.name,
        location: cleanText(data.locality) ?? cleanText(data.area),
        latitude: data.publishedLatitude,
        longitude: data.publishedLongitude,
        country: data.country,
        region: data.region,
        county: data.county,
      });
    }
    for (const row of challengeCheckers) {
      addMissingCacheReference(candidates, {
        gcCode: row.gcCode,
        userId: row.userId,
        source: "challengeCheckers",
        lastSeenAt: row.updatedAt,
        name: row.name,
      });
    }

    const missing = [...candidates.values()]
      .filter((candidate) => !existingCodes.has(candidate.gcCode))
      .sort((left, right) => left.gcCode.localeCompare(right.gcCode));

    return {
      generatedAt: new Date().toISOString(),
      total: missing.length,
      caches: missing.map(({ userIds, lastSeenAt, ...candidate }) => ({
        ...candidate,
        users: userIds.size,
        lastSeenAt: lastSeenAt?.toISOString() ?? null,
      })),
    };
  }

  async addCache(input: unknown, admin?: AuthUser) {
    const body = record(input);
    const gcCode = requiredText(body.gcCode, "gcCode", 40).toUpperCase();
    if (!/^GC[A-Z0-9]+$/.test(gcCode)) {
      throw new BadRequestException("gcCode must be a valid GC code");
    }
    const name = requiredText(body.name, "name", 500);
    const latitude = requiredCoordinate(body.latitude, "latitude", -90, 90);
    const longitude = requiredCoordinate(
      body.longitude,
      "longitude",
      -180,
      180,
    );
    const data = {
      gcCode,
      name,
      cacheType: optionalText(body.cacheType, "cacheType", 100),
      difficulty: optionalNumber(body.difficulty, "difficulty", 1, 5),
      terrain: optionalNumber(body.terrain, "terrain", 1, 5),
      size: optionalText(body.size, "size", 100),
      latitude,
      longitude,
      country: optionalText(body.country, "country", 120),
      region: optionalText(body.region, "region", 160),
      county: optionalText(body.county, "county", 160),
      hiddenDate: optionalDate(body.hiddenDate, "hiddenDate"),
      ownerName: optionalText(body.ownerName, "ownerName", 250),
    };

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const trustedData = { ...data, metadataTrusted: true };
        const cache = await tx.cache.upsert({
          where: { gcCode },
          create: trustedData,
          update: trustedData,
        });
        const linked = await tx.trackableLog.updateMany({
          where: {
            cacheId: null,
            gcCode: { equals: gcCode, mode: "insensitive" },
          },
          data: { cacheId: cache.id },
        });
        return { cache, linkedTrackableLogs: linked.count };
      });

      const response = {
        cache: {
          id: result.cache.id,
          gcCode: result.cache.gcCode,
          name: result.cache.name,
          latitude: Number(result.cache.latitude),
          longitude: Number(result.cache.longitude),
        },
        linkedTrackableLogs: result.linkedTrackableLogs,
      };
      await this.recordActivity(
        admin,
        "CACHE_ADDED",
        "cache",
        response.cache.gcCode,
        {
          linkedTrackableLogs: response.linkedTrackableLogs,
        },
      );
      return response;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          `${gcCode} already exists in the cache database`,
        );
      }
      throw error;
    }
  }

  async caches(
    query = "",
    pageValue = "1",
    pageSizeValue = String(DEFAULT_PAGE_SIZE),
  ) {
    const normalizedQuery = query.trim();
    const page = this.positiveInteger(pageValue, 1);
    const pageSize = Math.min(
      this.positiveInteger(pageSizeValue, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const where: Prisma.CacheWhereInput = normalizedQuery
      ? {
          OR: [
            { gcCode: { contains: normalizedQuery, mode: "insensitive" } },
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { cacheType: { contains: normalizedQuery, mode: "insensitive" } },
            { country: { contains: normalizedQuery, mode: "insensitive" } },
            { region: { contains: normalizedQuery, mode: "insensitive" } },
            { county: { contains: normalizedQuery, mode: "insensitive" } },
            { ownerName: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      this.prisma.cache.count({ where }),
      this.prisma.cache.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
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
          ownerName: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { finds: true, hides: true, trackableLogs: true } },
        },
      }),
    ]);

    return {
      caches: rows.map((cache) => ({
        ...cache,
        difficulty: cache.difficulty === null ? null : Number(cache.difficulty),
        terrain: cache.terrain === null ? null : Number(cache.terrain),
        latitude: Number(cache.latitude),
        longitude: Number(cache.longitude),
      })),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async imports(
    statusValue = "",
    pageValue = "1",
    pageSizeValue = String(DEFAULT_PAGE_SIZE),
  ) {
    const normalizedStatus = statusValue.trim().toUpperCase();
    if (
      normalizedStatus &&
      !Object.values(ImportStatus).includes(normalizedStatus as ImportStatus)
    ) {
      throw new BadRequestException("Unknown import status");
    }
    const page = this.positiveInteger(pageValue, 1);
    const pageSize = Math.min(
      this.positiveInteger(pageSizeValue, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const where: Prisma.ImportWhereInput = normalizedStatus
      ? { status: normalizedStatus as ImportStatus }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.import.count({ where }),
      this.prisma.import.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          fileName: true,
          fileType: true,
          source: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { username: true, email: true } },
          _count: { select: { finds: true, hides: true } },
        },
      }),
    ]);

    return {
      imports: rows,
      filter: normalizedStatus || "ALL",
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async activity(pageValue = "1", pageSizeValue = String(DEFAULT_PAGE_SIZE)) {
    const page = this.positiveInteger(pageValue, 1);
    const pageSize = Math.min(
      this.positiveInteger(pageSizeValue, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const [total, activities] = await Promise.all([
      this.prisma.adminActivityLog.count(),
      this.prisma.adminActivityLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          details: true,
          createdAt: true,
          admin: { select: { username: true } },
        },
      }),
    ]);

    return {
      activities,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async users(
    query = "",
    pageValue = "1",
    pageSizeValue = String(DEFAULT_PAGE_SIZE),
  ) {
    const normalizedQuery = query.trim();
    const page = this.positiveInteger(pageValue, 1);
    const pageSize = Math.min(
      this.positiveInteger(pageSizeValue, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );
    const where: Prisma.UserWhereInput = normalizedQuery
      ? {
          OR: [
            { username: { contains: normalizedQuery, mode: "insensitive" } },
            { email: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : {};

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          username: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          profile: { select: { gcUsername: true } },
          _count: {
            select: {
              finds: true,
              hides: true,
              imports: true,
              trackables: true,
            },
          },
        },
      }),
    ]);

    return {
      users: rows,
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async retryImport(id: string, admin?: AuthUser) {
    const importRecord = await this.prisma.import.findUnique({ where: { id } });
    if (!importRecord) {
      throw new NotFoundException("Import not found");
    }
    if (![ImportStatus.FAILED, ImportStatus.QUEUED].includes(importRecord.status as ImportStatus)) {
      throw new BadRequestException("Only failed imports can be retried");
    }

    let queuedImport = importRecord;
    if (importRecord.status === ImportStatus.FAILED) {
      const claim = await this.prisma.import.updateMany({
        where: { id, status: ImportStatus.FAILED },
        data: { status: ImportStatus.QUEUED, errorMessage: null },
      });
      if (claim.count !== 1) {
        throw new BadRequestException("Only failed imports can be retried");
      }
      queuedImport = {
        ...importRecord,
        status: ImportStatus.QUEUED,
        errorMessage: null,
      };
    }

    // Keep QUEUED if Redis gives an ambiguous response. A persisted job can
    // still be claimed by the worker, and retrying this endpoint is safe
    // because enqueue uses the import-derived job id.
    try {
      await this.queue.enqueue({
        importId: importRecord.id,
        userId: importRecord.userId,
        objectKey: importRecord.objectKey,
        source: importRecord.source as ImportSource,
      });
    } catch (error) {
      if (error instanceof ImportQueueRejectedError) {
        try {
          await this.prisma.import.updateMany({
            where: { id, status: ImportStatus.QUEUED },
            data: {
              status: ImportStatus.FAILED,
              errorMessage: error.message,
            },
          });
        } catch (rollbackError) {
          console.error(`Failed to roll back import retry ${id}`, rollbackError);
        }
      }
      throw error;
    }

    await this.recordActivity(admin, "IMPORT_RETRIED", "import", queuedImport.id, {
      fileName: importRecord.fileName,
      source: importRecord.source,
    });

    return { import: queuedImport };
  }

  async recalculateUser(userId: string, admin?: AuthUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const snapshot = await this.stats.buildSnapshotForUser(user.id);
    await this.stats.replaceSnapshotForUser(user.id, snapshot);
    const totalFinds =
      typeof snapshot === "object" && snapshot && "totalFinds" in snapshot
        ? Number(snapshot.totalFinds)
        : null;
    await this.recordActivity(admin, "STATS_REBUILT", "user", user.id, {
      username: user.username,
      totalFinds,
    });

    return {
      user,
      totalFinds,
      generatedAt: new Date().toISOString(),
    };
  }

  private async recordActivity(
    admin: AuthUser | undefined,
    action: string,
    targetType: string,
    targetId: string | null,
    details: AdminActivityDetails,
  ) {
    if (!admin) return;
    await this.prisma.adminActivityLog.create({
      data: {
        adminId: admin.id,
        action,
        targetType,
        targetId,
        details: details as Prisma.InputJsonObject,
      },
    });
  }

  private async serviceHealth() {
    const checks = await Promise.allSettled([
      this.prisma.$queryRaw(Prisma.sql`SELECT 1`),
      this.queue.ping(),
      this.storage.ping(),
    ]);
    const names = ["database", "importQueue", "objectStorage"] as const;
    const statuses = Object.fromEntries(
      checks.map((result, index) => [
        names[index],
        result.status === "fulfilled" ? "ok" : "unhealthy",
      ]),
    );
    const hasFailure = checks.some((result) => result.status === "rejected");

    return {
      status: hasFailure ? "degraded" : "operational",
      checkedAt: new Date().toISOString(),
      checks: statuses,
    };
  }

  private positiveInteger(value: string, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
