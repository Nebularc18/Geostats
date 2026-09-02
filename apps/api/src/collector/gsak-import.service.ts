import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { PrismaService } from "../common/prisma.service";
import { StatsService } from "../stats/stats.service";

type CsvRecord = Record<string, string>;
type CacheRow = {
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  county: string | null;
  hiddenDate: Date | null;
  ownerName: string | null;
  foundDate: Date | null;
  isFtf: boolean;
  isOwner: boolean;
  favoritePoints: number;
  elevationMeters: number | null;
  status: string | null;
  isPremium: boolean;
  correctedLatitude: number | null;
  correctedLongitude: number | null;
  hasCorrected: boolean;
  userNote: string | null;
  attributes: Array<{ id: string; inc: string }>;
};

type LogRow = {
  gcCode: string;
  logId: string | null;
  type: string;
  finder: string;
  date: Date;
  text: string;
  latitude: string | null;
  longitude: string | null;
  ownerId: string | null;
  isOwnLog: boolean;
  cacheIsOwned: boolean;
};

const MAX_BATCH_ROWS = 500;
const FOUND_LOG_TYPES = new Set(["found it", "attended", "webcam photo taken"]);

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (inQuotes) throw new BadRequestException("GSAK CSV contains an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value !== ""));
}

export function gsakCsvRecords(text: unknown): CsvRecord[] {
  if (typeof text !== "string" || !text.trim()) throw new BadRequestException("GSAK CSV data is required");
  const rows = parseCsv(text);
  const headers = rows.shift()?.map((value) => value.trim().toLowerCase());
  if (!headers?.length || headers.some((header) => !header)) throw new BadRequestException("GSAK CSV headers are required");
  if (new Set(headers).size !== headers.length) throw new BadRequestException("GSAK CSV headers must be unique");
  if (rows.length === 0) throw new BadRequestException("GSAK CSV batch is empty");
  if (rows.length > MAX_BATCH_ROWS) throw new BadRequestException(`GSAK CSV batches may contain at most ${MAX_BATCH_ROWS} rows`);
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function text(value: unknown, max = 500): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new BadRequestException(`GSAK field exceeds ${max} characters`);
  return normalized;
}

function flag(value: unknown): boolean {
  return ["1", "true", "yes", "y"].includes(String(value ?? "").trim().toLowerCase());
}

function number(value: unknown, label: string, options: { min?: number; max?: number; nullable?: boolean } = {}): number | null {
  const raw = String(value ?? "").trim();
  if (!raw && options.nullable) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || (options.min !== undefined && parsed < options.min) || (options.max !== undefined && parsed > options.max)) {
    throw new BadRequestException(`Invalid GSAK ${label}`);
  }
  return parsed;
}

function dateOnly(value: unknown, label: string): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestException(`Invalid GSAK ${label}`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new BadRequestException(`Invalid GSAK ${label}`);
  return parsed;
}

function logDate(row: CsvRecord): Date {
  const day = dateOnly(row.date, "log date");
  if (!day) throw new BadRequestException("GSAK log date is required");
  const time = text(row.time, 8) ?? "12:00:00";
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) throw new BadRequestException("Invalid GSAK log time");
  const parsed = new Date(`${day.toISOString().slice(0, 10)}T${time}.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException("Invalid GSAK log timestamp");
  return parsed;
}

function gcCode(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!/^GC[A-Z0-9]+$/.test(normalized)) throw new BadRequestException("Invalid GSAK GC code");
  return normalized;
}

function cacheRow(row: CsvRecord): CacheRow {
  const latitude = number(row.latitude, "latitude", { min: -90, max: 90 });
  const longitude = number(row.longitude, "longitude", { min: -180, max: 180 });
  const favoritePoints = number(row.favoritepoints || "0", "favorite points", { min: 0 });
  if (!Number.isSafeInteger(favoritePoints)) throw new BadRequestException("Invalid GSAK favorite points");
  return {
    gcCode: gcCode(row.gccode),
    name: text(row.name, 500) ?? gcCode(row.gccode),
    cacheType: text(row.cachetype, 100),
    difficulty: number(row.difficulty, "difficulty", { min: 1, max: 5, nullable: true }),
    terrain: number(row.terrain, "terrain", { min: 1, max: 5, nullable: true }),
    size: text(row.size, 100),
    latitude: latitude!,
    longitude: longitude!,
    country: text(row.country, 120),
    region: text(row.region, 160),
    county: text(row.county, 160),
    hiddenDate: dateOnly(row.hiddendate, "hidden date"),
    ownerName: text(row.ownername, 250),
    foundDate: dateOnly(row.founddate, "found date"),
    isFtf: flag(row.isftf),
    isOwner: flag(row.isowner),
    favoritePoints: favoritePoints!,
    elevationMeters: number(row.elevationmeters, "elevation", { nullable: true }),
    status: text(row.status, 100),
    isPremium: flag(row.ispremium),
    correctedLatitude: number(row.correctedlatitude, "corrected latitude", { min: -90, max: 90, nullable: true }),
    correctedLongitude: number(row.correctedlongitude, "corrected longitude", { min: -180, max: 180, nullable: true }),
    hasCorrected: flag(row.hascorrected),
    userNote: text(row.usernote, 100_000),
    attributes: String(row.attributes ?? "")
      .split("|")
      .map((item) => item.match(/^(\d+):([01])$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({ id: match[1]!, inc: match[2]! }))
  };
}

function cacheNameIsPlaceholder(name: unknown, gcCode: string): boolean {
  const normalizedName = String(name ?? "").trim().toUpperCase();
  return !normalizedName || normalizedName === gcCode.toUpperCase();
}

function cacheMetadataUpdate(existing: Record<string, any>, row: CacheRow): Prisma.CacheUncheckedUpdateInput {
  const update: Prisma.CacheUncheckedUpdateInput = {};
  if (row.name !== row.gcCode && cacheNameIsPlaceholder(existing.name, row.gcCode)) {
    update.name = row.name;
  }
  return update;
}

function logRow(row: CsvRecord): LogRow {
  return {
    gcCode: gcCode(row.gccode),
    logId: text(row.logid, 100),
    type: text(row.type, 100) ?? "Found it",
    finder: text(row.finder, 250) ?? "Unknown",
    date: logDate(row),
    text: text(row.text, 250_000) ?? "",
    latitude: text(row.latitude, 50),
    longitude: text(row.longitude, 50),
    ownerId: text(row.ownerid, 100),
    isOwnLog: flag(row.isownlog),
    cacheIsOwned: flag(row.cacheisowned)
  };
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, any>) } : {};
}

function cacheRaw(existing: unknown, row: CacheRow) {
  const root = object(existing);
  const cacheKey = root["groundspeak:cache"] !== undefined || root.cache === undefined ? "groundspeak:cache" : "cache";
  const extension = object(root[cacheKey]);
  const attributes = row.attributes.map((attribute) => ({ id: attribute.id, inc: attribute.inc }));
  return {
    ...root,
    lat: String(row.latitude),
    lon: String(row.longitude),
    ele: row.elevationMeters == null ? root.ele : String(row.elevationMeters),
    name: row.gcCode,
    desc: row.name,
    [cacheKey]: {
      ...extension,
      "groundspeak:name": row.name,
      "groundspeak:type": row.cacheType,
      "groundspeak:container": row.size,
      "groundspeak:difficulty": row.difficulty,
      "groundspeak:terrain": row.terrain,
      "groundspeak:country": row.country,
      "groundspeak:state": row.region,
      "groundspeak:county": row.county,
      "groundspeak:owner": row.ownerName,
      "groundspeak:favorite_points": String(row.favoritePoints),
      ...(attributes.length ? { "groundspeak:attributes": { "groundspeak:attribute": attributes } } : {})
    },
    "gsak:wptExtension": {
      ...object(root["gsak:wptExtension"]),
      "gsak:UserFound": row.foundDate?.toISOString() ?? null,
      "gsak:FTF": row.isFtf,
      "gsak:Status": row.status,
      "gsak:IsPremium": row.isPremium,
      "gsak:UserNote": row.userNote
    }
  };
}

function rawLog(row: LogRow) {
  return {
    "groundspeak:date": row.date.toISOString(),
    "groundspeak:type": row.type,
    "groundspeak:finder": row.finder,
    "groundspeak:text": row.text,
    ...(row.logId ? { "geostats:log_id": row.logId } : {}),
    ...(row.ownerId ? { "geostats:finder_id": row.ownerId } : {}),
    ...(row.latitude ? { "groundspeak:lat": row.latitude } : {}),
    ...(row.longitude ? { "groundspeak:lon": row.longitude } : {})
  };
}

function rawLogId(log: Record<string, any>): string | null {
  const value = log["geostats:log_id"] ?? log.logId ?? log.id;
  return value == null || !String(value).trim() ? null : String(value).trim();
}

function rawLogKey(log: Record<string, any>) {
  const day = String(log["groundspeak:date"] ?? log.date ?? "").slice(0, 10);
  return [day, log["groundspeak:type"] ?? log.type, log["groundspeak:finder"] ?? log.finder, log["groundspeak:text"] ?? log.text]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("\u001f");
}

function mergeReceivedLogs(raw: unknown, incoming: Record<string, any>[]) {
  const root = object(raw);
  const cacheKey = root["groundspeak:cache"] !== undefined || root.cache === undefined ? "groundspeak:cache" : "cache";
  const extension = object(root[cacheKey]);
  const logsKey = extension["groundspeak:logs"] !== undefined || extension.logs === undefined ? "groundspeak:logs" : "logs";
  const logKey = logsKey === "groundspeak:logs" ? "groundspeak:log" : "log";
  const currentContainer = object(extension[logsKey]);
  const currentValue = currentContainer[logKey];
  const current = Array.isArray(currentValue) ? [...currentValue] : currentValue && typeof currentValue === "object" ? [currentValue] : [];
  const ids = new Set(current.map(rawLogId).filter((value): value is string => Boolean(value)));
  const keys = new Set(current.map(rawLogKey));
  let added = 0;
  for (const log of incoming) {
    const id = rawLogId(log);
    const key = rawLogKey(log);
    if ((id && ids.has(id)) || keys.has(key)) continue;
    if (id) ids.add(id);
    keys.add(key);
    current.push(log);
    added += 1;
  }
  return {
    added,
    count: current.filter((log) => String(log["groundspeak:type"] ?? log.type ?? "").toLowerCase() !== "publish listing").length,
    raw: { ...root, [cacheKey]: { ...extension, [logsKey]: { ...currentContainer, [logKey]: current } } }
  };
}

function detectsFtf(logText: string, terms: string[]) {
  const normalized = logText.toLowerCase();
  return terms.some((term) => term.trim() && normalized.includes(term.trim().toLowerCase()));
}

function cacheMarkedFtf(raw: unknown) {
  const value = object(raw)["gsak:wptExtension"];
  return flag(object(value)["gsak:FTF"]);
}

@Injectable()
export class GsakImportService {
  constructor(private readonly prisma: PrismaService, private readonly stats: StatsService) {}

  /**
   * Return cache codes that were discovered in a trackable journey but are not
   * linked to a named cache in the user's archive. The GSAK connector requests
   * this list in pages, loads those codes through Geocaching.com, and then
   * includes the resulting cache records in its normal export.
   */
  async trackableCacheCodes(userId: string, skipInput: unknown, takeInput: unknown) {
    const parsedSkip = Number(skipInput);
    const parsedTake = Number(takeInput);
    const skip = Number.isSafeInteger(parsedSkip) && parsedSkip >= 0 ? parsedSkip : 0;
    const take = Number.isSafeInteger(parsedTake) && parsedTake > 0 ? Math.min(parsedTake, 500) : 500;
    const [countRows, codeRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
        SELECT COUNT(DISTINCT COALESCE(l.gc_code, c.gc_code)) AS count
        FROM "trackable_logs" l
        LEFT JOIN "caches" c ON c.id = l.cache_id
        WHERE l.user_id = ${userId}
          AND COALESCE(l.gc_code, c.gc_code) IS NOT NULL
          AND (l.cache_id IS NULL OR upper(trim(c.name)) = upper(trim(c.gc_code)))
      `),
      this.prisma.$queryRaw<Array<{ gcCode: string }>>(Prisma.sql`
        SELECT COALESCE(l.gc_code, c.gc_code) AS "gcCode"
        FROM "trackable_logs" l
        LEFT JOIN "caches" c ON c.id = l.cache_id
        WHERE l.user_id = ${userId}
          AND COALESCE(l.gc_code, c.gc_code) IS NOT NULL
          AND (l.cache_id IS NULL OR upper(trim(c.name)) = upper(trim(c.gc_code)))
        GROUP BY COALESCE(l.gc_code, c.gc_code)
        ORDER BY COALESCE(l.gc_code, c.gc_code)
        OFFSET ${skip}
        LIMIT ${take}
      `)
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    return {
      total: Number.isFinite(total) && total >= 0 ? total : 0,
      codes: codeRows.map((row) => row.gcCode).filter((code) => Boolean(code)).join(",")
    };
  }

  async importBatch(userId: string, kind: unknown, csv: unknown) {
    if (kind === "caches") return this.importCaches(userId, gsakCsvRecords(csv).map(cacheRow));
    if (kind === "logs") return this.importLogs(userId, gsakCsvRecords(csv).map(logRow));
    if (kind === "complete") {
      const snapshot = await this.stats.buildSnapshotForUser(userId);
      await this.prisma.$transaction(async (tx) => {
        await this.stats.replaceSnapshotForUser(userId, snapshot, tx);
        await tx.import.create({
          data: {
            userId,
            fileName: "GSAK database",
            fileType: ImportFileType.JSON,
            source: ImportSource.GSAK,
            status: ImportStatus.COMPLETED,
            objectKey: `gsak/${userId}/${Date.now()}.json`
          }
        });
      });
      return { completed: true };
    }
    throw new BadRequestException("GSAK import kind must be caches, logs, or complete");
  }

  private async importCaches(userId: string, rows: CacheRow[]) {
    const existing = await this.prisma.cache.findMany({
      where: { gcCode: { in: rows.map((row) => row.gcCode) } },
      include: { userData: { where: { userId }, take: 1 } }
    });
    const existingByCode = new Map(existing.map((cache) => [cache.gcCode, cache]));
    let hides = 0;
    let corrections = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const raw = cacheRaw(existingByCode.get(row.gcCode)?.userData?.[0]?.raw, row) as Prisma.InputJsonValue;
        const existingCache = existingByCode.get(row.gcCode);
        const cache = await tx.cache.upsert({
          where: { gcCode: row.gcCode },
          create: {
            gcCode: row.gcCode,
            name: row.name,
            cacheType: row.cacheType,
            difficulty: row.difficulty,
            terrain: row.terrain,
            size: row.size,
            latitude: row.latitude,
            longitude: row.longitude,
            country: row.country,
            region: row.region,
            county: row.county,
            hiddenDate: row.hiddenDate,
            ownerName: row.ownerName
          },
          update: existingCache ? cacheMetadataUpdate(existingCache, row) : {}
        });
        await tx.userCacheData.upsert({
          where: { userId_cacheId: { userId, cacheId: cache.id } },
          create: { userId, cacheId: cache.id, raw },
          update: { raw }
        });
        // Journey imports keep cache metadata on the user's movement log until
        // a trusted GSAK/cache import supplies the shared cache record. Link
        // those existing rows now so the missing-cache queue is cleared.
        if (tx.trackableLog) {
          await tx.trackableLog.updateMany({
            where: { userId, gcCode: row.gcCode, cacheId: null },
            data: { cacheId: cache.id }
          });
        }
        if (row.isOwner) {
          await tx.hide.upsert({
            where: { userId_cacheId: { userId, cacheId: cache.id } },
            create: { userId, cacheId: cache.id, placedAt: row.hiddenDate, receivedLogCount: 0, receivedLogsRaw: raw },
            update: { placedAt: row.hiddenDate }
          });
          hides += 1;
        }
        if (row.hasCorrected && row.correctedLatitude != null && row.correctedLongitude != null) {
          await tx.correctedCoordinate.upsert({
            where: { userId_cacheId: { userId, cacheId: cache.id } },
            create: { userId, cacheId: cache.id, latitude: row.correctedLatitude, longitude: row.correctedLongitude, note: row.userNote },
            update: { latitude: row.correctedLatitude, longitude: row.correctedLongitude, note: row.userNote }
          });
          corrections += 1;
        }
      }
    });
    return { caches: rows.length, hides, corrections };
  }

  private async importLogs(userId: string, rows: LogRow[]) {
    const codes = [...new Set(rows.map((row) => row.gcCode))];
    const [caches, hides, profile] = await Promise.all([
      this.prisma.cache.findMany({
        where: { gcCode: { in: codes }, userData: { some: { userId } } },
        include: { userData: { where: { userId }, take: 1 } }
      }),
      this.prisma.hide.findMany({ where: { userId, cache: { gcCode: { in: codes } } }, include: { cache: true } }),
      this.prisma.geocachingProfile.findUnique({ where: { userId }, select: { ftfDetectionTerms: true } })
    ]);
    const cacheByCode = new Map(caches.map((cache) => [cache.gcCode, cache]));
    const missing = codes.filter((code) => !cacheByCode.has(code));
    if (missing.length) throw new BadRequestException(`GSAK logs reference caches that were not imported: ${missing.join(", ")}`);
    const hideByCode = new Map(hides.map((hide) => [hide.cache.gcCode, hide]));
    const receivedByCode = new Map<string, Record<string, any>[]>();
    for (const row of rows.filter((row) => row.cacheIsOwned)) {
      receivedByCode.set(row.gcCode, [...(receivedByCode.get(row.gcCode) ?? []), rawLog(row)]);
    }
    let finds = 0;
    let receivedLogs = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of rows.filter((row) => row.isOwnLog && FOUND_LOG_TYPES.has(row.type.toLowerCase()))) {
        const cache = cacheByCode.get(row.gcCode)!;
        const foundDate = new Date(`${row.date.toISOString().slice(0, 10)}T00:00:00.000Z`);
        const isFtf = cacheMarkedFtf(cache.userData?.[0]?.raw) || detectsFtf(row.text, profile?.ftfDetectionTerms ?? ["FTF", "first to find"]);
        const existing = await tx.find.findFirst({
          where: { userId, cacheId: cache.id, foundDate },
          orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }]
        });
        const adjacentExisting = existing
          ? null
          : await tx.find.findMany({
              where: {
                userId,
                cacheId: cache.id,
                importedFrom: { not: ImportSource.GSAK },
                foundDate: {
                  gte: new Date(foundDate.getTime() - 86_400_000),
                  lte: new Date(foundDate.getTime() + 86_400_000)
                }
              },
              orderBy: [{ foundAt: "asc" }, { createdAt: "asc" }],
              take: 2
            });
        const matchingFind = existing ?? (adjacentExisting?.length === 1 ? adjacentExisting[0] : null);
        if (matchingFind) {
          await tx.find.update({
            where: { id: matchingFind.id },
            data: {
              foundAt: row.date,
              foundDate,
              logText: row.text,
              importedFrom: ImportSource.GSAK,
              ...(!matchingFind.isFtfManual ? { isFtf } : {})
            }
          });
        } else {
          await tx.find.create({
            data: { userId, cacheId: cache.id, foundAt: row.date, foundDate, logText: row.text, isFtf, importedFrom: ImportSource.GSAK }
          });
        }
        finds += 1;
      }
      const receivedEntries = [...receivedByCode.entries()].sort(([left], [right]) => left.localeCompare(right));
      for (const [code, incoming] of receivedEntries) {
        const hide = hideByCode.get(code);
        if (!hide) throw new BadRequestException(`GSAK marks ${code} as owned, but no hide record exists`);
        const [current] = await tx.$queryRaw<Array<{ id: string; receivedLogsRaw: Prisma.JsonValue | null }>>(Prisma.sql`
          SELECT "id", "received_logs_raw" AS "receivedLogsRaw"
          FROM "hides"
          WHERE "id" = ${hide.id} AND "user_id" = ${userId}
          FOR UPDATE
        `);
        if (!current) throw new BadRequestException(`GSAK hide disappeared during import: ${code}`);
        const merged = mergeReceivedLogs(current.receivedLogsRaw, incoming);
        await tx.hide.update({
          where: { id: current.id },
          data: { receivedLogCount: merged.count, receivedLogsRaw: merged.raw as Prisma.InputJsonValue }
        });
        receivedLogs += merged.added;
      }
    });
    return { logs: rows.length, finds, receivedLogs };
  }
}
