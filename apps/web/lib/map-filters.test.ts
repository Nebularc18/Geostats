import assert from "node:assert/strict";
import test from "node:test";
import type { CacheMapPoint } from "../components/cache-map";
import { activeMapFilterCount, EMPTY_MAP_FILTERS, filterMapPoints, mapFilterValues } from "./map-filters.ts";

const points: CacheMapPoint[] = [
  {
    id: "1",
    gcCode: "GCALPHA",
    name: "Forest walk",
    cacheType: "Traditional Cache",
    difficulty: 1.5,
    terrain: 2,
    size: "Small",
    latitude: 56,
    longitude: 15,
    country: "Sweden",
    region: "Blekinge",
    foundAt: "2025-03-10T12:00:00.000Z"
  },
  {
    id: "2",
    gcCode: "GCBETA",
    name: "Harbour puzzle",
    cacheType: "Mystery Cache",
    difficulty: 4,
    terrain: 1.5,
    size: "Micro",
    latitude: 55,
    longitude: 12,
    country: "Denmark",
    region: "Capital Region",
    placedAt: "2024-06-01T00:00:00.000Z",
    isOwnHide: true
  }
];

test("filters map points across text, source, metadata, ratings, and date", () => {
  const result = filterMapPoints(points, {
    ...EMPTY_MAP_FILTERS,
    query: "harbour",
    source: "hides",
    cacheType: "Mystery Cache",
    size: "Micro",
    country: "Denmark",
    region: "Capital Region",
    difficultyMin: "3.5",
    difficultyMax: "4.5",
    terrainMax: "2",
    dateFrom: "2024-01-01",
    dateTo: "2024-12-31"
  });

  assert.deepEqual(
    result.map((point) => point.gcCode),
    ["GCBETA"]
  );
});

test("excludes missing ratings when a rating filter is active", () => {
  const withoutRating = { ...points[0], id: "3", difficulty: null };
  const result = filterMapPoints([...points, withoutRating], {
    ...EMPTY_MAP_FILTERS,
    difficultyMin: "1"
  });
  assert.deepEqual(
    result.map((point) => point.id),
    ["1", "2"]
  );
});

test("excludes missing dates when a date filter is active", () => {
  const withoutDate = { ...points[0], id: "3", foundAt: undefined };
  const result = filterMapPoints([...points, withoutDate], {
    ...EMPTY_MAP_FILTERS,
    dateTo: "2025-12-31"
  });
  assert.deepEqual(
    result.map((point) => point.id),
    ["1", "2"]
  );
});

test("builds sorted unique option values and counts active filters", () => {
  assert.deepEqual(mapFilterValues([...points, points[0]], "country"), ["Denmark", "Sweden"]);
  assert.equal(
    activeMapFilterCount({
      ...EMPTY_MAP_FILTERS,
      source: "finds",
      query: "GC"
    }),
    2
  );
});
