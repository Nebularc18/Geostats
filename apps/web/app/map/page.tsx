"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMap, CacheMapPoint, getCacheTypeColor } from "../../components/cache-map";
import { apiFetch } from "../../lib/api";
import { activeMapFilterCount, EMPTY_MAP_FILTERS, filterMapPoints, MapFilters, mapFilterValues } from "../../lib/map-filters";
import {
  applyMapLoadProgress,
  loadMapPoints,
  MAX_MAP_POINTS,
  type MapLoadProgress,
  type MapPath
} from "../../lib/map-loader";

function mapPointDate(point: CacheMapPoint) {
  return point.isOwnHide ? point.placedAt : point.foundAt;
}

function mapPointTime(point: CacheMapPoint) {
  const timestamp = Date.parse(mapPointDate(point) ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export default function MapPage() {
  const [points, setPoints] = useState<CacheMapPoint[]>([]);
  // Keep the option source independent from the currently filtered result.
  // Otherwise selecting one value leaves only that value in the next response
  // and makes the other choices disappear from the controls.
  const [optionPoints, setOptionPoints] = useState<CacheMapPoint[]>([]);
  const [filters, setFilters] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [loadedFilters, setLoadedFilters] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [debouncedQuery, setDebouncedQuery] = useState(EMPTY_MAP_FILTERS.query);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const loadSequenceRef = useRef(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(filters.query), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.query]);

  const requestFilters = useMemo(
    () => ({
      query: debouncedQuery,
      source: filters.source,
      cacheType: filters.cacheType,
      size: filters.size,
      country: filters.country,
      region: filters.region,
      difficultyMin: filters.difficultyMin,
      difficultyMax: filters.difficultyMax,
      terrainMin: filters.terrainMin,
      terrainMax: filters.terrainMax,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo
    }),
    [
      debouncedQuery,
      filters.cacheType,
      filters.country,
      filters.dateFrom,
      filters.dateTo,
      filters.difficultyMax,
      filters.difficultyMin,
      filters.region,
      filters.size,
      filters.source,
      filters.terrainMax,
      filters.terrainMin
    ]
  );

  useEffect(() => {
    let active = true;
    const sequence = ++loadSequenceRef.current;
    const abortController = new AbortController();
    setLoading(true);
    setError(null);

    const paths: MapPath[] =
      requestFilters.source === "finds" ? ["/map/caches"] : requestFilters.source === "hides" ? ["/map/hides"] : ["/map/caches", "/map/hides"];
    const findIndex = paths.indexOf("/map/caches");
    const hideIndex = paths.indexOf("/map/hides");
    const progressByPath = new Map<MapPath, Omit<MapLoadProgress, "path" | "reset" | "terminal">>();
    let published = false;

    const publishProgress = (progress: MapLoadProgress) => {
      if (!active || sequence !== loadSequenceRef.current) {
        return;
      }
      const next = applyMapLoadProgress(paths, progressByPath, progress);
      if (!progress.reset && !published) {
        published = true;
        setLoadedFilters(requestFilters);
      }
      setPoints(next.points);
      // Text search and source selection may narrow the loaded response, but
      // metadata filters must not rewrite their own option lists. Refresh the
      // option source only while loading an otherwise unfiltered history.
      const hasMetadataFilters = Boolean(
        requestFilters.cacheType ||
          requestFilters.size ||
          requestFilters.country ||
          requestFilters.region ||
          requestFilters.difficultyMin ||
          requestFilters.difficultyMax ||
          requestFilters.terrainMin ||
          requestFilters.terrainMax ||
          requestFilters.dateFrom ||
          requestFilters.dateTo
      );
      if (!hasMetadataFilters) {
        setOptionPoints(next.points);
      }
      setHistoryTruncated(next.truncated);
      setTotalCount(next.totalCount);
    };

    void Promise.allSettled(paths.map((path) => loadMapPoints(path, abortController.signal, requestFilters, apiFetch, 0, publishProgress))).then((results) => {
      if (!active || sequence !== loadSequenceRef.current) {
        return;
      }
      const findResult = findIndex >= 0 ? results[findIndex] : undefined;
      const hideResult = hideIndex >= 0 ? results[hideIndex] : undefined;
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
  }, [requestFilters]);

  const filterOptionPoints = optionPoints.length > 0 ? optionPoints : points;
  const cacheTypes = useMemo(() => mapFilterValues(filterOptionPoints, "cacheType"), [filterOptionPoints]);
  const sizes = useMemo(() => mapFilterValues(filterOptionPoints, "size"), [filterOptionPoints]);
  const countries = useMemo(() => mapFilterValues(filterOptionPoints, "country"), [filterOptionPoints]);
  const regions = useMemo(
    () => mapFilterValues(filters.country ? filterOptionPoints.filter((point) => point.country === filters.country) : filterOptionPoints, "region"),
    [filterOptionPoints, filters.country]
  );
  const filteredPoints = useMemo(() => filterMapPoints(points, loadedFilters), [loadedFilters, points]);
  const findCount = useMemo(() => filteredPoints.filter((point) => !point.isOwnHide).length, [filteredPoints]);
  const ownHideCount = filteredPoints.length - findCount;
  const visiblePoints = useMemo(() => [...filteredPoints].sort((a, b) => mapPointTime(b) - mapPointTime(a)).slice(0, 20), [filteredPoints]);
  const activeFilterCount = activeMapFilterCount(filters);
  const mapLoading = loading || filters.query !== debouncedQuery;
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
          <strong aria-live="polite">{mapLoading ? "Loading map points..." : `${filteredPoints.length} of ${totalCount.toLocaleString()} matching points shown`}</strong>
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
          {!mapLoading && visiblePoints.length === 0 ? <p className="muted">No map points match these filters.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
