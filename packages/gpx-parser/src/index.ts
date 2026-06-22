import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { ImportSource } from "@geostats/shared";

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
    foundAt: foundLogMatchesUser ? foundLogDate ?? userFoundDate : userFoundDate ?? foundLogDate,
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
    const gpxFiles = Object.values(zip.files).filter((file) => !file.dir && file.name.toLowerCase().endsWith(".gpx"));
    if (gpxFiles.length === 0) {
      throw new Error("ZIP file did not contain any GPX files");
    }
    const maxEntries = positiveLimit("IMPORT_MAX_ZIP_ENTRIES", DEFAULT_MAX_ZIP_ENTRIES);
    if (gpxFiles.length > maxEntries) {
      throw new Error(`ZIP file contains more than ${maxEntries} GPX files`);
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

      const entry = await file.async("nodebuffer");
      if (entry.length > maxEntryBytes) {
        throw new Error(`ZIP entry ${file.name} exceeds ${maxEntryBytes} bytes`);
      }
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
