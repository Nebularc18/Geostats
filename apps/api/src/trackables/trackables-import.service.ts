import { Injectable } from "@nestjs/common";
import { Prisma, TrackableLogType } from "@geostats/db";
import { parseTrackableImportFile, type ParsedTrackable, type ParsedTrackableImport, type ParsedTrackableLog, type ParsedTrackableLogType } from "@geostats/gpx-parser";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";

const TRACKABLE_IMPORT_MAX_BYTES = 25 * 1024 * 1024;
const TRACKABLE_IMPORT_MAX_LOGS = 100_000;

type PreparedLog = ParsedTrackableLog & {
  cacheId: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceKey: string;
};

type CacheInput = {
  cacheName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raw?: unknown;
};

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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

function prismaLogType(logType: ParsedTrackableLogType): TrackableLogType {
  return logType as TrackableLogType;
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

    const logRows = [...uniqueLogs.entries()].map(([sourceKey, log]) => ({ ...log, sourceKey }));
    const cacheCodes = new Set<string>();
    const cacheInputs = new Map<string, CacheInput>();
    const rememberCacheInput = (code: string, item: CacheInput) => {
      const previous = cacheInputs.get(code);
      const hasCoordinates = validCoordinate(item.latitude, item.longitude);
      cacheInputs.set(code, {
        cacheName: cleanText(item.cacheName) ?? previous?.cacheName ?? null,
        latitude: hasCoordinates ? item.latitude! : previous?.latitude ?? null,
        longitude: hasCoordinates ? item.longitude! : previous?.longitude ?? null,
        raw: item.raw ?? previous?.raw
      });
    };
    for (const item of metadataByCode.values()) {
      const code = gcCode(item.gcCode);
      if (code) {
        cacheCodes.add(code);
        rememberCacheInput(code, item);
      }
    }
    for (const log of logRows) {
      const code = gcCode(log.gcCode);
      if (code) {
        cacheCodes.add(code);
        rememberCacheInput(code, log);
      }
    }

    // A journey export can contain hundreds (or thousands) of cache stops. The
    // default Prisma interactive-transaction timeout is only five seconds,
    // which is too short for the per-cache enrichment/upsert work below on the
    // Pi. Keep the import atomic, but give it the same bounded two-minute
    // transaction window used by the larger portability importer.
    const result = await this.prisma.$transaction(async (tx) => {
      const cacheCodeList = [...cacheInputs.keys()];
      const existingCaches = cacheCodeList.length === 0
        ? []
        : await tx.cache.findMany({
            where: { gcCode: { in: cacheCodeList } },
            select: { id: true, gcCode: true, name: true, latitude: true, longitude: true }
          });
      const existingByCode = new Map(existingCaches.map((cache) => [cache.gcCode, cache]));
      const cacheRowsToCreate = cacheCodeList.flatMap((code) => {
        const input = cacheInputs.get(code)!;
        if (existingByCode.has(code) || !validCoordinate(input.latitude, input.longitude)) return [];
        return [{
          gcCode: code,
          name: cleanText(input.cacheName) ?? code,
          latitude: input.latitude!,
          longitude: input.longitude!
        }];
      });
      if (cacheRowsToCreate.length > 0) {
        await tx.cache.createMany({ data: cacheRowsToCreate, skipDuplicates: true });
      }
      const storedCaches = cacheCodeList.length === 0
        ? []
        : await tx.cache.findMany({
            where: { gcCode: { in: cacheCodeList } },
            select: { id: true, gcCode: true, name: true, latitude: true, longitude: true }
          });
      const cachesByCode = new Map<string, { id: string; name: string; latitude: number; longitude: number }>(
        storedCaches.map((cache) => [cache.gcCode, {
          id: cache.id,
          name: cache.name,
          latitude: Number(cache.latitude),
          longitude: Number(cache.longitude)
        }])
      );
      const unresolved = new Set(cacheCodeList.filter((code) => !cachesByCode.has(code)));

      // Preserve the old enrichment behavior for cache rows already in the
      // archive, while avoiding one lookup and one upsert for every log point.
      for (const existing of existingCaches) {
        const input = cacheInputs.get(existing.gcCode);
        if (!input) continue;
        const hasCoordinates = validCoordinate(input.latitude, input.longitude);
        const normalizedName = cleanText(input.cacheName);
        const coordinatesChanged = hasCoordinates && (Number(existing.latitude) !== input.latitude || Number(existing.longitude) !== input.longitude);
        const nameChanged = normalizedName != null && normalizedName !== existing.name;
        if (coordinatesChanged || nameChanged) {
          await tx.cache.update({
            where: { id: existing.id },
            data: {
              ...(nameChanged ? { name: normalizedName! } : {}),
              ...(coordinatesChanged ? { latitude: input.latitude!, longitude: input.longitude! } : {})
            }
          });
          const cached = cachesByCode.get(existing.gcCode);
          if (cached) {
            cachesByCode.set(existing.gcCode, {
              ...cached,
              ...(nameChanged ? { name: normalizedName! } : {}),
              ...(coordinatesChanged ? { latitude: input.latitude!, longitude: input.longitude! } : {})
            });
          }
        }
      }

      const userCacheDataRows: Array<{ userId: string; cacheId: string; raw: Prisma.InputJsonValue }> = [];
      for (const created of cacheRowsToCreate) {
        const cache = cachesByCode.get(created.gcCode);
        const raw = jsonValue(cacheInputs.get(created.gcCode)?.raw);
        if (cache && raw !== undefined) userCacheDataRows.push({ userId, cacheId: cache.id, raw });
      }
      if (userCacheDataRows.length > 0) {
        await tx.userCacheData.createMany({ data: userCacheDataRows, skipDuplicates: true });
      }

      const preparedLogs: PreparedLog[] = [];
      for (const log of logRows) {
        const code = gcCode(log.gcCode);
        const cache = code ? cachesByCode.get(code) ?? null : null;
        const latitude = validCoordinate(log.latitude, log.longitude) ? log.latitude! : cache?.latitude ?? null;
        const longitude = validCoordinate(log.latitude, log.longitude) ? log.longitude! : cache?.longitude ?? null;
        preparedLogs.push({ ...log, cacheId: cache?.id ?? null, latitude, longitude, sourceKey: log.sourceKey });
      }

      const trackableIds = new Map<string, string>();
      for (const [code, metadata] of metadataByCode) {
        const codeLogs = preparedLogs.filter((log) => log.trackingCode === code).sort((left, right) => left.loggedAt.getTime() - right.loggedAt.getTime());
        const latestLog = codeLogs.at(-1);
        const latestDatedLog = [...codeLogs].reverse().find((log) => !dateEstimated(log.raw));
        const latestDate = latestDatedLog?.loggedAt ?? metadata.lastSeenAt ?? null;
        const latestLocation = latestLog?.locationName ?? latestLog?.cacheName ?? latestLog?.gcCode ?? metadata.lastSeenLocation ?? metadata.cacheName ?? metadata.gcCode ?? null;
        const explicitDistance = metadata.distanceKm ?? codeLogs.reduce<number | null>((value, log) => value ?? null, null);
        const coordinateLogs = codeLogs.filter((log): log is PreparedLog & { latitude: number; longitude: number } => validCoordinate(log.latitude, log.longitude));
        const calculatedDistance = coordinateLogs.slice(1).reduce((total, log, index) => total + haversineKm(coordinateLogs[index]!, log), 0);
        const distanceKm = explicitDistance ?? (calculatedDistance > 0 ? calculatedDistance : null);
        const desiredState = stateFromLog(latestLog?.logType ?? "NOTE") ?? metadata.state ?? "DISCOVERED";
        const existing = await tx.trackable.findUnique({ where: { userId_trackingCode: { userId, trackingCode: code } }, select: { id: true } });
        const row = await tx.trackable.upsert({
          where: { userId_trackingCode: { userId, trackingCode: code } },
          create: {
            userId,
            trackingCode: code,
            name: cleanText(metadata.name) ?? code,
            state: desiredState as any,
            lastSeenAt: dayValue(latestDate),
            lastSeenLocation: cleanText(latestLocation),
            distanceKm: distanceKm == null ? null : new Prisma.Decimal(Math.max(0, distanceKm)),
            notes: cleanText(metadata.notes)
          },
          update: {
            ...(cleanText(metadata.name) ? { name: cleanText(metadata.name)! } : {}),
            ...(desiredState ? { state: desiredState as any } : {}),
            ...(latestDate ? { lastSeenAt: dayValue(latestDate) } : {}),
            ...(latestLocation ? { lastSeenLocation: cleanText(latestLocation) } : {}),
            ...(distanceKm != null ? { distanceKm: new Prisma.Decimal(Math.max(0, distanceKm)) } : {}),
            ...(metadata.notes !== undefined ? { notes: cleanText(metadata.notes) } : {})
          },
          select: { id: true }
        });
        trackableIds.set(code, row.id);
        if (!existing && !latestDate && metadata.gcCode && !metadata.latitude && !metadata.longitude) {
          const cache = cachesByCode.get(gcCode(metadata.gcCode) ?? "");
          if (!cache) unresolved.add(gcCode(metadata.gcCode) ?? metadata.gcCode);
        }
      }

      const sourceKeys = preparedLogs.map((log) => log.sourceKey);
      const existingKeys = new Set(
        sourceKeys.length === 0
          ? []
          : (await tx.trackableLog.findMany({ where: { userId, sourceKey: { in: sourceKeys } }, select: { sourceKey: true } })).map((row) => row.sourceKey)
      );
      const newLogs = preparedLogs.filter((log) => !existingKeys.has(log.sourceKey));
      if (newLogs.length > 0) {
        await tx.trackableLog.createMany({
          data: newLogs.map((log) => ({
            userId,
            trackableId: trackableIds.get(log.trackingCode)!,
            cacheId: log.cacheId,
            logType: prismaLogType(log.logType),
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
