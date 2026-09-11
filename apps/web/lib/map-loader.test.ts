import assert from "node:assert/strict";
import test from "node:test";
import type { CacheMapPoint } from "../components/cache-map";
import { EMPTY_MAP_FILTERS } from "./map-filters.ts";
import {
  applyMapLoadProgress,
  loadMapPoints,
  MAP_SNAPSHOT_EXPIRED,
  type MapLoadProgress,
  type MapFetch,
  type MapPointsResponse
} from "./map-loader.ts";

function point(index: number): CacheMapPoint {
  return {
    id: `find-${index}`,
    gcCode: `GC${index}`,
    name: `Cache ${index}`,
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 2,
    size: "Regular",
    latitude: 56,
    longitude: 15,
    foundAt: "2025-01-01T00:00:00.000Z"
  };
}

function fetcherFor(responses: Array<MapPointsResponse | Error>): MapFetch {
  return async <T>(path: string) => {
    assert.ok(path.startsWith("/map/caches"));
    const response = responses.shift();
    if (!response) {
      throw new Error("fixture exhausted");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response as T;
  };
}

test("clears an expired source while keeping independent source progress", () => {
  const progressByPath = new Map();
  const firstFind = { path: "/map/caches" as const, points: [point(1)], truncated: false, totalCount: 1 };
  const firstHide = { path: "/map/hides" as const, points: [point(2)], truncated: false, totalCount: 1 };
  applyMapLoadProgress(["/map/caches", "/map/hides"], progressByPath, firstFind);
  applyMapLoadProgress(["/map/caches", "/map/hides"], progressByPath, firstHide);

  const afterReset = applyMapLoadProgress(["/map/caches", "/map/hides"], progressByPath, {
    path: "/map/caches",
    points: [],
    truncated: false,
    totalCount: 0,
    reset: true,
    terminal: false
  });

  assert.deepEqual(afterReset.points.map((item) => item.id), ["find-2"]);
  assert.equal(afterReset.totalCount, 1);
});

test("does not call an exact 20,000-point history truncated", async () => {
  const progress: MapLoadProgress[] = [];
  const result = await loadMapPoints(
    "/map/caches",
    new AbortController().signal,
    EMPTY_MAP_FILTERS,
    fetcherFor([
      {
        points: Array.from({ length: 20_000 }, (_, index) => point(index)),
        truncated: true,
        nextCursor: "should-not-be-requested",
        snapshot: "2025-01-01T00:00:00.000Z",
        snapshotRevision: "v2:1",
        totalCount: 20_000
      }
    ]),
    0,
    (event) => progress.push(event)
  );

  assert.equal(result.points.length, 20_000);
  assert.equal(result.truncated, false);
  assert.equal(result.totalCount, 20_000);
  assert.deepEqual(progress.map((event) => ({ count: event.points.length, truncated: event.truncated })), [
    { count: 20_000, truncated: false }
  ]);
});

test("publishes validated pages progressively and caps an overflowing history", async () => {
  const progress: MapLoadProgress[] = [];
  const pages = [
    {
      points: Array.from({ length: 5_000 }, (_, index) => point(index)),
      truncated: true,
      nextCursor: "cursor-1",
      snapshot: "2025-01-01T00:00:00.000Z",
      snapshotRevision: "v2:1",
      totalCount: 25_001
    },
    {
      points: Array.from({ length: 5_000 }, (_, index) => point(index + 5_000)),
      truncated: true,
      nextCursor: "cursor-2",
      snapshot: "2025-01-01T00:00:00.000Z",
      snapshotRevision: "v2:1"
    },
    {
      points: Array.from({ length: 5_000 }, (_, index) => point(index + 10_000)),
      truncated: true,
      nextCursor: "cursor-3",
      snapshot: "2025-01-01T00:00:00.000Z",
      snapshotRevision: "v2:1"
    },
    {
      points: Array.from({ length: 5_000 }, (_, index) => point(index + 15_000)),
      truncated: true,
      nextCursor: "cursor-4",
      snapshot: "2025-01-01T00:00:00.000Z",
      snapshotRevision: "v2:1"
    }
  ];

  const result = await loadMapPoints(
    "/map/caches",
    new AbortController().signal,
    EMPTY_MAP_FILTERS,
    fetcherFor(pages),
    0,
    (event) => progress.push(event)
  );

  assert.equal(result.points.length, 20_000);
  assert.equal(result.truncated, true);
  assert.equal(result.totalCount, 25_001);
  assert.deepEqual(progress.map((event) => event.points.length), [5_000, 15_000, 20_000]);
  assert.equal(progress.at(-1)?.truncated, true);
});

test("clears progressive data when a snapshot revision changes", async () => {
  const progress: MapLoadProgress[] = [];
  await assert.rejects(
    () =>
      loadMapPoints(
        "/map/caches",
        new AbortController().signal,
        EMPTY_MAP_FILTERS,
        fetcherFor([
          {
            points: [point(1)],
            truncated: true,
            nextCursor: "cursor-1",
            snapshot: "2025-01-01T00:00:00.000Z",
            snapshotRevision: "v2:1",
            totalCount: 2
          },
          {
            points: [point(2)],
            truncated: false,
            snapshot: "2025-01-01T00:00:00.000Z",
            snapshotRevision: "v2:2"
          }
        ]),
        0,
        (event) => progress.push(event)
      ),
    /snapshot revision/
  );

  assert.deepEqual(progress.map((event) => ({ reset: event.reset, terminal: event.terminal, count: event.points.length })), [
    { reset: undefined, terminal: undefined, count: 1 },
    { reset: true, terminal: true, count: 0 }
  ]);
});

test("retries an expired snapshot but marks the final reset as terminal", async () => {
  const progress: MapLoadProgress[] = [];
  await assert.rejects(
    () =>
      loadMapPoints(
        "/map/caches",
        new AbortController().signal,
        EMPTY_MAP_FILTERS,
        fetcherFor([new Error(MAP_SNAPSHOT_EXPIRED), new Error(MAP_SNAPSHOT_EXPIRED), new Error(MAP_SNAPSHOT_EXPIRED)]),
        0,
        (event) => progress.push(event)
      ),
    (error: unknown) => error instanceof Error && error.message === MAP_SNAPSHOT_EXPIRED
  );

  assert.deepEqual(progress.map((event) => ({ reset: event.reset, terminal: event.terminal })), [
    { reset: true, terminal: false },
    { reset: true, terminal: false },
    { reset: true, terminal: true }
  ]);
});
