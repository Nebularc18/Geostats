import { Cache, PrismaClient, Prisma } from "@geostats/db";
import { DEFAULT_FTF_DETECTION_TERMS, detectFtfLog, parseImportFile, termRegex as ftfTermRegex } from "@geostats/gpx-parser";
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

function ftfTermMatch(line: string, terms: string[]): RegExpExecArray | null {
  for (const term of terms) {
    const match = ftfTermRegex(term)?.exec(line);
    if (match) {
      return match;
    }
  }
  return null;
}

function timeFromFtfLog(text: string | null, ftfDetectionTerms: string[]): { hour: number; minute: number } | null {
  if (!text) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const termMatch = ftfTermMatch(line, ftfDetectionTerms);
    const sameLineMatch = termMatch
      ? line.slice(termMatch.index + termMatch[0].length).match(/^\s*(?:at|time)?\s*(\d{1,2})[:.](\d{2})\b/i)
      : null;
    const nextLineMatch =
      termMatch ? lines[index + 1]?.match(/^\s*(?:time\s*)?(\d{1,2})[:.](\d{2})\b/i) : null;
    const match = sameLineMatch ?? nextLineMatch;
    if (match) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return { hour, minute };
      }
    }
  }
  return null;
}

function foundAtWithFtfLogTime(
  foundAt: Date,
  logText: string | null,
  isFtf: boolean,
  ftfDetectionTerms: string[]
): Date {
  if (!isFtf) {
    return foundAt;
  }
  const time = timeFromFtfLog(logText, ftfDetectionTerms);
  if (!time) {
    return foundAt;
  }
  return new Date(Date.UTC(foundAt.getUTCFullYear(), foundAt.getUTCMonth(), foundAt.getUTCDate(), time.hour, time.minute));
}

function timeZoneOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - date.getTime();
}

function wallClockInTimeZoneToUtc(date: Date, timeZone: string): Date {
  const localAsUtc = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds()
  );
  let utc = new Date(localAsUtc - timeZoneOffsetMs(timeZone, new Date(localAsUtc)));
  utc = new Date(localAsUtc - timeZoneOffsetMs(timeZone, utc));
  return utc;
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
      const profile =
        parsed.finds.length > 0
          ? await this.prisma.geocachingProfile.findUnique({
              where: { userId: payload.userId },
              select: { ftfDetectionTerms: true, timeZone: true }
            })
          : null;
      const ftfDetectionTerms = profile?.ftfDetectionTerms ?? DEFAULT_FTF_DETECTION_TERMS;
      const timeZone = profile?.timeZone ?? "Europe/Stockholm";
      const effectiveSource =
        importRecord.fileType === ImportFileType.ZIP && parsed.finds.length > 0
          ? ImportSource.MY_FINDS_GPX
          : importSource;
      const cachesByCode = await this.resolveCaches([
        ...parsed.caches,
        ...parsed.finds.map((find) => find.cache)
      ]);
      let shouldRecalculateStats = importRecord.source === ImportSource.MY_HIDES_GPX && parsed.caches.length > 0;

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
        const findCacheIds = datedFinds.map((parsedFind) => this.cacheFor(cachesByCode, parsedFind.cache.gcCode).id);
        const existingFinds =
          findCacheIds.length === 0
            ? []
            : await tx.find.findMany({
                where: {
                  userId: payload.userId,
                  cacheId: { in: findCacheIds }
                },
                orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }]
              });
        const existingFindsByCacheId = new Map<string, (typeof existingFinds)[number][]>();
        for (const existingFind of existingFinds) {
          existingFindsByCacheId.set(existingFind.cacheId, [...(existingFindsByCacheId.get(existingFind.cacheId) ?? []), existingFind]);
        }

        for (const parsedFind of datedFinds) {
          const cache = this.cacheFor(cachesByCode, parsedFind.cache.gcCode);
          const isFtf = detectFtfLog(parsedFind.logText, ftfDetectionTerms);
          const foundAt = wallClockInTimeZoneToUtc(
            foundAtWithFtfLogTime(parsedFind.foundAt, parsedFind.logText, isFtf, ftfDetectionTerms),
            timeZone
          );
          const existingCacheFinds = existingFindsByCacheId.get(cache.id) ?? [];
          const exactMatchIndex = existingCacheFinds.findIndex((find) => find.foundAt.getTime() === foundAt.getTime());
          const existingFind =
            exactMatchIndex >= 0 ? existingCacheFinds.splice(exactMatchIndex, 1)[0] : existingCacheFinds.shift();

          if (existingFind) {
            const update: Prisma.FindUncheckedUpdateInput = {};
            let statsRelevantChange = false;

            if (existingFind.foundAt.getTime() !== foundAt.getTime()) {
              update.foundAt = foundAt;
              statsRelevantChange = true;
            }
            if (existingFind.logText !== parsedFind.logText) {
              update.logText = parsedFind.logText;
            }
            if (isFtf && !existingFind.isFtf && !existingFind.isFtfManual) {
              update.isFtf = true;
              statsRelevantChange = true;
            }
            if (existingFind.importedFrom !== effectiveSource) {
              update.importedFrom = effectiveSource;
            }

            if (Object.keys(update).length > 0) {
              await tx.find.update({
                where: { id: existingFind.id },
                data: {
                  ...update,
                  importId: payload.importId
                }
              });
              if (statsRelevantChange) {
                shouldRecalculateStats = true;
              }
            }
            continue;
          }

          const createdFind = await tx.find.create({
            data: {
              userId: payload.userId,
              cacheId: cache.id,
              importId: payload.importId,
              foundAt,
              logText: parsedFind.logText,
              isFtf,
              isFtfManual: false,
              importedFrom: effectiveSource
            }
          });
          shouldRecalculateStats = true;
          existingFindsByCacheId.set(cache.id, [...(existingFindsByCacheId.get(cache.id) ?? []), createdFind]);
        }
      });

      await this.prisma.import.update({
        where: { id: payload.importId },
        data: { status: ImportStatus.COMPLETED, source: effectiveSource }
      });
      if (shouldRecalculateStats) {
        try {
          await this.recalculateStats(payload.userId);
        } catch (error) {
          console.error(`Stats recalculation failed after import ${payload.importId} completed`, error);
        }
      }
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
    const uniqueCaches = new Map<string, any>();
    for (const cache of caches) {
      if (!uniqueCaches.has(cache.gcCode)) {
        uniqueCaches.set(cache.gcCode, cache);
      }
    }

    const resolvedCaches = await Promise.all(
      Array.from(uniqueCaches.values()).map(async (cache) => [cache.gcCode, await this.findOrCreateCache(cache)] as const)
    );
    const byCode = new Map<string, Cache>(resolvedCaches);
    return byCode;
  }

  private async findOrCreateCache(cache: any): Promise<Cache> {
    try {
      return await this.prisma.cache.upsert({
        where: { gcCode: cache.gcCode },
        create: this.cacheCreateInput(cache),
        update: this.cacheUpdateInput(cache)
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        return this.updateCache(cache);
      }
      throw error;
    }
  }

  private async updateCache(cache: any): Promise<Cache> {
    return this.prisma.cache.update({
      where: { gcCode: cache.gcCode },
      data: this.cacheUpdateInput(cache)
    });
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
  }
}
