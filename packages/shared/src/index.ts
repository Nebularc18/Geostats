export enum ImportSource {
  MY_FINDS_GPX = "MY_FINDS_GPX",
  MY_HIDES_GPX = "MY_HIDES_GPX",
  POCKET_QUERY = "POCKET_QUERY",
  MANUAL_GPX = "MANUAL_GPX",
  GEOCACHING_API = "GEOCACHING_API",
  GSAK = "GSAK",
  GEOSTATS_EXPORT = "GEOSTATS_EXPORT"
}

export enum ImportStatus {
  UPLOADED = "UPLOADED",
  QUEUED = "QUEUED",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED"
}

export enum ImportFileType {
  GPX = "GPX",
  ZIP = "ZIP",
  JSON = "JSON"
}

export const CACHE_IMPORT_MODES = [
  { value: "finds", label: "My Finds" },
  { value: "hides", label: "My Hides" },
  { value: "cache-list", label: "Cache list" }
] as const;

export type CacheImportMode = (typeof CACHE_IMPORT_MODES)[number]["value"];

export type ImportReceipt = {
  caches: number;
  finds: number;
  hides: number;
  skippedWaypoints: number;
  unmatchedFinds: number;
};

export function formatImportReceipt(receipt: ImportReceipt) {
  const countLabel = (value: number, singular: string, plural: string) => `${value} ${value === 1 ? singular : plural}`;
  const counts = [countLabel(receipt.caches, "cache", "caches"), countLabel(receipt.finds, "find", "finds"), countLabel(receipt.hides, "hide", "hides")];
  if (receipt.skippedWaypoints) counts.push(`${receipt.skippedWaypoints} invalid or unsupported ${receipt.skippedWaypoints === 1 ? "waypoint" : "waypoints"} skipped`);
  if (receipt.unmatchedFinds) counts.push(`${receipt.unmatchedFinds} without a verified find. Check your Geocaching username or file type.`);
  return counts.join(" · ");
}

export const IMPORT_LEASE_MS = 120_000;
export const MAX_IMPORT_CRASH_RECOVERIES = 3;
export const IMPORT_QUEUE_NAME = "imports";

export interface ImportJobPayload {
  importId: string;
  userId: string;
  objectKey: string;
  source: ImportSource;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

export interface CacheMapPoint {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty?: number | null;
  terrain?: number | null;
  size?: string | null;
  latitude: number;
  longitude: number;
  country?: string | null;
  region?: string | null;
  county?: string | null;
  hiddenDate?: string | null;
  foundAt?: string;
  placedAt?: string;
  isOwnHide?: boolean;
}

export interface ParsedCoordinate {
  latitude: number;
  longitude: number;
}

/**
 * Parse either decimal coordinates or geocaching's degrees and decimal
 * minutes format, with or without degree/minute symbols (for example,
 * N 59° 55.881′ E 016° 34.374′ or N 59 55.881 E 016 34.374).
 */
export function parseCoordinate(value: string): ParsedCoordinate | null {
  const decimal = value.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (decimal) {
    const latitude = Number(decimal[1]);
    const longitude = Number(decimal[2]);
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return { latitude, longitude };
    }
  }

  const dmm = value.match(/^\s*([NS])\s*(\d{1,2})(?:\s*°\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*[,;]?\s*([EW])\s*(\d{1,3})(?:\s*°\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*$/i);
  if (!dmm) return null;

  const latitudeDegrees = Number(dmm[2]);
  const latitudeMinutes = Number(dmm[3]);
  const longitudeDegrees = Number(dmm[5]);
  const longitudeMinutes = Number(dmm[6]);
  if (
    latitudeMinutes >= 60 ||
    longitudeMinutes >= 60 ||
    latitudeDegrees > 90 ||
    longitudeDegrees > 180 ||
    (latitudeDegrees === 90 && latitudeMinutes > 0) ||
    (longitudeDegrees === 180 && longitudeMinutes > 0)
  ) {
    return null;
  }

  const latitude = (latitudeDegrees + latitudeMinutes / 60) * (dmm[1]!.toUpperCase() === "S" ? -1 : 1);
  const longitude = (longitudeDegrees + longitudeMinutes / 60) * (dmm[4]!.toUpperCase() === "W" ? -1 : 1);
  return { latitude, longitude };
}

export { parseCsvRows } from "./csv";
export {
  cacheTypeIdentity,
  cacheTypeLabel,
  cacheTypeOptions,
  canonicalCacheTypeName,
  type CacheTypeOption
} from "./cache-types";

export { MYSTERY_BROWSER_CAPTURE_SOURCE, mysteryBrowserCaptureScript } from "./mystery-browser-capture";
export { MAX_MYSTERY_SNAPSHOT_BYTES, mysterySnapshotByteLength, normalizeMysteryListing, type MysteryListing } from "./mystery-listing";

export const MAX_MYSTERY_WORKSPACES_PER_OWNER = 500;

export * from "./mystery-cache-merge";
export * from "./travel-plans";
export * from "./mystery-toolkit";
