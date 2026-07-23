export enum ImportSource {
  MY_FINDS_GPX = "MY_FINDS_GPX",
  MY_HIDES_GPX = "MY_HIDES_GPX",
  POCKET_QUERY = "POCKET_QUERY",
  MANUAL_GPX = "MANUAL_GPX",
  GEOCACHING_API = "GEOCACHING_API"
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
  ZIP = "ZIP"
}

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
  latitude: number;
  longitude: number;
  foundAt: string;
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

  const dmm = value.match(
    /^\s*([NS])\s*(\d{1,2})(?:\s*°\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*[,;]?\s*([EW])\s*(\d{1,3})(?:\s*°\s*|\s+)(\d{1,2}(?:\.\d+)?)\s*['’′]?\s*$/i
  );
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
