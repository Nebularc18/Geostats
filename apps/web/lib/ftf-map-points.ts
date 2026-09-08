import type { CacheMapPoint } from "../components/cache-map";

export interface FtfMapRow {
  date: string;
  dateTime: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  size: string | null;
  difficulty: number | null;
  terrain: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
}

export function formatShortDt(difficulty: number | null | undefined, terrain: number | null | undefined) {
  return `${difficulty ?? "?"}/${terrain ?? "?"}`;
}

export function ftfRowsToMapPoints(rows: FtfMapRow[]): CacheMapPoint[] {
  return rows
    .filter((row) => row.latitude != null && row.longitude != null)
    .map((row) => ({
      id: `${row.gcCode}-${row.date}`,
      gcCode: row.gcCode,
      name: row.name,
      cacheType: row.cacheType,
      difficulty: row.difficulty,
      terrain: row.terrain,
      size: row.size,
      latitude: row.latitude!,
      longitude: row.longitude!,
      country: row.country,
      region: row.region,
      county: row.county,
      foundAt: row.dateTime
    }));
}
