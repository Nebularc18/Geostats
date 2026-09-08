export interface FtfStatsRow {
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty?: number | null;
  terrain?: number | null;
  size?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  dateTime: string;
}

export interface FtfCachePoint {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty?: number | null;
  terrain?: number | null;
  size?: string | null;
  latitude: number;
  longitude: number;
  foundAt?: string;
}

export function formatShortDt(difficulty?: number | null, terrain?: number | null) {
  return `${difficulty ?? "?"}/${terrain ?? "?"}`;
}

export function hasDtData(point?: { difficulty?: number | null; terrain?: number | null; size?: string | null } | null) {
  return point != null && (point.difficulty != null || point.terrain != null || point.size != null);
}

export function ftfRowToMapPoint(row: FtfStatsRow): FtfCachePoint {
  return {
    id: `${row.gcCode}-${row.dateTime}`,
    gcCode: row.gcCode,
    name: row.name,
    cacheType: row.cacheType,
    difficulty: row.difficulty ?? null,
    terrain: row.terrain ?? null,
    size: row.size ?? null,
    latitude: row.latitude ?? Number.NaN,
    longitude: row.longitude ?? Number.NaN,
    foundAt: row.dateTime
  };
}

export function ftfRowToListPoint(row: FtfStatsRow): FtfCachePoint {
  return {
    id: row.gcCode,
    gcCode: row.gcCode,
    name: row.name,
    cacheType: row.cacheType,
    difficulty: row.difficulty ?? null,
    terrain: row.terrain ?? null,
    size: row.size ?? null,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    foundAt: row.dateTime
  };
}
