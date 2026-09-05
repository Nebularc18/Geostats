import { Cache, calculateUserStats, PrismaClient, Prisma } from "@geostats/db";
import { DEFAULT_FTF_DETECTION_TERMS, detectFtfLog, parseImportFile, termRegex as ftfTermRegex } from "@geostats/gpx-parser";
import { ImportFileType, ImportJobPayload, ImportSource, ImportStatus } from "@geostats/shared";
import { ObjectStorage } from "../storage/object-storage";

type ParsedImportResult = Awaited<ReturnType<typeof parseImportFile>>;
type ParsedFindWithDate = ParsedImportResult["finds"][number] & { foundAt: Date };
type ImportAttempt = { attemptsMade: number; maxAttempts: number };
const FTF_TIME_LOOKAHEAD_LINES = 3;

function rawObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
}

function rawArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value as T];
}

function rawText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (value && typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text ?? "").trim();
  }
  return "";
}

function receivedLogs(raw: unknown): Array<Record<string, any>> {
  const root = rawObject(raw);
  const cache = rawObject(root["groundspeak:cache"] ?? root.cache);
  return rawArray<Record<string, any>>(cache["groundspeak:logs"]?.["groundspeak:log"] ?? cache.logs?.log);
}

function receivedLogId(log: Record<string, any>): string | null {
  const id = rawText(log["geostats:log_id"], log.logId, log.LogID, log.id);
  return id || null;
}

function receivedLogKey(log: Record<string, any>): string {
  const date = rawText(log["groundspeak:date"], log.date);
  const day = date.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? date;
  const text = rawText(log["groundspeak:text"], log.text)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return [day, rawText(log["groundspeak:type"], log.type), rawText(log["groundspeak:finder"], log.finder), text]
    .map((value) => value.toLowerCase())
    .join("\u001f");
}

function mergedHideRaw(incomingRaw: unknown, storedRaw: unknown) {
  const root = rawObject(incomingRaw);
  const cacheKey = root["groundspeak:cache"] !== undefined || root.cache === undefined ? "groundspeak:cache" : "cache";
  const cache = rawObject(root[cacheKey]);
  const logsKey = cache["groundspeak:logs"] !== undefined || cache.logs === undefined ? "groundspeak:logs" : "logs";
  const logKey = logsKey === "groundspeak:logs" ? "groundspeak:log" : "log";
  const container = rawObject(cache[logsKey]);
  const logs = [...receivedLogs(incomingRaw)];
  const ids = new Set(logs.map(receivedLogId).filter((value): value is string => Boolean(value)));
  const keys = new Set(logs.map(receivedLogKey));

  for (const log of receivedLogs(storedRaw)) {
    const id = receivedLogId(log);
    const key = receivedLogKey(log);
    if ((id && ids.has(id)) || keys.has(key)) continue;
    if (id) ids.add(id);
    keys.add(key);
    logs.push(log);
  }

  return {
    count: logs.filter((log) => rawText(log["groundspeak:type"], log.type).toLowerCase() !== "publish listing").length,
    raw: { ...root, [cacheKey]: { ...cache, [logsKey]: { ...container, [logKey]: logs } } }
  };
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
    let nextLineMatch: RegExpMatchArray | null = null;
    if (termMatch) {
      // Keep nearby-line extraction anchored to an explicit FTF term to avoid incidental prose times.
      for (let offset = 1; offset <= FTF_TIME_LOOKAHEAD_LINES; offset += 1) {
        const candidate = lines[index + offset];
        if (!candidate) {
          continue;
        }
        nextLineMatch =
          offset === 1
            ? candidate.match(/^\s*(?:time\s*)?(\d{1,2})[:.](\d{2})\b/i)
            : candidate.match(/^\s*time\s*(\d{1,2})[:.](\d{2})\b/i);
        if (nextLineMatch) {
          break;
        }
      }
    }
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

function loggedDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export class ImportProcessor {
  private readonly statsRecalculationsByUser = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage
  ) {}

  async process(payload: ImportJobPayload, attempt: ImportAttempt = { attemptsMade: 0, maxAttempts: 1 }) {
    const importRecord = await this.prisma.import.findFirst({
      where: { id: payload.importId, userId: payload.userId }
    });
    if (!importRecord) {
      throw new Error(`Import ${payload.importId} was not found`);
    }

    const claimed = await this.prisma.import.updateMany({
      where: {
        id: payload.importId,
        userId: payload.userId,
        status: ImportStatus.QUEUED
      },
      data: { status: ImportStatus.PROCESSING, errorMessage: null }
    });
    if (claimed.count !== 1) return;

    try {
      const importSource = importRecord.source as ImportSource;
      const content = await this.storage.getObject(importRecord.objectKey);
      const profile =
        importSource === ImportSource.MY_HIDES_GPX
          ? null
          : await this.prisma.geocachingProfile.findUnique({
              where: { userId: payload.userId },
              select: { gcUsername: true, ftfDetectionTerms: true, timeZone: true }
            });
      const parsed = await parseImportFile(importRecord.fileName, content, importSource, { gcUsername: profile?.gcUsername });
      const ftfDetectionTerms = profile?.ftfDetectionTerms ?? DEFAULT_FTF_DETECTION_TERMS;
      const timeZone = profile?.timeZone ?? "Europe/Stockholm";
      const effectiveSource =
        importRecord.fileType === ImportFileType.ZIP && parsed.finds.length > 0
          ? ImportSource.MY_FINDS_GPX
          : importSource;
      const cachesByCode = await this.resolveCaches(
        payload.userId,
        [...parsed.caches, ...parsed.finds.map((find) => find.cache)]
      );
      let shouldRecalculateStats = importRecord.source === ImportSource.MY_HIDES_GPX && parsed.caches.length > 0;

      await this.prisma.$transaction(async (tx) => {
        const parsedCaches =
          importRecord.source === ImportSource.MY_HIDES_GPX
            ? [...parsed.caches].sort((left, right) => left.gcCode.localeCompare(right.gcCode))
            : parsed.caches;
        for (const parsedCache of parsedCaches) {
          const cache = this.cacheFor(cachesByCode, parsedCache.gcCode);

          if (importRecord.source === ImportSource.MY_HIDES_GPX) {
            const [currentHide] = await tx.$queryRaw<Array<{ receivedLogsRaw: Prisma.JsonValue | null }>>(Prisma.sql`
              SELECT "received_logs_raw" AS "receivedLogsRaw"
              FROM "hides"
              WHERE "user_id" = ${payload.userId} AND "cache_id" = ${cache.id}
              FOR UPDATE
            `);
            const merged = mergedHideRaw(parsedCache.raw, currentHide?.receivedLogsRaw);
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
                receivedLogCount: merged.count,
                receivedLogsRaw: merged.raw as Prisma.InputJsonValue
              },
              update: {
                importId: payload.importId,
                placedAt: parsedCache.hiddenDate,
                receivedLogCount: merged.count,
                receivedLogsRaw: merged.raw as Prisma.InputJsonValue
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

        const importFinds = datedFinds
          .map((parsedFind) => {
            const cache = this.cacheFor(cachesByCode, parsedFind.cache.gcCode);
            const isFtf = detectFtfLog(parsedFind.logText, ftfDetectionTerms);
            const foundDate = loggedDate(parsedFind.foundAt);
            const foundAt = wallClockInTimeZoneToUtc(
              foundAtWithFtfLogTime(parsedFind.foundAt, parsedFind.logText, isFtf, ftfDetectionTerms),
              timeZone
            );
            return { parsedFind, cache, isFtf, foundAt, foundDate };
          })
          .sort((a, b) => a.foundAt.getTime() - b.foundAt.getTime());

        for (const { parsedFind, cache, isFtf, foundAt, foundDate } of importFinds) {
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
            if (existingFind.foundDate?.getTime() !== foundDate.getTime()) {
              update.foundDate = foundDate;
              statsRelevantChange = true;
            }
            if (existingFind.logText !== parsedFind.logText) {
              update.logText = parsedFind.logText;
            }
            if (!existingFind.isFtfManual) {
              if (isFtf && !existingFind.isFtf) {
                update.isFtf = true;
                statsRelevantChange = true;
              } else if (!isFtf && existingFind.isFtf) {
                update.isFtf = false;
                statsRelevantChange = true;
              }
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

          await tx.find.create({
            data: {
              userId: payload.userId,
              cacheId: cache.id,
              importId: payload.importId,
              foundAt,
              foundDate,
              logText: parsedFind.logText,
              isFtf,
              isFtfManual: false,
              importedFrom: effectiveSource
            }
          });
          shouldRecalculateStats = true;
        }

        // Advance the map revision in the same transaction as the imported
        // rows. This keeps cursor pagination from observing a partial update
        // while the import record is still marked as processing.
        await tx.import.update({
          where: { id: payload.importId },
          data: { updatedAt: new Date() }
        });
      });

      if (shouldRecalculateStats) {
        await this.recalculateStats(payload.userId);
      }
      await this.prisma.import.update({
        where: { id: payload.importId },
        data: { status: ImportStatus.COMPLETED, source: effectiveSource }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown import failure";
      const willRetry = attempt.attemptsMade + 1 < attempt.maxAttempts;
      await this.prisma.import.update({
        where: { id: payload.importId },
        data: {
          status: willRetry ? ImportStatus.QUEUED : ImportStatus.FAILED,
          errorMessage: willRetry ? null : message
        }
      });
      throw error;
    }
  }

  private cacheCreateInput(cache: any): Prisma.CacheUncheckedCreateInput {
    const gcCode = String(cache.gcCode).trim().toUpperCase();
    return {
      gcCode,
      name: gcCode,
      latitude: 0,
      longitude: 0,
      metadataTrusted: false
    };
  }

  private async resolveCaches(userId: string, caches: any[]): Promise<Map<string, Cache>> {
    const uniqueCaches = new Map<string, any>();
    for (const cache of caches) {
      const gcCode = String(cache.gcCode).trim().toUpperCase();
      if (!uniqueCaches.has(gcCode)) {
        uniqueCaches.set(gcCode, { ...cache, gcCode });
      }
    }

    const resolvedCaches = await Promise.all(
      Array.from(uniqueCaches.values()).map(async (cache) => [cache.gcCode, await this.findOrCreateCache(userId, cache)] as const)
    );
    const byCode = new Map<string, Cache>(resolvedCaches);
    return byCode;
  }

  private async findOrCreateCache(userId: string, cache: any): Promise<Cache> {
    const create = this.cacheCreateInput(cache);
    let resolved: Cache;
    try {
      resolved = await this.prisma.cache.upsert({
        where: { gcCode: create.gcCode },
        create,
        update: {}
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        resolved = await this.findExistingCache(cache.gcCode);
      } else {
        throw error;
      }
    }
    await this.prisma.userCacheData.upsert({
      where: { userId_cacheId: { userId, cacheId: resolved.id } },
      create: { userId, cacheId: resolved.id, raw: cache.raw as Prisma.InputJsonValue },
      update: { raw: cache.raw as Prisma.InputJsonValue }
    });
    return resolved;
  }

  private async findExistingCache(gcCode: string): Promise<Cache> {
    const existing = await this.prisma.cache.findUnique({
      where: { gcCode: gcCode.trim().toUpperCase() }
    });
    if (!existing) {
      throw new Error(`Cache ${gcCode} was not resolved after a unique constraint conflict`);
    }
    return existing;
  }

  private cacheFor(cachesByCode: Map<string, Cache>, gcCode: string): Cache {
    const cache = cachesByCode.get(gcCode.trim().toUpperCase());
    if (!cache) {
      throw new Error(`Cache ${gcCode} was not resolved`);
    }
    return cache;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private async recalculateStats(userId: string) {
    const previous = this.statsRecalculationsByUser.get(userId) ?? Promise.resolve();
    const recalculation = previous
      .catch(() => undefined)
      .then(() => this.calculateAndStoreStats(userId));
    this.statsRecalculationsByUser.set(userId, recalculation);

    try {
      await recalculation;
    } finally {
      if (this.statsRecalculationsByUser.get(userId) === recalculation) {
        this.statsRecalculationsByUser.delete(userId);
      }
    }
  }

  private async calculateAndStoreStats(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      // Hold the user lock from the first stats read until the snapshot is replaced.
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext('stats-recalculation'), hashtext(${userId}))::text AS lock_result
      `;
      const stats = await calculateUserStats(tx, userId);
      await tx.statSnapshot.deleteMany({ where: { userId } });
      await tx.statSnapshot.create({
        data: {
          userId,
          statsJson: stats as unknown as Prisma.InputJsonValue
        }
      });
    }, { maxWait: 10_000, timeout: 120_000 });
  }

}
