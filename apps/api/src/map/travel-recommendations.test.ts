import assert from "node:assert/strict";
import test from "node:test";
import {
  distanceToRouteKm,
  haversineKm,
  mergeTravelCandidates,
  recommendNearbyCaches,
  recommendRouteCaches,
  type TravelCandidate
} from "./travel-recommendations";

function candidate(id: string, latitude: number, longitude: number, found = false): TravelCandidate {
  return {
    id,
    gcCode: `GC${id}`,
    name: id,
    cacheType: "Traditional Cache",
    difficulty: 1.5,
    terrain: 1.5,
    size: "Small",
    latitude,
    longitude,
    country: "Sweden",
    region: null,
    county: null,
    found,
    source: "imported"
  };
}

test("adds solved mysteries and prefers their corrected coordinates", () => {
  const imported = candidate("same", 56, 15, true);
  const mystery = { ...candidate("same", 56.1, 15.2), id: "mystery-same", source: "mystery" as const };
  const added = { ...candidate("new", 56.2, 15.3), source: "mystery" as const };
  const merged = mergeTravelCandidates([imported], [mystery, added]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.latitude, 56.1);
  assert.equal(merged[0]?.found, true);
  assert.equal(merged[0]?.source, "mystery");
});

test("calculates useful great-circle distances", () => {
  const distance = haversineKm(
    { latitude: 59.3293, longitude: 18.0686 },
    { latitude: 57.7089, longitude: 11.9746 }
  );
  assert.ok(distance > 395 && distance < 405);
});

test("measures distance to the closest route segment", () => {
  const route = [
    { latitude: 59, longitude: 18 },
    { latitude: 60, longitude: 18 }
  ];
  assert.ok(distanceToRouteKm({ latitude: 59.5, longitude: 18.01 }, route) < 0.6);
  assert.ok(distanceToRouteKm({ latitude: 59.5, longitude: 19 }, route) > 50);
});

test("nearby recommendations exclude finds unless requested", () => {
  const candidates = [
    candidate("near", 59.001, 18),
    candidate("found", 59.002, 18, true),
    candidate("far", 60, 18)
  ];
  assert.deepEqual(recommendNearbyCaches(candidates, { latitude: 59, longitude: 18 }, 5, false).map(({ id }) => id), ["near"]);
  assert.deepEqual(recommendNearbyCaches(candidates, { latitude: 59, longitude: 18 }, 5, true).map(({ id }) => id), ["near", "found"]);
});

test("route recommendations use the road corridor and obey the result limit", () => {
  const route = [
    { latitude: 59, longitude: 18 },
    { latitude: 60, longitude: 18 }
  ];
  const recommendations = recommendRouteCaches([
    candidate("one", 59.25, 18.01),
    candidate("two", 59.75, 18.02),
    candidate("off-route", 59.5, 19)
  ], route, 3, false, 1);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0]?.id, "one");
});
