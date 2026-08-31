"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMap, CacheMapPoint, getCacheTypeColor } from "../../components/cache-map";
import { apiFetch } from "../../lib/api";
import { activeMapFilterCount, EMPTY_MAP_FILTERS, filterMapPoints, MapFilters, mapFilterValues } from "../../lib/map-filters";

function mapPointDate(point: CacheMapPoint) {
  return point.isOwnHide ? point.placedAt : point.foundAt;
}

function mapPointTime(point: CacheMapPoint) {
  const timestamp = Date.parse(mapPointDate(point) ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

type MapPointsResponse = {
  points: CacheMapPoint[];
  truncated?: boolean;
  nextCursor?: string | null;
  snapshot?: string;
  totalCount?: number;
};

type LoadedMapPoints = {
  points: CacheMapPoint[];
  truncated: boolean;
  totalCount: number;
};

const MAX_MAP_POINTS = 20_000;

function mapFilterParams(filters: MapFilters) {
  const params = new URLSearchParams();
  const entries: Array<[string, string]> = [
    ["query", filters.query.trim()],
    ["cacheType", filters.cacheType],
    ["size", filters.size],
    ["country", filters.country],
    ["region", filters.region],
    ["difficultyMin", filters.difficultyMin],
    ["difficultyMax", filters.difficultyMax],
    ["terrainMin", filters.terrainMin],
    ["terrainMax", filters.terrainMax],
    ["dateFrom", filters.dateFrom],
    ["dateTo", filters.dateTo]
  ];
  for (const [key, value] of entries) {
    if (value) {
      params.set(key, value);
    }
  }
  return params;
}

async function loadMapPoints(path: "/map/caches" | "/map/hides", signal: AbortSignal, filters: MapFilters): Promise<LoadedMapPoints> {
  const points: CacheMapPoint[] = [];
  let cursor: string | undefined;
  let snapshot: string | undefined;
  let totalCount: number | undefined;
  // The API applies active filters before paging, so filtered searches can traverse every match.
  const bounded = activeMapFilterCount(filters) === 0;

  while (true) {
    const params = mapFilterParams(filters);
    if (cursor) {
      params.set("cursor", cursor);
    }
    if (snapshot) {
      params.set("snapshot", snapshot);
    }
    const query = params.toString();
    const response = await apiFetch<MapPointsResponse>(`${path}${query ? `?${query}` : ""}`, { signal });

    if (!snapshot) {
      if (typeof response.snapshot !== "string" || response.snapshot.length === 0) {
        throw new Error("Map data pagination did not return a snapshot.");
      }
      const pageTotalCount = response.totalCount;
      if (typeof pageTotalCount !== "number" || !Number.isSafeInteger(pageTotalCount) || pageTotalCount < 0) {
        throw new Error("Map data pagination did not return a total count.");
      }
      totalCount = pageTotalCount;
      snapshot = response.snapshot;
    } else if (response.snapshot !== snapshot) {
      throw new Error("Map data pagination changed its snapshot.");
    } else if (response.totalCount !== undefined && response.totalCount !== totalCount) {
      throw new Error("Map data pagination changed its total count.");
    }

    const remaining = MAX_MAP_POINTS - points.length;
    const pageExceedsLimit = bounded && response.points.length > remaining;
    points.push(...(bounded ? response.points.slice(0, remaining) : response.points));

    if (!response.truncated) {
      return { points, truncated: pageExceedsLimit, totalCount: totalCount ?? points.length };
    }
    if (bounded && points.length >= MAX_MAP_POINTS) {
      return { points, truncated: true, totalCount: totalCount ?? points.length };
    }

    const nextCursor = response.nextCursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor === cursor) {
      throw new Error("Map data pagination did not advance.");
    }
    cursor = nextCursor;
  }
}

export default function MapPage() {
  const [points, setPoints] = useState<CacheMapPoint[]>([]);
  const [filters, setFilters] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let active = true;
    const abortController = new AbortController();
    setLoading(true);
    setPoints([]);
    setError(null);
    setHistoryTruncated(false);
    setTotalCount(0);

    const paths: Array<"/map/caches" | "/map/hides"> =
      filters.source === "finds" ? ["/map/caches"] : filters.source === "hides" ? ["/map/hides"] : ["/map/caches", "/map/hides"];
    const findIndex = paths.indexOf("/map/caches");
    const hideIndex = paths.indexOf("/map/hides");

    void Promise.allSettled(paths.map((path) => loadMapPoints(path, abortController.signal, filters))).then((results) => {
      if (!active) {
        return;
      }
      const findResult = findIndex >= 0 ? results[findIndex] : undefined;
      const hideResult = hideIndex >= 0 ? results[hideIndex] : undefined;
      const findPoints = findResult?.status === "fulfilled" ? findResult.value.points : [];
      const hidePoints = hideResult?.status === "fulfilled" ? hideResult.value.points : [];
      setPoints([...findPoints, ...hidePoints]);
      setHistoryTruncated(
        (findResult?.status === "fulfilled" && findResult.value.truncated) || (hideResult?.status === "fulfilled" && hideResult.value.truncated)
      );
      setTotalCount(
        (findResult?.status === "fulfilled" ? findResult.value.totalCount : 0) +
          (hideResult?.status === "fulfilled" ? hideResult.value.totalCount : 0)
      );
      const findsFailed = findResult?.status === "rejected";
      const hidesFailed = hideResult?.status === "rejected";
      setError(
        findsFailed && hidesFailed
          ? "Could not load map points."
          : findsFailed
            ? hideResult
              ? "Finds could not be loaded. Own hides are still shown."
              : "Finds could not be loaded."
            : hidesFailed
              ? findResult
                ? "Own hides could not be loaded. Finds are still shown."
                : "Own hides could not be loaded."
              : null
      );
      setLoading(false);
    });
    return () => {
      active = false;
      abortController.abort();
    };
  }, [filters]);

  const cacheTypes = useMemo(() => mapFilterValues(points, "cacheType"), [points]);
  const sizes = useMemo(() => mapFilterValues(points, "size"), [points]);
  const countries = useMemo(() => mapFilterValues(points, "country"), [points]);
  const regions = useMemo(() => mapFilterValues(filters.country ? points.filter((point) => point.country === filters.country) : points, "region"), [filters.country, points]);
  const filteredPoints = useMemo(() => filterMapPoints(points, filters), [filters, points]);
  const findCount = filteredPoints.filter((point) => !point.isOwnHide).length;
  const ownHideCount = filteredPoints.length - findCount;
  const visiblePoints = [...filteredPoints].sort((a, b) => mapPointTime(b) - mapPointTime(a)).slice(0, 20);
  const activeFilterCount = activeMapFilterCount(filters);
  const ratings = Array.from({ length: 9 }, (_, index) => String(1 + index * 0.5));

  function setFilter<K extends keyof MapFilters>(key: K, value: MapFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Explore your cache history</p>
        <h1>Map</h1>
      </header>
      <section className="panel map-filter-panel" aria-labelledby="map-filter-heading">
        <div className="map-filter-heading">
          <div>
            <h2 id="map-filter-heading">Filter map points</h2>
            <p className="muted">Combine filters to narrow the map and recent-points list.</p>
          </div>
          <button className="secondary-button" disabled={activeFilterCount === 0} onClick={() => setFilters(EMPTY_MAP_FILTERS)} type="button">
            Clear{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
        <div className="map-filter-grid">
          <label className="map-filter-search">
            <span>Name or GC code</span>
            <input onChange={(event) => setFilter("query", event.target.value)} placeholder="Search caches" type="search" value={filters.query} />
          </label>
          <label>
            <span>Show</span>
            <select onChange={(event) => setFilter("source", event.target.value as MapFilters["source"])} value={filters.source}>
              <option value="all">Finds and own hides</option>
              <option value="finds">Finds only</option>
              <option value="hides">Own hides only</option>
            </select>
          </label>
          <label>
            <span>Cache type</span>
            <select onChange={(event) => setFilter("cacheType", event.target.value)} value={filters.cacheType}>
              <option value="">All types</option>
              {cacheTypes.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Size</span>
            <select onChange={(event) => setFilter("size", event.target.value)} value={filters.size}>
              <option value="">All sizes</option>
              {sizes.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Country</span>
            <select
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  country: event.target.value,
                  region: ""
                }))
              }
              value={filters.country}
            >
              <option value="">All countries</option>
              {countries.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Region</span>
            <select onChange={(event) => setFilter("region", event.target.value)} value={filters.region}>
              <option value="">All regions</option>
              {regions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <fieldset className="map-range-filter">
            <legend>Difficulty</legend>
            <select aria-label="Minimum difficulty" onChange={(event) => setFilter("difficultyMin", event.target.value)} value={filters.difficultyMin}>
              <option value="">Min</option>
              {ratings.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>to</span>
            <select aria-label="Maximum difficulty" onChange={(event) => setFilter("difficultyMax", event.target.value)} value={filters.difficultyMax}>
              <option value="">Max</option>
              {ratings.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </fieldset>
          <fieldset className="map-range-filter">
            <legend>Terrain</legend>
            <select aria-label="Minimum terrain" onChange={(event) => setFilter("terrainMin", event.target.value)} value={filters.terrainMin}>
              <option value="">Min</option>
              {ratings.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <span>to</span>
            <select aria-label="Maximum terrain" onChange={(event) => setFilter("terrainMax", event.target.value)} value={filters.terrainMax}>
              <option value="">Max</option>
              {ratings.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </fieldset>
          <label>
            <span>Found or placed after</span>
            <input onChange={(event) => setFilter("dateFrom", event.target.value)} type="date" value={filters.dateFrom} />
          </label>
          <label>
            <span>Found or placed before</span>
            <input onChange={(event) => setFilter("dateTo", event.target.value)} type="date" value={filters.dateTo} />
          </label>
        </div>
      </section>
      {error ? <p className="notice error">{error}</p> : null}
      {historyTruncated ? <p className="notice">Unfiltered map history is capped at {MAX_MAP_POINTS.toLocaleString()} points to keep the browser responsive. Use a filter to search the complete matching history.</p> : null}
      <section className="map-stage">
        <div className="map-toolbar">
          <strong>{loading ? "Loading map points..." : `${filteredPoints.length} of ${totalCount.toLocaleString()} matching points shown`}</strong>
          <span>
            {findCount} finds, {ownHideCount} own hides
          </span>
        </div>
        <CacheMap points={filteredPoints} />
      </section>
      <section className="panel">
        <h2>Recent map points</h2>
        <div className="table-list">
          {visiblePoints.map((point) => (
            <div key={`${point.isOwnHide ? "hide" : "find"}-${point.gcCode}-${mapPointDate(point) || point.id}`} className="table-row">
              <a
                className="cache-link"
                href={`https://coord.info/${point.gcCode}`}
                rel="noreferrer"
                target="_blank"
                style={{
                  color: getCacheTypeColor(point.cacheType, point.isOwnHide)
                }}
              >
                <strong>{point.gcCode}</strong> {point.name}
              </a>
              <small
                style={{
                  color: getCacheTypeColor(point.cacheType, point.isOwnHide)
                }}
              >
                {point.isOwnHide ? "Own hide - " : ""}
                {point.latitude}, {point.longitude}
              </small>
            </div>
          ))}
          {!loading && visiblePoints.length === 0 ? <p className="muted">No map points match these filters.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
