import type { CacheMapPoint } from "../components/cache-map";

export type MapPointSource = "all" | "finds" | "hides";

export interface MapFilters {
  query: string;
  source: MapPointSource;
  cacheType: string;
  size: string;
  country: string;
  region: string;
  difficultyMin: string;
  difficultyMax: string;
  terrainMin: string;
  terrainMax: string;
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_MAP_FILTERS: MapFilters = {
  query: "",
  source: "all",
  cacheType: "",
  size: "",
  country: "",
  region: "",
  difficultyMin: "",
  difficultyMax: "",
  terrainMin: "",
  terrainMax: "",
  dateFrom: "",
  dateTo: ""
};

function pointDate(point: CacheMapPoint) {
  return (point.isOwnHide ? point.placedAt : point.foundAt)?.slice(0, 10) ?? "";
}

function inNumberRange(value: number | null | undefined, minimum: string, maximum: string) {
  if (!minimum && !maximum) {
    return true;
  }
  if (value == null || !Number.isFinite(value)) {
    return false;
  }
  return (!minimum || value >= Number(minimum)) && (!maximum || value <= Number(maximum));
}

export function filterMapPoints(points: CacheMapPoint[], filters: MapFilters) {
  const query = filters.query.trim().toLocaleLowerCase();

  return points.filter((point) => {
    const date = pointDate(point);
    return (
      (!query || `${point.gcCode} ${point.name}`.toLocaleLowerCase().includes(query)) &&
      (filters.source === "all" || (filters.source === "hides") === (point.isOwnHide === true)) &&
      (!filters.cacheType || point.cacheType === filters.cacheType) &&
      (!filters.size || point.size === filters.size) &&
      (!filters.country || point.country === filters.country) &&
      (!filters.region || point.region === filters.region) &&
      inNumberRange(point.difficulty, filters.difficultyMin, filters.difficultyMax) &&
      inNumberRange(point.terrain, filters.terrainMin, filters.terrainMax) &&
      ((!filters.dateFrom && !filters.dateTo) || (Boolean(date) && (!filters.dateFrom || date >= filters.dateFrom) && (!filters.dateTo || date <= filters.dateTo)))
    );
  });
}

export function mapFilterValues(points: CacheMapPoint[], field: "cacheType" | "size" | "country" | "region") {
  return [...new Set(points.map((point) => point[field]?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

export function activeMapFilterCount(filters: MapFilters) {
  return Object.entries(filters).filter(([key, value]) => (key === "source" ? value !== "all" : value !== "")).length;
}
