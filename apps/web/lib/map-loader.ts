import type { CacheMapPoint } from "../components/cache-map";
import { activeMapFilterCount, type MapFilters } from "./map-filters.ts";

export type MapPath = "/map/caches" | "/map/hides";

export type MapPointsResponse = {
  points: CacheMapPoint[];
  truncated?: boolean;
  nextCursor?: string | null;
  snapshot?: string;
  snapshotRevision?: string;
  totalCount?: number;
};

export type LoadedMapPoints = {
  points: CacheMapPoint[];
  truncated: boolean;
  totalCount: number;
};

export type MapLoadProgress = {
  path: MapPath;
  points: CacheMapPoint[];
  truncated: boolean;
  totalCount: number;
  reset?: boolean;
  terminal?: boolean;
};

export type MapProgressValue = Omit<MapLoadProgress, "path" | "reset" | "terminal">;

export function applyMapLoadProgress(
  paths: MapPath[],
  progressByPath: Map<MapPath, MapProgressValue>,
  progress: MapLoadProgress
) {
  if (progress.reset) {
    progressByPath.delete(progress.path);
  } else {
    progressByPath.set(progress.path, {
      points: progress.points,
      truncated: progress.truncated,
      totalCount: progress.totalCount
    });
  }

  return {
    points: paths.flatMap((path) => progressByPath.get(path)?.points ?? []),
    truncated: [...progressByPath.values()].some((value) => value.truncated),
    totalCount: [...progressByPath.values()].reduce((sum, value) => sum + value.totalCount, 0)
  };
}

export const MAX_MAP_POINTS = 20_000;
export const MAP_PROGRESS_BATCH_SIZE = 3;
export const MAP_SNAPSHOT_EXPIRED = "map snapshot expired";
export const MAP_MAX_RESTARTS = 2;

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

export type MapFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * Load one map source through its immutable cursor snapshot. Unfiltered
 * histories are bounded for browser memory; filtered searches are allowed to
 * traverse every matching page. Progress is emitted only after a complete
 * validated page, so the UI never renders a page from a changed snapshot.
 */
export async function loadMapPoints(
  path: MapPath,
  signal: AbortSignal,
  filters: MapFilters,
  fetcher: MapFetch,
  restartCount = 0,
  onProgress?: (progress: MapLoadProgress) => void
): Promise<LoadedMapPoints> {
  const points: CacheMapPoint[] = [];
  let cursor: string | undefined;
  let snapshot: string | undefined;
  let snapshotRevision: string | undefined;
  let totalCount: number | undefined;
  let pageNumber = 0;
  // The API applies active filters before paging, so filtered searches can traverse every match.
  const bounded = activeMapFilterCount(filters) === 0;

  const terminalError = (message: string): never => {
    onProgress?.({ path, points: [], truncated: false, totalCount: 0, reset: true, terminal: true });
    throw new Error(message);
  };

  while (true) {
    const params = mapFilterParams(filters);
    if (cursor) {
      params.set("cursor", cursor);
    }
    if (snapshot) {
      params.set("snapshot", snapshot);
    }
    if (snapshotRevision) {
      params.set("snapshotRevision", snapshotRevision);
    }
    const query = params.toString();
    let response: MapPointsResponse;
    try {
      response = await fetcher<MapPointsResponse>(`${path}${query ? `?${query}` : ""}`, { signal });
    } catch (error) {
      if (error instanceof Error && error.message === MAP_SNAPSHOT_EXPIRED) {
        const terminal = restartCount >= MAP_MAX_RESTARTS;
        onProgress?.({ path, points: [], truncated: false, totalCount: 0, reset: true, terminal });
        if (!terminal) {
          return loadMapPoints(path, signal, filters, fetcher, restartCount + 1, onProgress);
        }
        throw error;
      }
      // Do not leave a partially fetched source on screen after a terminal
      // network or server error. The other map source can still remain
      // visible because the page tracks progress independently by path.
      onProgress?.({ path, points: [], truncated: false, totalCount: 0, reset: true, terminal: true });
      throw error;
    }

    if (!snapshot) {
      if (typeof response.snapshot !== "string" || response.snapshot.length === 0) {
        terminalError("Map data pagination did not return a snapshot.");
      }
      if (typeof response.snapshotRevision !== "string" || response.snapshotRevision.length === 0) {
        terminalError("Map data pagination did not return a snapshot revision.");
      }
      const pageTotalCount = response.totalCount;
      if (typeof pageTotalCount !== "number" || !Number.isSafeInteger(pageTotalCount) || pageTotalCount < 0) {
        terminalError("Map data pagination did not return a total count.");
      }
      totalCount = pageTotalCount;
      snapshot = response.snapshot;
      snapshotRevision = response.snapshotRevision;
    } else if (response.snapshot !== snapshot) {
      terminalError("Map data pagination changed its snapshot.");
    } else if (response.snapshotRevision !== snapshotRevision) {
      terminalError("Map data pagination changed its snapshot revision.");
    } else if (response.totalCount !== undefined && response.totalCount !== totalCount) {
      terminalError("Map data pagination changed its total count.");
    }

    const remaining = MAX_MAP_POINTS - points.length;
    const pageExceedsLimit = bounded && response.points.length > remaining;
    points.push(...(bounded ? response.points.slice(0, remaining) : response.points));
    pageNumber += 1;

    // totalCount makes the exact-limit case distinguishable from a real
    // overflow. A server page may contain exactly 20,000 points and still set
    // truncated by convention; if the declared total is also 20,000, there
    // is no history left to truncate.
    const hasMore = response.truncated === true && (totalCount === undefined || totalCount > points.length);
    const reachedLimit = bounded && points.length >= MAX_MAP_POINTS;
    const complete = !hasMore || reachedLimit;
    const truncated = bounded && (pageExceedsLimit || (hasMore && reachedLimit));
    if (pageNumber === 1 || pageNumber % MAP_PROGRESS_BATCH_SIZE === 0 || complete) {
      onProgress?.({
        path,
        points: [...points],
        truncated,
        totalCount: totalCount ?? points.length
      });
    }

    if (complete) {
      return { points, truncated, totalCount: totalCount ?? points.length };
    }

    const nextCursor = response.nextCursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0 || nextCursor === cursor) {
      return terminalError("Map data pagination did not advance.");
    }
    cursor = nextCursor;
  }
}
