import { Injectable } from "@nestjs/common";
import { Prisma } from "@geostats/db";
import { parseTrackableImportFile, type ParsedTrackable, type ParsedTrackableImport, type ParsedTrackableLog, type ParsedTrackableLogType } from "@geostats/gpx-parser";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../common/prisma.service";

const TRACKABLE_IMPORT_MAX_BYTES = 25 * 1024 * 1024;
const TRACKABLE_IMPORT_MAX_LOGS = 100_000;
const TRACKABLE_IMPORT_MAX_TRACKABLES = 10_000;
const TRACKABLE_IMPORT_QUERY_BATCH_SIZE = 5_000;
const TRACKABLE_IMPORT_WRITE_BATCH_SIZE = 500;

type PreparedLog = ParsedTrackableLog & {
  cacheId: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceKey: string;
};

type TrackableWrite = {
  id: string;
  userId: string;
  trackingCode: string;
  name: string;
  state: string;
  lastSeenAt: Date | null;
  lastSeenLocation: string | null;
  distanceKm: Prisma.Decimal | null;
  notes: string | null;
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function batches<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function trackingCode(value: string): string {
  return value.trim().toUpperCase();
}

function gcCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed && /^GC[A-Z0-9]{2,20}$/.test(trimmed) ? trimmed : null;
}

function validCoordinate(latitude: number | null | undefined, longitude: number | null | undefined): boolean {
  return latitude != null && longitude != null && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function dayValue(value: Date | null | undefined): Date | null {
  if (!value || !Number.isFinite(value.getTime())) return null;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function stateFromLog(logType: ParsedTrackableLogType): string | null {
  if (logType === "GRABBED" || logType === "RETRIEVED") return "RETRIEVED";
  if (logType === "DISCOVERED" || logType === "DROPPED" || logType === "VISITED" || logType === "MISSING") return logType;
  return null;
}

function jsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function dateEstimated(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).__geostatsKmlDateEstimated === true);
}

function trackingCodeInferred(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).__geostatsKmlTrackingCodeInferred === true);
}

function logSourceKey(log: ParsedTrackableLog): string {
  const normalized = [
    trackingCode(log.trackingCode),
    log.logType,
    log.loggedAt.toISOString(),
    dateEstimated(log.raw) ? "estimated" : "exact",
    gcCode(log.gcCode) ?? "",
    log.latitude == null ? "" : log.latitude.toFixed(6),
    log.longitude == null ? "" : log.longitude.toFixed(6),
    cleanText(log.notes) ?? ""
  ].join("\u001f");
  return createHash("sha256").update(normalized).digest("hex");
}

function haversineKm(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sourceName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.includes("gsak")) return "GSAK";
  if (lower.endsWith(".json")) return "GEOCACHING_API";
  if (lower.endsWith(".kml") || lower.endsWith(".kmz")) return "GEOCACHING_KML";
  if (lower.endsWith(".csv")) return "TRACKABLE_CSV";
  return "TRACKABLE_GPX";
}

@Injectable()
export class TrackablesImportService {
  constructor(private readonly prisma: PrismaService) {}

  async parse(fileName: string, content: Buffer, suppliedTrackingCode?: string | null): Promise<ParsedTrackableImport> {
    if (content.length > TRACKABLE_IMPORT_MAX_BYTES) {
      throw new Error(`Trackable import exceeds ${TRACKABLE_IMPORT_MAX_BYTES} bytes`);
    }
    const parsed = await parseTrackableImportFile(fileName, content, suppliedTrackingCode);
    if (parsed.logs.length > TRACKABLE_IMPORT_MAX_LOGS) {
      throw new Error(`Trackable import contains more than ${TRACKABLE_IMPORT_MAX_LOGS} movement logs`);
    }
    return parsed;
  }

  async import(userId: string, fileName: string, content: Buffer, suppliedTrackingCode?: string | null) {
    const parsed = await this.parse(fileName, content, suppliedTrackingCode);
    const source = sourceName(fileName);
    const metadataByCode = new Map<string, ParsedTrackable>();
    for (const item of parsed.trackables) {
      const code = trackingCode(item.trackingCode);
      if (!code) continue;
      const current = metadataByCode.get(code);
      if (!current || (item.lastSeenAt?.getTime() ?? 0) >= (current.lastSeenAt?.getTime() ?? 0)) {
        metadataByCode.set(code, { ...item, trackingCode: code, name: cleanText(item.name) ?? code });
      }
    }
    const uniqueLogs = new Map<string, ParsedTrackableLog>();
    for (const log of parsed.logs) {
      const code = trackingCode(log.trackingCode);
      if (!code || !Number.isFinite(log.loggedAt.getTime())) continue;
      const normalized = { ...log, trackingCode: code };
      uniqueLogs.set(logSourceKey(normalized), normalized);
      if (!metadataByCode.has(code)) {
        metadataByCode.set(code, { trackingCode: code, name: cleanText(log.trackableName) ?? code, raw: log.raw });
      }
    }
    if (metadataByCode.size > TRACKABLE_IMPORT_MAX_TRACKABLES) {
      throw new Error(`Trackable import contains more than ${TRACKABLE_IMPORT_MAX_TRACKABLES} trackables`);
    }

    const logRows = [...uniqueLogs.entries()].map(([sourceKey, log]) => ({ ...log, sourceKey }));
    const cacheCodes = new Set<string>();
    for (const item of metadataByCode.values()) {
      const code = gcCode(item.gcCode);
      if (code) {
        cacheCodes.add(code);
      }
    }
    for (const log of logRows) {
      const code = gcCode(log.gcCode);
      if (code) {
        cacheCodes.add(code);
      }
    }

    // A journey export can contain hundreds (or thousands) of cache stops. The
    // default Prisma interactive-transaction timeout is only five seconds,
    // which is too short for the per-trackable upsert work below on the
    // Pi. Keep the import atomic, but give it the same bounded two-minute
    // transaction window used by the larger portability importer.
    const result = await this.prisma.$transaction(async (tx) => {
      const cacheCodeList = [...cacheCodes];
      // Cache rows are shared across users and must only be populated by a
      // trusted cache import. Journey metadata is kept on TrackableLog below.
      const existingCaches = (
        await Promise.all(
          batches(cacheCodeList, TRACKABLE_IMPORT_QUERY_BATCH_SIZE).map((batch) =>
            tx.cache.findMany({
              where: { gcCode: { in: batch } },
              select: { id: true, gcCode: true, name: true, latitude: true, longitude: true }
            })
          )
        )
      ).flat();
      const cachesByCode = new Map<string, { id: string; name: string; latitude: number; longitude: number }>(
        existingCaches.map((cache) => [cache.gcCode, {
          id: cache.id,
          name: cache.name,
          latitude: Number(cache.latitude),
          longitude: Number(cache.longitude)
        }])
      );
      const unresolved = new Set(cacheCodeList.filter((code) => !cachesByCode.has(code)));

      const preparedLogs: PreparedLog[] = [];
      for (const log of logRows) {
        const code = gcCode(log.gcCode);
        const cache = code ? cachesByCode.get(code) ?? null : null;
        const latitude = validCoordinate(log.latitude, log.longitude) ? log.latitude! : cache?.latitude ?? null;
        const longitude = validCoordinate(log.latitude, log.longitude) ? log.longitude! : cache?.longitude ?? null;
        preparedLogs.push({ ...log, cacheId: cache?.id ?? null, latitude, longitude, sourceKey: log.sourceKey });
      }

      const logsByTrackable = new Map<string, PreparedLog[]>();
      for (const log of preparedLogs) {
        const logs = logsByTrackable.get(log.trackingCode);
        if (logs) logs.push(log);
        else logsByTrackable.set(log.trackingCode, [log]);
      }
      const trackableCodes = [...metadataByCode.keys()];
      const existingTrackables = (
        await Promise.all(
          batches(trackableCodes, TRACKABLE_IMPORT_QUERY_BATCH_SIZE).map((batch) =>
            tx.trackable.findMany({
              where: { userId, trackingCode: { in: batch } },
              select: {
                id: true,
                trackingCode: true,
                name: true,
                state: true,
                lastSeenAt: true,
                lastSeenLocation: true,
                distanceKm: true,
                notes: true
              }
            })
          )
        )
      ).flat();
      const existingTrackableByCode = new Map(existingTrackables.map((trackable) => [trackable.trackingCode, trackable]));
      const trackableWrites: TrackableWrite[] = [];
      for (const [code, metadata] of metadataByCode) {
        const codeLogs = [...(logsByTrackable.get(code) ?? [])].sort((left, right) => left.loggedAt.getTime() - right.loggedAt.getTime());
        const latestLog = codeLogs.at(-1);
        const latestDatedLog = [...codeLogs].reverse().find((log) => !dateEstimated(log.raw));
        const latestDate = latestDatedLog?.loggedAt ?? metadata.lastSeenAt ?? null;
        const latestLocation = latestLog?.locationName ?? latestLog?.cacheName ?? latestLog?.gcCode ?? metadata.lastSeenLocation ?? metadata.cacheName ?? metadata.gcCode ?? null;
        const explicitDistance = metadata.distanceKm ?? codeLogs.reduce<number | null>((value, log) => value ?? null, null);
        const coordinateLogs = codeLogs.filter((log): log is PreparedLog & { latitude: number; longitude: number } => validCoordinate(log.latitude, log.longitude));
        const calculatedDistance = coordinateLogs.slice(1).reduce((total, log, index) => total + haversineKm(coordinateLogs[index]!, log), 0);
        const distanceKm = explicitDistance ?? (calculatedDistance > 0 ? calculatedDistance : null);
        const desiredState = stateFromLog(latestLog?.logType ?? "NOTE") ?? metadata.state ?? "DISCOVERED";
        const existing = existingTrackableByCode.get(code);
        trackableWrites.push({
          id: randomUUID(),
          userId,
          trackingCode: code,
          name: cleanText(metadata.name) ?? existing?.name ?? code,
          state: desiredState,
          lastSeenAt: latestDate ? dayValue(latestDate) : existing?.lastSeenAt ?? null,
          lastSeenLocation: latestLocation ? cleanText(latestLocation) : existing?.lastSeenLocation ?? null,
          distanceKm: distanceKm != null
            ? new Prisma.Decimal(Math.max(0, distanceKm))
            : existing?.distanceKm ?? null,
          notes: metadata.notes !== undefined ? cleanText(metadata.notes) : existing?.notes ?? null
        });
      }

      // Use one PostgreSQL upsert per bounded batch instead of one interactive
      // transaction round trip for every distinct trackable in the file.
      for (const batch of batches(trackableWrites, TRACKABLE_IMPORT_WRITE_BATCH_SIZE)) {
        const values = batch.map((trackable) => Prisma.sql`(
          ${trackable.id},
          ${trackable.userId},
          ${trackable.trackingCode},
          ${trackable.name},
          ${trackable.state}::"TrackableState",
          ${trackable.lastSeenAt},
          ${trackable.lastSeenLocation},
          ${trackable.distanceKm},
          ${trackable.notes}
        )`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "trackables" (
            "id", "user_id", "tracking_code", "name", "state", "last_seen_at",
            "last_seen_location", "distance_km", "notes"
          )
          VALUES ${Prisma.join(values)}
          ON CONFLICT ("user_id", "tracking_code") DO UPDATE SET
            "name" = EXCLUDED."name",
            "state" = EXCLUDED."state",
            "last_seen_at" = EXCLUDED."last_seen_at",
            "last_seen_location" = EXCLUDED."last_seen_location",
            "distance_km" = EXCLUDED."distance_km",
            "notes" = EXCLUDED."notes",
            "updated_at" = CURRENT_TIMESTAMP
        `);
      }

      const storedTrackables = (
        await Promise.all(
          batches(trackableCodes, TRACKABLE_IMPORT_QUERY_BATCH_SIZE).map((batch) =>
            tx.trackable.findMany({
              where: { userId, trackingCode: { in: batch } },
              select: { id: true, trackingCode: true }
            })
          )
        )
      ).flat();
      const trackableIds = new Map(storedTrackables.map((trackable) => [trackable.trackingCode, trackable.id]));

      const sourceKeys = preparedLogs.map((log) => log.sourceKey);
      const existingKeys = new Set(
        (
          await Promise.all(
            batches(sourceKeys, TRACKABLE_IMPORT_QUERY_BATCH_SIZE).map((batch) =>
              tx.trackableLog.findMany({ where: { userId, sourceKey: { in: batch } }, select: { sourceKey: true } })
            )
          )
        ).flat().map((row) => row.sourceKey)
      );
      const newLogs = preparedLogs.filter((log) => !existingKeys.has(log.sourceKey));
      for (const batch of batches(newLogs, TRACKABLE_IMPORT_WRITE_BATCH_SIZE)) {
        await tx.trackableLog.createMany({
          data: batch.map((log) => ({
              userId,
              trackableId: trackableIds.get(log.trackingCode)!,
              cacheId: log.cacheId,
              gcCode: gcCode(log.gcCode),
              cacheName: cleanText(log.cacheName),
              logType: log.logType,
              loggedAt: log.loggedAt,
              locationName: cleanText(log.locationName),
              holderName: cleanText(log.holderName),
              latitude: validCoordinate(log.latitude, log.longitude) ? log.latitude : null,
              longitude: validCoordinate(log.latitude, log.longitude) ? log.longitude : null,
              notes: cleanText(log.notes),
              source,
              sourceKey: log.sourceKey,
              raw: jsonValue(log.raw)
            }))
        });
      }
      return {
        importedTrackables: metadataByCode.size,
        importedLogs: newLogs.length,
        estimatedLogs: newLogs.filter((log) => dateEstimated(log.raw)).length,
        inferredTrackables: [...metadataByCode.values()].filter((item) => trackingCodeInferred(item.raw)).length,
        skippedLogs: preparedLogs.length - newLogs.length,
        importedCaches: cacheCodes.size - unresolved.size,
        unresolvedCaches: [...unresolved].sort(),
        source
      };
    }, { maxWait: 10_000, timeout: 120_000 });
    return result;
  }
}
