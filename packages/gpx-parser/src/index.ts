import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { Readable } from "node:stream";
import { parseCsvRows, ImportSource, parseCoordinate } from "@geostats/shared";

export interface ParsedCache {
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
  receivedLogCount: number;
  raw: Record<string, unknown>;
}

export interface ParsedFind {
  cache: ParsedCache;
  foundAt: Date | null;
  logText: string | null;
  source: ImportSource;
}

export interface ParsedImport {
  caches: ParsedCache[];
  finds: ParsedFind[];
}

export type ParsedTrackableState = "OWNED" | "DISCOVERED" | "RETRIEVED" | "DROPPED" | "VISITED" | "MISSING";
export type ParsedTrackableLogType = "DISCOVERED" | "RETRIEVED" | "DROPPED" | "VISITED" | "GRABBED" | "NOTE" | "MISSING";

export interface ParsedTrackable {
  trackingCode: string;
  name: string;
  state?: ParsedTrackableState | null;
  lastSeenAt?: Date | null;
  lastSeenLocation?: string | null;
  distanceKm?: number | null;
  notes?: string | null;
  gcCode?: string | null;
  cacheName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  raw: Record<string, unknown>;
}

export interface ParsedTrackableLog {
  trackingCode: string;
  trackableName?: string | null;
  logType: ParsedTrackableLogType;
  loggedAt: Date;
  gcCode?: string | null;
  cacheName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationName?: string | null;
  holderName?: string | null;
  notes?: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedTrackableImport {
  trackables: ParsedTrackable[];
  logs: ParsedTrackableLog[];
}

export interface ParseImportOptions {
  gcUsername?: string | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  parseTagValue: true,
  trimValues: true,
  processEntities: {
    enabled: true,
    maxEntityCount: 10_000,
    maxTotalExpansions: 250_000,
    maxExpandedLength: 25_000_000
  }
});

const DEFAULT_MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_ZIP_ENTRIES = 25;
const DEFAULT_MAX_ZIP_ENTRY_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ZIP_TOTAL_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_WAYPOINTS = 25_000;
export const DEFAULT_FTF_DETECTION_TERMS = ["FTF", "first to find"];

function positiveLimit(envName: string, fallback: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function byteLength(content: string | Buffer): number {
  return Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, "utf8");
}

function zipUncompressedSize(file: JSZip.JSZipObject): number | null {
  const data = (file as unknown as { _data?: { uncompressedSize?: unknown } })._data;
  return typeof data?.uncompressedSize === "number" && Number.isFinite(data.uncompressedSize)
    ? data.uncompressedSize
    : null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (value && typeof value === "object" && "text" in value && typeof value.text === "string") {
      return value.text.trim();
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  const text = firstText(value);
  if (!text) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text}Z`
      : text;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readZipEntryLimited(file: JSZip.JSZipObject, maxBytes: number): Promise<Buffer> {
  const stream = file.nodeStream("nodebuffer") as Readable;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      stream.destroy(error);
      reject(error);
    };
    stream.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        fail(new Error(`ZIP entry ${file.name} exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    stream.on("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));
    stream.on("end", () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    if (typeof (stream as unknown as { resume?: () => void }).resume === "function") {
      stream.resume();
    }
  });
}

function normalizeUsername(value: string | null | undefined): string | null {
  const username = value?.trim().toLowerCase();
  return username ? username : null;
}

function findCacheExtension(waypoint: Record<string, any>): Record<string, any> | null {
  const groundspeak = waypoint["groundspeak:cache"] ?? waypoint.cache;
  if (groundspeak && typeof groundspeak === "object") {
    return groundspeak;
  }

  const extensions = waypoint.extensions;
  if (extensions && typeof extensions === "object") {
    return extensions["groundspeak:cache"] ?? extensions.cache ?? null;
  }

  return null;
}

function findUserFoundDate(waypoint: Record<string, any>): Date | null {
  const gsak =
    waypoint["gsak:wptExtension"] ??
    waypoint.gsak?.wptExtension ??
    waypoint.extensions?.["gsak:wptExtension"] ??
    waypoint.extensions?.gsak?.wptExtension;
  if (!gsak || typeof gsak !== "object") {
    return null;
  }
  return toDate((gsak as Record<string, any>)["gsak:UserFound"] ?? (gsak as Record<string, any>).UserFound);
}

function findFoundLog(cache: Record<string, any>, userFoundDate: Date | null, gcUsername?: string | null): Record<string, any> | null {
  const logs = cache["groundspeak:logs"]?.["groundspeak:log"] ?? cache.logs?.log;
  const foundLogs = asArray<Record<string, any>>(logs).filter((log) => {
    const type = firstText(log["groundspeak:type"], log.type)?.toLowerCase();
    return type === "found it" || type === "attended" || type === "webcam photo taken";
  });
  const username = normalizeUsername(gcUsername);
  if (username) {
    const userLog = foundLogs.find((log) => normalizeUsername(firstText(log["groundspeak:finder"], log.finder)) === username);
    if (userLog) {
      return userLog;
    }
  }
  if (userFoundDate) {
    const timestamp = userFoundDate.getTime();
    const userFoundLog = foundLogs.find((log) => toDate(log["groundspeak:date"] ?? log.date)?.getTime() === timestamp);
    if (userFoundLog) {
      return userFoundLog;
    }
  }
  return foundLogs[0] ?? null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function termRegex(term: string): RegExp | null {
  const normalized = term.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }
  const pattern = escapeRegex(normalized).replace(/\\ /g, "[\\s-]+");
  const prefix = /^[a-z0-9]/i.test(normalized) ? "(^|[^a-z0-9])" : "";
  const suffix = /[a-z0-9]$/i.test(normalized) ? "([^a-z0-9]|$)" : "";
  return new RegExp(`${prefix}${pattern}${suffix}`, "i");
}

export function detectFtfLog(text: string | null, terms: string[] = DEFAULT_FTF_DETECTION_TERMS): boolean {
  if (!text) {
    return false;
  }
  return terms.some((term) => termRegex(term)?.test(text) ?? false);
}

function countReceivedLogs(cache: Record<string, any>): number {
  const logs = cache["groundspeak:logs"]?.["groundspeak:log"] ?? cache.logs?.log;
  return asArray<Record<string, any>>(logs).filter((log) => {
    const type = firstText(log["groundspeak:type"], log.type)?.toLowerCase();
    return type !== "publish listing";
  }).length;
}

function parseWaypoint(waypoint: Record<string, any>, source: ImportSource, options: ParseImportOptions = {}): ParsedFind | null {
  const lat = toNumber(waypoint.lat);
  const lon = toNumber(waypoint.lon);
  const gcCode = firstText(waypoint.name);
  const cacheExtension = findCacheExtension(waypoint);
  if (!gcCode || lat === null || lon === null || !cacheExtension) {
    return null;
  }

  const userFoundDate = findUserFoundDate(waypoint);
  const foundLog = findFoundLog(cacheExtension, userFoundDate, options.gcUsername);
  const foundLogDate = toDate(foundLog?.["groundspeak:date"] ?? foundLog?.date);
  const username = normalizeUsername(options.gcUsername);
  const foundLogMatchesUser =
    username !== null && normalizeUsername(firstText(foundLog?.["groundspeak:finder"], foundLog?.finder)) === username;
  const foundLogMatchesUserFoundDate =
    userFoundDate !== null && foundLogDate !== null && userFoundDate.getTime() === foundLogDate.getTime();
  const shouldUseFoundLogText = foundLogMatchesUser || (userFoundDate === null && username === null) || foundLogMatchesUserFoundDate;
  const placedBy = cacheExtension["groundspeak:placed_by"] ?? cacheExtension.placed_by;
  const owner = cacheExtension["groundspeak:owner"] ?? cacheExtension.owner;

  const cache: ParsedCache = {
    gcCode,
    name: firstText(cacheExtension["groundspeak:name"], cacheExtension.name, waypoint.desc, gcCode) ?? gcCode,
    cacheType: firstText(cacheExtension["groundspeak:type"], cacheExtension.type, waypoint.type),
    difficulty: toNumber(cacheExtension["groundspeak:difficulty"] ?? cacheExtension.difficulty),
    terrain: toNumber(cacheExtension["groundspeak:terrain"] ?? cacheExtension.terrain),
    size: firstText(cacheExtension["groundspeak:container"], cacheExtension.container),
    latitude: lat,
    longitude: lon,
    country: firstText(cacheExtension["groundspeak:country"], cacheExtension.country),
    region: firstText(cacheExtension["groundspeak:state"], cacheExtension.state),
    county: firstText(cacheExtension["groundspeak:county"], cacheExtension.county),
    hiddenDate: toDate(waypoint.time ?? cacheExtension["groundspeak:date_hidden"] ?? cacheExtension.date_hidden),
    ownerName: firstText(owner, placedBy),
    receivedLogCount: countReceivedLogs(cacheExtension),
    raw: waypoint
  };

  return {
    cache,
    foundAt: foundLogMatchesUser
      ? foundLogDate ?? userFoundDate
      : userFoundDate ?? (source === ImportSource.POCKET_QUERY ? null : foundLogDate),
    logText: shouldUseFoundLogText ? firstText(foundLog?.["groundspeak:text"], foundLog?.text) : null,
    source
  };
}

export function parseGpx(content: string | Buffer, source: ImportSource, options: ParseImportOptions = {}): ParsedImport {
  const maxBytes = positiveLimit("IMPORT_MAX_BYTES", DEFAULT_MAX_IMPORT_BYTES);
  if (byteLength(content) > maxBytes) {
    throw new Error(`GPX file exceeds ${maxBytes} bytes`);
  }

  const document = parser.parse(content.toString("utf8"));
  const waypoints = asArray<Record<string, any>>(document?.gpx?.wpt);
  if (waypoints.length === 0) {
    throw new Error("No GPX waypoints found");
  }
  const maxWaypoints = positiveLimit("IMPORT_MAX_WAYPOINTS", DEFAULT_MAX_WAYPOINTS);
  if (waypoints.length > maxWaypoints) {
    throw new Error(`GPX file exceeds ${maxWaypoints} waypoints`);
  }

  const parsedWaypoints = waypoints
    .map((waypoint) => parseWaypoint(waypoint, source, options))
    .filter((find): find is ParsedFind => find !== null);

  if (parsedWaypoints.length === 0) {
    throw new Error("No valid geocache waypoints found");
  }

  return {
    caches: parsedWaypoints.map((find) => find.cache),
    finds: source === ImportSource.MY_HIDES_GPX ? [] : parsedWaypoints.filter((find) => find.foundAt !== null)
  };
}

export async function parseImportFile(
  fileName: string,
  content: Buffer,
  source: ImportSource,
  options: ParseImportOptions = {}
): Promise<ParsedImport> {
  if (fileName.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(content);
    const zipEntries = Object.values(zip.files);
    const maxEntries = positiveLimit("IMPORT_MAX_ZIP_ENTRIES", DEFAULT_MAX_ZIP_ENTRIES);
    if (zipEntries.length > maxEntries) {
      throw new Error(`ZIP file contains more than ${maxEntries} entries`);
    }
    const gpxFiles = zipEntries.filter((file) => !file.dir && file.name.toLowerCase().endsWith(".gpx"));
    if (gpxFiles.length === 0) {
      throw new Error("ZIP file did not contain any GPX files");
    }

    const maxEntryBytes = positiveLimit("IMPORT_MAX_ZIP_ENTRY_BYTES", DEFAULT_MAX_ZIP_ENTRY_BYTES);
    const maxTotalBytes = positiveLimit("IMPORT_MAX_ZIP_TOTAL_BYTES", DEFAULT_MAX_ZIP_TOTAL_BYTES);
    let totalBytes = 0;
    const parsed: ParsedImport[] = [];
    for (const file of gpxFiles) {
      const knownSize = zipUncompressedSize(file);
      if (knownSize != null && knownSize > maxEntryBytes) {
        throw new Error(`ZIP entry ${file.name} exceeds ${maxEntryBytes} bytes`);
      }
      if (knownSize != null && totalBytes + knownSize > maxTotalBytes) {
        throw new Error(`ZIP GPX content exceeds ${maxTotalBytes} bytes`);
      }

      const entry = await readZipEntryLimited(file, maxEntryBytes);
      totalBytes += entry.length;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`ZIP GPX content exceeds ${maxTotalBytes} bytes`);
      }
      parsed.push(parseGpx(entry, source, options));
    }
    return {
      caches: parsed.flatMap((item) => item.caches),
      finds: parsed.flatMap((item) => item.finds)
    };
  }

  if (!fileName.toLowerCase().endsWith(".gpx")) {
    throw new Error("Only GPX and ZIP files are supported");
  }

  return parseGpx(content, source, options);
}

const TRACKABLE_CODE_PATTERN = /\bTB[A-Z0-9]{2,80}\b/i;
const GC_CODE_PATTERN = /\bGC[A-Z0-9]{2,20}\b/i;

function normalizedHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function csvRows(content: string): string[][] {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiters = [",", "\t", ";", "|"];
  const delimiter = delimiters.sort((left, right) => firstLine.split(right).length - firstLine.split(left).length)[0] ?? ",";
  return parseCsvRows(content, delimiter).filter((row) => row.some((value) => value.trim()));
}

function codeFromText(value: unknown, pattern: RegExp): string | null {
  const text = firstText(value);
  const match = text?.match(pattern);
  return match?.[0]?.toUpperCase() ?? null;
}

function trackableCodeFromValue(value: unknown): string | null {
  return codeFromText(value, TRACKABLE_CODE_PATTERN);
}

function gcCodeFromValue(value: unknown): string | null {
  return codeFromText(value, GC_CODE_PATTERN);
}

function fallbackTrackableCode(value: unknown): string | null {
  const text = firstText(value);
  if (!text) return null;
  const code = normalizedTrackableCode(text);
  if (!code) throw new Error("Public trackable code must look like TB1234");
  return code;
}

function normalizedTrackableCode(value: unknown): string | null {
  const text = firstText(value);
  if (!text) return null;
  return trackableCodeFromValue(text) ?? (/^TB[A-Z0-9]{2,80}$/i.test(text) ? text.toUpperCase() : null);
}

function normalizedGcCode(value: unknown): string | null {
  const text = firstText(value);
  if (!text) return null;
  return gcCodeFromValue(text) ?? (/^GC[A-Z0-9]{2,20}$/i.test(text) ? text.toUpperCase() : null);
}

function trackableLogType(value: unknown): ParsedTrackableLogType {
  const text = (firstText(value) ?? (value && typeof value === "object" ? firstText((value as Record<string, unknown>).name, (value as Record<string, unknown>).title) : null))?.toLowerCase().replace(/[^a-z]+/g, " ").trim() ?? "";
  if (text.includes("missing") || text.includes("lost")) return "MISSING";
  if (text.includes("discover")) return "DISCOVERED";
  if (text.includes("retrieve")) return "RETRIEVED";
  if (text.includes("grab")) return "GRABBED";
  if (text.includes("drop") || text.includes("place")) return "DROPPED";
  if (text.includes("visit") || text.includes("dip")) return "VISITED";
  return "NOTE";
}

function trackableState(value: unknown): ParsedTrackableState | null {
  const text = (firstText(value) ?? (value && typeof value === "object" ? firstText((value as Record<string, unknown>).name, (value as Record<string, unknown>).title) : null))?.toLowerCase().replace(/[^a-z]+/g, " ").trim() ?? "";
  if (!text) return null;
  if (text.includes("missing") || text.includes("lost")) return "MISSING";
  if (text.includes("own") || text.includes("inventory") || text.includes("holder")) return "OWNED";
  if (text.includes("discover")) return "DISCOVERED";
  if (text.includes("retrieve") || text.includes("grab")) return "RETRIEVED";
  if (text.includes("drop") || text.includes("place")) return "DROPPED";
  if (text.includes("visit") || text.includes("dip")) return "VISITED";
  return null;
}

function valueByHeader(headers: string[], row: string[], ...names: string[]): string {
  const wanted = new Set(names.map(normalizedHeader));
  const index = headers.findIndex((header) => wanted.has(normalizedHeader(header)));
  return index < 0 ? "" : (row[index] ?? "").trim();
}

function numberByHeader(headers: string[], row: string[], ...names: string[]): number | null {
  const text = valueByHeader(headers, row, ...names).replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function coordinateFromValues(latitude: number | null, longitude: number | null, combined: string): { latitude: number; longitude: number } | null {
  if (latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return { latitude, longitude };
  }
  if (combined) {
    const formatted = parseCoordinate(combined);
    if (formatted) return formatted;
    const parsed = combined.match(/(-?\d{1,3}(?:\.\d+)?)[,;\s]+(-?\d{1,3}(?:\.\d+)?)/);
    if (parsed) {
      const parsedLatitude = Number(parsed[1]);
      const parsedLongitude = Number(parsed[2]);
      if (Math.abs(parsedLatitude) <= 90 && Math.abs(parsedLongitude) <= 180) {
        return { latitude: parsedLatitude, longitude: parsedLongitude };
      }
    }
  }
  return null;
}

function rawRow(headers: string[], row: string[]): Record<string, unknown> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

export function parseTrackableCsv(content: string | Buffer): ParsedTrackableImport {
  const rows = csvRows(content.toString("utf8"));
  if (rows.length < 2) throw new Error("CSV must contain a header row and at least one trackable row");
  const headers = rows[0] ?? [];
  const codeNames = ["trackingCode", "trackingNumber", "trackableCode", "trackable", "tracking", "referenceCode", "tbCode", "tbNumber", "code"];
  const hasCodeColumn = headers.some((header) => codeNames.some((name) => normalizedHeader(header) === normalizedHeader(name)));
  if (!hasCodeColumn) throw new Error("CSV is missing a tracking code column");

  const trackables: ParsedTrackable[] = [];
  const logs: ParsedTrackableLog[] = [];
  for (const row of rows.slice(1)) {
    const raw = rawRow(headers, row);
    const code = normalizedTrackableCode(valueByHeader(headers, row, ...codeNames));
    if (!code) continue;
    const name = valueByHeader(headers, row, "trackableName", "name", "item", "title") || code;
    const action = valueByHeader(headers, row, "action", "activity", "trackableLogType", "logType", "type", "event", "status");
    const parsedType = trackableLogType(action);
    const dateText = valueByHeader(headers, row, "loggedAt", "loggedDate", "date", "visited", "timestamp", "time");
    const loggedAt = toDate(dateText);
    const gcCode = normalizedGcCode(valueByHeader(headers, row, "gcCode", "geocacheCode", "cacheCode", "cache", "waypoint", "geocache"));
    const cacheName = valueByHeader(headers, row, "cacheName", "geocacheName", "cacheTitle") || null;
    const locationName = valueByHeader(headers, row, "locationName", "location", "place", "locality", "city") || null;
    const holderName = valueByHeader(headers, row, "holderName", "holder", "owner", "username", "userName") || null;
    const notes = valueByHeader(headers, row, "notes", "text", "logText", "description", "comment") || null;
    const coordinate = coordinateFromValues(
      numberByHeader(headers, row, "latitude", "lat", "y"),
      numberByHeader(headers, row, "longitude", "lon", "lng", "long", "x"),
      valueByHeader(headers, row, "coordinates", "coordinate", "coords")
    );
    const state = trackableState(valueByHeader(headers, row, "state", "currentState", "status"));
    const distanceKm = numberByHeader(headers, row, "distanceKm", "kilometersTraveled", "kilometresTraveled", "distance");

    trackables.push({
      trackingCode: code,
      name,
      state,
      lastSeenAt: loggedAt,
      lastSeenLocation: locationName ?? cacheName ?? gcCode,
      distanceKm,
      gcCode,
      cacheName,
      latitude: coordinate?.latitude ?? null,
      longitude: coordinate?.longitude ?? null,
      raw
    });
    if (loggedAt) {
      logs.push({
        trackingCode: code,
        trackableName: name,
        logType: parsedType,
        loggedAt,
        gcCode,
        cacheName,
        latitude: coordinate?.latitude ?? null,
        longitude: coordinate?.longitude ?? null,
        locationName,
        holderName,
        notes,
        raw
      });
    }
  }
  if (trackables.length === 0) throw new Error("No trackable rows found in CSV");
  return { trackables, logs };
}

function nestedValue(object: Record<string, any>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
    const normalizedKey = normalizedHeader(key);
    const found = Object.entries(object).find(([name]) => {
      const normalizedName = normalizedHeader(name);
      return normalizedName === normalizedKey || normalizedName.endsWith(normalizedKey);
    });
    if (found) return found[1];
  }
  return undefined;
}

function nestedDate(object: Record<string, any>): Date | null {
  return toDate(nestedValue(object, "loggedAt", "loggedDate", "date", "time", "timestamp", "groundspeak:date"));
}

function nestedCoordinate(object: Record<string, any>, fallbackLatitude: number | null, fallbackLongitude: number | null) {
  const coordinates = nestedValue(object, "coordinates", "coordinate", "coords");
  const coordinateObject = coordinates && typeof coordinates === "object" ? coordinates as Record<string, any> : null;
  const objectLatitude = nestedValue(object, "latitude", "lat");
  const objectLongitude = nestedValue(object, "longitude", "lon", "lng");
  return coordinateFromValues(
    toNumber(objectLatitude ?? (coordinateObject ? nestedValue(coordinateObject, "latitude", "lat") : null)),
    toNumber(objectLongitude ?? (coordinateObject ? nestedValue(coordinateObject, "longitude", "lon", "lng") : null)),
    firstText(coordinates) ?? ""
  ) ?? coordinateFromValues(fallbackLatitude, fallbackLongitude, "");
}

function directTrackableCode(object: Record<string, any>): string | null {
  for (const key of ["trackingCode", "trackingNumber", "trackableCode", "referenceCode", "groundspeak:ref", "ref", "code", "id"]) {
    const code = normalizedTrackableCode(nestedValue(object, key));
    if (code) return code;
  }
  for (const value of Object.values(object)) {
    const code = trackableCodeFromValue(value);
    if (code) return code;
  }
  return null;
}

function directGcCode(object: Record<string, any>): string | null {
  for (const key of ["gcCode", "geocacheCode", "cacheCode", "waypoint", "geocache", "cache"]) {
    const code = normalizedGcCode(nestedValue(object, key));
    if (code) return code;
  }
  return null;
}

function objectLogChildren(object: Record<string, any>): Record<string, any>[] {
  const logs = nestedValue(object, "logs", "journeys", "trackableLogs", "trackableJourney", "history");
  if (Array.isArray(logs)) return logs.filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object");
  if (logs && typeof logs === "object") {
    const nested = nestedValue(logs as Record<string, any>, "log", "journey", "item", "entry");
    return asArray<Record<string, any>>(nested as Record<string, any> | Record<string, any>[] | undefined).filter((item) => Boolean(item) && typeof item === "object");
  }
  return [];
}

function parseJsonTrackableImport(content: string | Buffer, suppliedTrackingCode?: string | null): ParsedTrackableImport {
  let document: any;
  try {
    document = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("Trackable JSON is not valid JSON");
  }
  const fallbackCode = fallbackTrackableCode(suppliedTrackingCode);
  const trackables: ParsedTrackable[] = [];
  const logs: ParsedTrackableLog[] = [];
  const metadata = Array.isArray(document)
    ? document
    : asArray(document?.trackables ?? document?.data?.trackables ?? document?.items ?? document?.trackable);
  for (const item of metadata.filter((value): value is Record<string, any> => Boolean(value) && typeof value === "object")) {
    const code = directTrackableCode(item) ?? fallbackCode;
    if (!code) continue;
    const name = firstText(nestedValue(item, "name", "trackableName", "title")) ?? code;
    const coordinate = nestedCoordinate(item, null, null);
    const state = trackableState(nestedValue(item, "state", "status", "currentState"));
    const currentCache = nestedValue(item, "currentGeocacheCode", "geocacheCode", "cacheCode");
    const gcCode = normalizedGcCode(currentCache);
    const distanceKm = toNumber(nestedValue(item, "kilometersTraveled", "kilometresTraveled", "distanceKm"));
    const latestDate = toDate(nestedValue(item, "lastDiscoveredDate", "loggedDate", "loggedAt"));
    trackables.push({
      trackingCode: code,
      name,
      state,
      lastSeenAt: latestDate,
      lastSeenLocation: firstText(nestedValue(item, "currentGeocacheName", "locationName", "location")) ?? gcCode,
      distanceKm,
      gcCode,
      cacheName: firstText(nestedValue(item, "currentGeocacheName", "geocacheName", "cacheName")),
      latitude: coordinate?.latitude ?? null,
      longitude: coordinate?.longitude ?? null,
      raw: item
    });
    for (const journey of objectLogChildren(item)) {
      const loggedAt = nestedDate(journey);
      if (!loggedAt) continue;
      const type = trackableLogType(nestedValue(journey, "trackableLogType", "logType", "type", "action", "event"));
      const journeyCoordinate = nestedCoordinate(journey, coordinate?.latitude ?? null, coordinate?.longitude ?? null);
      const journeyGcCode = directGcCode(journey) ?? gcCode;
      logs.push({
        trackingCode: code,
        trackableName: name,
        logType: type,
        loggedAt,
        gcCode: journeyGcCode,
        cacheName: firstText(nestedValue(journey, "geocacheName", "cacheName")) ?? null,
        latitude: journeyCoordinate?.latitude ?? null,
        longitude: journeyCoordinate?.longitude ?? null,
        locationName: firstText(nestedValue(journey, "locationName", "location", "place")),
        holderName: firstText(nestedValue(journey, "holderName", "holder", "owner")),
        notes: firstText(nestedValue(journey, "text", "notes", "logText", "description")),
        raw: journey
      });
    }
  }

  const rootLogs = Array.isArray(document) ? document : asArray(document?.journeys ?? document?.logs ?? document?.trackableLogs ?? document?.data?.journeys);
  for (const item of rootLogs.filter((value): value is Record<string, any> => Boolean(value) && typeof value === "object")) {
    const code = directTrackableCode(item) ?? fallbackCode;
    const loggedAt = nestedDate(item);
    if (!code || !loggedAt) continue;
    const coordinate = nestedCoordinate(item, null, null);
    logs.push({
      trackingCode: code,
      trackableName: firstText(nestedValue(item, "trackableName", "name")),
      logType: trackableLogType(nestedValue(item, "trackableLogType", "logType", "type", "action", "event")),
      loggedAt,
      gcCode: directGcCode(item),
      cacheName: firstText(nestedValue(item, "geocacheName", "cacheName")),
      latitude: coordinate?.latitude ?? null,
      longitude: coordinate?.longitude ?? null,
      locationName: firstText(nestedValue(item, "locationName", "location", "place")),
      holderName: firstText(nestedValue(item, "holderName", "holder", "owner")),
      notes: firstText(nestedValue(item, "text", "notes", "logText", "description")),
      raw: item
    });
    if (!trackables.some((trackable) => trackable.trackingCode === code)) {
      trackables.push({ trackingCode: code, name: firstText(nestedValue(item, "trackableName", "name")) ?? code, raw: item });
    }
  }
  if (trackables.length === 0 && logs.length === 0) throw new Error("No trackable records found in JSON");
  return { trackables, logs };
}

function collectNamedValues(value: unknown, wantedName: string, result: unknown[] = []): unknown[] {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedValues(item, wantedName, result);
    return result;
  }
  const object = value as Record<string, any>;
  const normalizedWanted = normalizedHeader(wantedName);
  for (const [key, child] of Object.entries(object)) {
    const normalizedKey = normalizedHeader(key);
    if (normalizedKey === normalizedWanted || normalizedKey.endsWith(normalizedWanted)) {
      result.push(...asArray(child as any));
    }
    collectNamedValues(child, wantedName, result);
  }
  return result;
}

function collectNamedObjects(value: unknown, wantedName: string, result: Record<string, any>[] = []): Record<string, any>[] {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedObjects(item, wantedName, result);
    return result;
  }
  const object = value as Record<string, any>;
  const normalizedWanted = normalizedHeader(wantedName);
  for (const [key, child] of Object.entries(object)) {
    const normalizedKey = normalizedHeader(key);
    if (normalizedKey === normalizedWanted || normalizedKey.endsWith(normalizedWanted)) {
      for (const item of asArray<Record<string, any>>(child)) {
        if (item && typeof item === "object") result.push(item);
      }
    }
    collectNamedObjects(child, wantedName, result);
  }
  return result;
}

function uniqueTrackableCodes(value: string): string[] {
  // Trackable reference codes are uppercase in Geocaching exports. Requiring
  // that casing avoids treating KML style ids such as `tbTravelStyle` as a
  // real tracking code.
  return [...new Set([...value.matchAll(/\bTB[A-Z0-9]{2,80}\b/g)].map((match) => match[0]))];
}

const KML_ESTIMATED_DATE_MARKER = "__geostatsKmlDateEstimated";
const KML_INFERRED_CODE_MARKER = "__geostatsKmlTrackingCodeInferred";

function syntheticKmlDate(sequence: number): Date {
  return new Date(Date.UTC(2000, 0, 1) + sequence * 1_000);
}

function kmlAnonymousCode(documentName: string | null, content: string): string {
  const label = (documentName ?? "trackable")
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 40) || "TRACKABLE";
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `KML-${label}-${(hash >>> 0).toString(36).toUpperCase()}`;
}

function kmlRaw(value: Record<string, any>, dateEstimated: boolean, codeInferred: boolean): Record<string, unknown> {
  if (!dateEstimated && !codeInferred) return value;
  return {
    ...value,
    ...(dateEstimated ? { [KML_ESTIMATED_DATE_MARKER]: true } : {}),
    ...(codeInferred ? { [KML_INFERRED_CODE_MARKER]: true } : {})
  };
}

function kmlCoordinatePoints(value: unknown): Array<{ latitude: number; longitude: number }> {
  const values = collectNamedValues(value, "coordinates").concat(collectNamedValues(value, "coord"));
  const points: Array<{ latitude: number; longitude: number }> = [];
  for (const raw of values) {
    const text = firstText(raw)?.trim();
    if (!text) continue;
    if (text.includes(",")) {
      for (const token of text.split(/\s+/).filter(Boolean)) {
        const parts = token.split(",");
        if (parts.length < 2) continue;
        const longitude = Number(parts[0]);
        const latitude = Number(parts[1]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
          points.push({ latitude, longitude });
        }
      }
      continue;
    }
    const numbers = text.split(/\s+/).map(Number).filter(Number.isFinite);
    for (let index = 0; index + 1 < numbers.length; index += 3) {
      const longitude = numbers[index];
      const latitude = numbers[index + 1];
      if (Math.abs(latitude!) <= 90 && Math.abs(longitude!) <= 180) points.push({ latitude: latitude!, longitude: longitude! });
    }
  }
  return points;
}

function dateFromText(value: unknown): Date | null {
  const text = firstText(value);
  if (!text) return null;
  const match = text.match(/\b\d{4}-\d{2}-\d{2}(?:[T ][^\s<]+)?\b/) ?? text.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:[T ][^\s<]+)?\b/);
  return toDate(match?.[0] ?? null);
}

function kmlDates(value: unknown): Date[] {
  return collectNamedValues(value, "when")
    .concat(collectNamedValues(value, "begin"), collectNamedValues(value, "date"))
    .map((item) => toDate(item))
    .filter((item): item is Date => item !== null);
}

function trackableNameFromDocument(value: string | null, code: string | null): string | null {
  if (!value) return null;
  const withoutCode = code ? value.replace(new RegExp(`\\b${code}\\b`, "ig"), "") : value;
  const cleaned = withoutCode.replace(/\s*[|–—-]\s*/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function parseKmlTrackableImport(content: string | Buffer, suppliedTrackingCode?: string | null): ParsedTrackableImport {
  const xml = content.toString("utf8");
  const document = parser.parse(xml);
  const documentNode = collectNamedObjects(document, "Document")[0];
  const documentName = firstText(documentNode?.name, documentNode?.title);
  const documentDescription = firstText(documentNode?.description, documentNode?.desc);
  const fallbackCode = fallbackTrackableCode(suppliedTrackingCode);
  const documentCodes = uniqueTrackableCodes([documentName, documentDescription].filter(Boolean).join(" "));
  const fileCodes = uniqueTrackableCodes(xml);
  const fileInferredCode = fallbackCode ?? (fileCodes.length === 1 ? fileCodes[0] : null);
  const placemarks = collectNamedObjects(document, "Placemark");
  if (placemarks.length === 0) throw new Error("No placemarks found in KML");
  const cachePlacemarkCount = placemarks.filter((placemark) => {
    const name = firstText(placemark.name, placemark.title) ?? "";
    return Boolean(gcCodeFromValue(name)) && kmlCoordinatePoints(placemark).length > 0;
  }).length;
  const codeInferred = !fileInferredCode && documentCodes.length !== 1 && cachePlacemarkCount > 0;
  const inferredCode = fileInferredCode ?? (codeInferred ? kmlAnonymousCode(documentName, xml) : null);
  const documentTrackableName = trackableNameFromDocument(documentName, inferredCode);
  const trackables: ParsedTrackable[] = [];
  const logs: ParsedTrackableLog[] = [];
  let movementSequence = 0;
  for (const placemark of placemarks) {
    const name = firstText(placemark.name, placemark.title) ?? "";
    const description = firstText(placemark.description, placemark.desc) ?? "";
    const code = trackableCodeFromValue(`${name} ${description}`) ?? (documentCodes.length === 1 ? documentCodes[0] : inferredCode);
    if (!code) continue;
    const points = kmlCoordinatePoints(placemark);
    const dates = kmlDates(placemark);
    const descriptionDate = dateFromText(description);
    const gcCode = gcCodeFromValue(`${name} ${description}`);
    if (!gcCode && points.length > 1 && cachePlacemarkCount > 0) continue;
    const cacheName = name.replace(/\bTB[A-Z0-9]{2,80}\b/i, "").replace(/\bGC[A-Z0-9]{2,20}\b/i, "").replace(/\s*[|–—-]\s*$/, "").trim() || null;
    const trackableName = documentTrackableName ?? code;
    const coordinateRows = points.length > 0 ? points : [{ latitude: null, longitude: null }];
    for (let index = 0; index < coordinateRows.length; index += 1) {
      const point = coordinateRows[index];
      const actualDate = dates[index] ?? descriptionDate ?? dates[0] ?? null;
      const date = actualDate ?? (point.latitude != null && point.longitude != null ? syntheticKmlDate(movementSequence) : null);
      const dateEstimated = date !== null && actualDate === null;
      const raw = kmlRaw(placemark, dateEstimated, codeInferred);
      trackables.push({ trackingCode: code, name: trackableName, state: trackableState(description) ?? "VISITED", lastSeenAt: actualDate, lastSeenLocation: cacheName ?? gcCode, gcCode, cacheName, latitude: point.latitude, longitude: point.longitude, raw });
      if (date && point.latitude != null && point.longitude != null) {
        logs.push({ trackingCode: code, trackableName, logType: trackableLogType(description), loggedAt: date, gcCode, cacheName, latitude: point.latitude, longitude: point.longitude, locationName: cacheName, notes: description || null, raw });
        movementSequence += 1;
      }
    }
  }
  if (trackables.length === 0) throw new Error("KML contains cache placemarks but no trackable code. Enter the public TB reference code (for example TB1234) and try again.");
  return { trackables, logs };
}

function trackableCandidate(path: string[], object: Record<string, any>): boolean {
  const pathText = path.join(" ").toLowerCase();
  if (path.slice(1).some((part) => /log|journey|history/.test(part.toLowerCase()))) return false;
  return pathText.includes("trackable") || pathText.includes("travelbug") || pathText.includes("journey") || pathText.includes("inventory") || Boolean(directTrackableCode(object));
}

function walkTrackableObjects(value: unknown, path: string[], visit: (object: Record<string, any>, path: string[]) => void, seen = new Set<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkTrackableObjects(item, [...path, String(index)], visit, seen));
    return;
  }
  const object = value as Record<string, any>;
  visit(object, path);
  for (const [key, child] of Object.entries(object)) walkTrackableObjects(child, [...path, key], visit, seen);
}

function parseGpxTrackableImport(content: string | Buffer): ParsedTrackableImport {
  const maxBytes = positiveLimit("IMPORT_MAX_BYTES", DEFAULT_MAX_IMPORT_BYTES);
  if (byteLength(content) > maxBytes) throw new Error(`GPX file exceeds ${maxBytes} bytes`);
  const document = parser.parse(content.toString("utf8"));
  const waypoints = asArray<Record<string, any>>(document?.gpx?.wpt);
  if (waypoints.length === 0) throw new Error("No GPX waypoints found");
  const trackables: ParsedTrackable[] = [];
  const logs: ParsedTrackableLog[] = [];
  const seenCandidates = new Set<string>();
  for (const waypoint of waypoints) {
    const latitude = toNumber(waypoint.lat);
    const longitude = toNumber(waypoint.lon);
    const gcCode = normalizedGcCode(waypoint.name);
    const cacheExtension = findCacheExtension(waypoint);
    const cacheName = firstText(cacheExtension?.["groundspeak:name"], cacheExtension?.name, waypoint.desc);
    walkTrackableObjects(waypoint, ["wpt"], (object, path) => {
      if (!trackableCandidate(path, object)) return;
      const code = directTrackableCode(object) ?? trackableCodeFromValue(firstText(object.name, object.desc, object.description));
      if (!code) return;
      const candidateKey = `${code}:${path.join("/")}`;
      if (seenCandidates.has(candidateKey)) return;
      seenCandidates.add(candidateKey);
      const name = firstText(nestedValue(object, "trackableName", "name", "title")) ?? code;
      const currentState = trackableState(nestedValue(object, "state", "status", "action"));
      const objectDate = nestedDate(object) ?? toDate(waypoint.time);
      const coordinate = nestedCoordinate(object, latitude, longitude);
      const objectGcCode = directGcCode(object) ?? gcCode;
      const children = objectLogChildren(object);
      trackables.push({
        trackingCode: code,
        name,
        state: currentState,
        lastSeenAt: objectDate,
        lastSeenLocation: firstText(nestedValue(object, "locationName", "location", "place")) ?? cacheName ?? objectGcCode,
        distanceKm: toNumber(nestedValue(object, "distanceKm", "kilometersTraveled", "kilometresTraveled")),
        gcCode: objectGcCode,
        cacheName,
        latitude: coordinate?.latitude ?? null,
        longitude: coordinate?.longitude ?? null,
        raw: object
      });
      for (const child of children) {
        const loggedAt = nestedDate(child) ?? objectDate;
        if (!loggedAt) continue;
        const childCoordinate = nestedCoordinate(child, coordinate?.latitude ?? null, coordinate?.longitude ?? null);
        const childGcCode = directGcCode(child) ?? objectGcCode;
        logs.push({
          trackingCode: code,
          trackableName: name,
          logType: trackableLogType(nestedValue(child, "trackableLogType", "logType", "type", "action", "event", "groundspeak:type")),
          loggedAt,
          gcCode: childGcCode,
          cacheName: firstText(nestedValue(child, "cacheName", "geocacheName")) ?? cacheName,
          latitude: childCoordinate?.latitude ?? null,
          longitude: childCoordinate?.longitude ?? null,
          locationName: firstText(nestedValue(child, "locationName", "location", "place")) ?? cacheName,
          holderName: firstText(nestedValue(child, "holderName", "holder", "owner", "finder")),
          notes: firstText(nestedValue(child, "text", "notes", "logText", "description")),
          raw: child
        });
      }
      if (children.length === 0 && objectDate && coordinate) {
        logs.push({
          trackingCode: code,
          trackableName: name,
          logType: currentState === "DROPPED" ? "DROPPED" : currentState === "VISITED" ? "VISITED" : "NOTE",
          loggedAt: objectDate,
          gcCode: objectGcCode,
          cacheName,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          locationName: cacheName ?? objectGcCode,
          raw: object
        });
      }
    });
  }
  if (trackables.length === 0) throw new Error("No trackable records found in GPX");
  return { trackables, logs };
}

function mergeTrackableImports(items: ParsedTrackableImport[]): ParsedTrackableImport {
  return { trackables: items.flatMap((item) => item.trackables), logs: items.flatMap((item) => item.logs) };
}

export async function parseTrackableImportFile(fileName: string, content: Buffer, suppliedTrackingCode?: string | null): Promise<ParsedTrackableImport> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip") || lower.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(content);
    const zipEntries = Object.values(zip.files);
    const maxEntries = positiveLimit("IMPORT_MAX_ZIP_ENTRIES", DEFAULT_MAX_ZIP_ENTRIES);
    if (zipEntries.length > maxEntries) throw new Error(`ZIP file contains more than ${maxEntries} entries`);
    const files = zipEntries.filter((file) => !file.dir && /\.(gpx|csv|kml|json)$/i.test(file.name));
    if (files.length === 0) throw new Error("ZIP/KMZ file did not contain a GPX, CSV, KML, or JSON trackable export");
    const maxEntryBytes = positiveLimit("IMPORT_MAX_ZIP_ENTRY_BYTES", DEFAULT_MAX_ZIP_ENTRY_BYTES);
    const maxTotalBytes = positiveLimit("IMPORT_MAX_ZIP_TOTAL_BYTES", DEFAULT_MAX_ZIP_TOTAL_BYTES);
    let totalBytes = 0;
    const parsed: ParsedTrackableImport[] = [];
    for (const file of files) {
      const knownSize = zipUncompressedSize(file);
      if (knownSize != null && knownSize > maxEntryBytes) throw new Error(`ZIP entry ${file.name} exceeds ${maxEntryBytes} bytes`);
      const entry = await readZipEntryLimited(file, maxEntryBytes);
      totalBytes += entry.length;
      if (totalBytes > maxTotalBytes) throw new Error(`ZIP content exceeds ${maxTotalBytes} bytes`);
      parsed.push(await parseTrackableImportFile(file.name, entry, suppliedTrackingCode));
    }
    return mergeTrackableImports(parsed);
  }
  if (lower.endsWith(".gpx")) return parseGpxTrackableImport(content);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseTrackableCsv(content);
  if (lower.endsWith(".kml")) return parseKmlTrackableImport(content, suppliedTrackingCode);
  if (lower.endsWith(".json")) return parseJsonTrackableImport(content, suppliedTrackingCode);
  throw new Error("Only GPX, ZIP, KMZ, CSV, KML, and JSON trackable files are supported");
}
