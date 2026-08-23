import assert from "node:assert/strict";
import test from "node:test";
import {
  finalTravelCoordinate,
  newerTravelAssignment,
  normalizedTripName,
  reconcileStaleTravelAssignment,
  travelDirectionsUrl,
  travelGroups,
  type TravelPlannerCache
} from "./travel-planner.ts";

function cache(overrides: Partial<TravelPlannerCache> = {}): TravelPlannerCache {
  return { id: "cache-1", attempts: [], ...overrides };
}

test("normalizes trip names", () => {
  assert.equal(normalizedTripName("  Stockholm   weekend  "), "Stockholm weekend");
  assert.equal(normalizedTripName(null), "");
});

test("uses only correct, usable coordinates", () => {
  assert.equal(finalTravelCoordinate(cache({
    attempts: [
      { state: "wrong", latitude: 59, longitude: 18 },
      { state: "correct", kind: "keyword", latitude: 60, longitude: 19 },
      { state: "correct", kind: "keyword", finalLatitude: 61, finalLongitude: 20 }
    ]
  }))?.latitude, 61);
  assert.equal(finalTravelCoordinate(cache({ attempts: [{ state: "correct", kind: "approach", latitude: 59, longitude: 18 }] })), null);
});

test("groups trip names without case-sensitive duplicates", () => {
  const groups = travelGroups([
    cache({ id: "one", trip: "Road trip" }),
    cache({ id: "two", trip: "road trip" }),
    cache({ id: "three" })
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.[0], "Road trip");
  assert.deepEqual(groups[0]?.[1].map(({ id }) => id), ["one", "two"]);
});

test("keeps the newest travel assignment during account reconciliation", () => {
  const server = cache({ trip: "Server", tripUpdatedAt: "2026-08-23T10:00:00.000Z" });
  const device = cache({ trip: "Device", tripUpdatedAt: "2026-08-23T11:00:00.000Z" });
  assert.equal(newerTravelAssignment(server, device).trip, "Device");
  assert.equal(newerTravelAssignment(device, server).trip, "Device");
});

test("rebases a newer device trip onto stale server content for retry", () => {
  const server = {
    id: "cache-1",
    name: "New server name",
    trip: "Server",
    tripUpdatedAt: "2026-01-01T10:00:00.000Z",
    attempts: []
  };
  const desired = {
    id: "cache-1",
    name: "Old device name",
    trip: "Device",
    tripUpdatedAt: "2026-01-01T11:00:00.000Z",
    attempts: []
  };

  assert.deepEqual(reconcileStaleTravelAssignment(server, desired), {
    retry: true,
    cache: {
      ...server,
      trip: "Device",
      tripUpdatedAt: "2026-01-01T11:00:00.000Z"
    }
  });
});

test("keeps a newer server trip instead of retrying a stale device assignment", () => {
  const server = {
    id: "cache-1",
    trip: "Server",
    tripUpdatedAt: "2026-01-01T12:00:00.000Z",
    attempts: []
  };
  const desired = {
    id: "cache-1",
    trip: "Device",
    tripUpdatedAt: "2026-01-01T11:00:00.000Z",
    attempts: []
  };

  assert.deepEqual(reconcileStaleTravelAssignment(server, desired), {
    retry: false,
    cache: {
      ...desired,
      trip: "Server",
      tripUpdatedAt: "2026-01-01T12:00:00.000Z"
    }
  });
});

test("builds a directions link from ready caches", () => {
  const url = travelDirectionsUrl([
    cache({ attempts: [{ state: "correct", latitude: 59, longitude: 18 }] }),
    cache({ id: "cache-2", attempts: [{ state: "correct", latitude: 60, longitude: 19 }] })
  ]);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("destination"), "60,19");
  assert.equal(parsed.searchParams.get("waypoints"), "59,18");
});
