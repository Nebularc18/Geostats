import { Cache, PrismaClient, Prisma } from "@geostats/db";
import { parseImportFile } from "@geostats/gpx-parser";
import { ImportFileType, ImportJobPayload, ImportSource, ImportStatus } from "@geostats/shared";
import { calculateHideStats, calculateStats } from "@geostats/stats";
import { ObjectStorage } from "../storage/object-storage";

type ParsedImportResult = Awaited<ReturnType<typeof parseImportFile>>;
type ParsedFindWithDate = ParsedImportResult["finds"][number] & { foundAt: Date };

function elevationFromRaw(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = (raw as Record<string, unknown>).ele;
  const text = value && typeof value === "object" && "text" in value ? (value as { text?: unknown }).text : value;
  const elevation = Number(text);
  return Number.isFinite(elevation) ? elevation : null;
}

function hasFoundDate(find: ParsedImportResult["finds"][number]): find is ParsedFindWithDate {
  return find.foundAt !== null;
}

export class ImportProcessor {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage
  ) {}

  async process(payload: ImportJobPayload) {
    const importRecord = await this.prisma.import.findFirst({
      where: { id: payload.importId, userId: payload.userId }
    });
    if (!importRecord) {
      throw new Error(`Import ${payload.importId} was not found`);
    }

    await this.prisma.import.update({
      where: { id: payload.importId },
      data: { status: ImportStatus.PROCESSING, errorMessage: null }
    });

    try {
      const importSource = importRecord.source as ImportSource;
      const content = await this.storage.getObject(importRecord.objectKey);
      const parsed = await parseImportFile(importRecord.fileName, content, importSource);
      const effectiveSource =
        importRecord.fileType === ImportFileType.ZIP && parsed.finds.length > 0
          ? ImportSource.MY_FINDS_GPX
          : importSource;
      const cachesByCode = await this.resolveCaches([
        ...parsed.caches,
        ...parsed.finds.map((find) => find.cache)
      ]);

      await this.prisma.$transaction(async (tx) => {
        for (const parsedCache of parsed.caches) {
          const cache = this.cacheFor(cachesByCode, parsedCache.gcCode);

          if (importRecord.source === ImportSource.MY_HIDES_GPX) {
            await tx.hide.upsert({
              where: {
                userId_cacheId: {
                  userId: payload.userId,
                  cacheId: cache.id
                }
              },
              create: {
                userId: payload.userId,
                cacheId: cache.id,
                importId: payload.importId,
                placedAt: parsedCache.hiddenDate,
                receivedLogCount: parsedCache.receivedLogCount
              },
              update: {
                importId: payload.importId,
                placedAt: parsedCache.hiddenDate,
                receivedLogCount: parsedCache.receivedLogCount
              }
            });
          }
        }

        const datedFinds = parsed.finds.filter(hasFoundDate);
        for (const parsedFind of datedFinds) {
          const cache = this.cacheFor(cachesByCode, parsedFind.cache.gcCode);

          await tx.find.upsert({
            where: {
              userId_cacheId_foundAt: {
                userId: payload.userId,
                cacheId: cache.id,
                foundAt: parsedFind.foundAt
              }
            },
            create: {
              userId: payload.userId,
              cacheId: cache.id,
              importId: payload.importId,
              foundAt: parsedFind.foundAt,
              logText: parsedFind.logText,
              importedFrom: effectiveSource
            },
            update: {
              importId: payload.importId,
              logText: parsedFind.logText,
              importedFrom: effectiveSource
            }
          });
        }
      });

      await this.recalculateStats(payload.userId);
      await this.prisma.import.update({
        where: { id: payload.importId },
        data: { status: ImportStatus.COMPLETED, source: effectiveSource }
      });
    } catch (error) {
      await this.prisma.import.update({
        where: { id: payload.importId },
        data: {
          status: ImportStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "Unknown import failure"
        }
      });
      throw error;
    }
  }

  private cacheCreateInput(cache: any): Prisma.CacheCreateInput {
    return {
      gcCode: cache.gcCode,
      name: cache.name,
      cacheType: cache.cacheType,
      difficulty: cache.difficulty,
      terrain: cache.terrain,
      size: cache.size,
      latitude: cache.latitude,
      longitude: cache.longitude,
      country: cache.country,
      region: cache.region,
      county: cache.county,
      hiddenDate: cache.hiddenDate,
      ownerName: cache.ownerName,
      raw: cache.raw as Prisma.InputJsonValue
    };
  }

  private cacheUpdateInput(cache: any): Prisma.CacheUpdateInput {
    return {
      name: cache.name,
      cacheType: cache.cacheType,
      difficulty: cache.difficulty,
      terrain: cache.terrain,
      size: cache.size,
      latitude: cache.latitude,
      longitude: cache.longitude,
      country: cache.country,
      region: cache.region,
      county: cache.county,
      hiddenDate: cache.hiddenDate,
      ownerName: cache.ownerName,
      raw: cache.raw as Prisma.InputJsonValue
    };
  }

  private async resolveCaches(caches: any[]): Promise<Map<string, Cache>> {
    const byCode = new Map<string, Cache>();
    for (const cache of caches) {
      if (!byCode.has(cache.gcCode)) {
        byCode.set(cache.gcCode, await this.findOrCreateCache(cache));
      }
    }
    return byCode;
  }

  private async findOrCreateCache(cache: any): Promise<Cache> {
    const existing = await this.prisma.cache.findUnique({ where: { gcCode: cache.gcCode } });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.cache.create({ data: this.cacheCreateInput(cache) });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const createdByConcurrentImport = await this.prisma.cache.findUnique({ where: { gcCode: cache.gcCode } });
        if (createdByConcurrentImport) {
          return createdByConcurrentImport;
        }
      }
      throw error;
    }
  }

  private cacheFor(cachesByCode: Map<string, Cache>, gcCode: string): Cache {
    const cache = cachesByCode.get(gcCode);
    if (!cache) {
      throw new Error(`Cache ${gcCode} was not resolved`);
    }
    return cache;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private async recalculateStats(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId } });
    const finds = await this.prisma.find.findMany({
      where: { userId },
      include: { cache: true },
      orderBy: { foundAt: "asc" }
    });
    const hides = await this.prisma.hide.findMany({
      where: { userId },
      include: { cache: true },
      orderBy: { placedAt: "asc" }
    });
    const stats = calculateStats(
      finds.map((find) => ({
        foundAt: find.foundAt,
        cache: {
          latitude: Number(find.cache.latitude),
          longitude: Number(find.cache.longitude),
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
          elevationMeters: elevationFromRaw(find.cache.raw)
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
          latitude: Number(hide.cache.latitude),
          longitude: Number(hide.cache.longitude),
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
  }
}
