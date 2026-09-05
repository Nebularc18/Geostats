import assert from "node:assert/strict";
import test from "node:test";
import { sampleRouteCoordinates, TravelSearchService, travelSearchBounds } from "./travel-search.service";

test("travel pool summary includes every imported cache type and found state", async () => {
  const prisma = {
    userCacheData: {
      findMany: async () => [
        { cache: { cacheType: "Traditional Cache", finds: [] } },
        { cache: { cacheType: "Multi-cache", finds: [{ id: "find-1" }] } },
        { cache: { cacheType: "Traditional Cache", finds: [] } },
        { cache: { cacheType: null, finds: [] } }
      ]
    }
  };
  const service = new TravelSearchService(prisma as never);

  assert.deepEqual(await service.poolSummary("user-1"), {
    total: 4,
    found: 1,
    unfound: 3,
    poolTruncated: false,
    types: [
      { name: "Traditional Cache", count: 2 },
      { name: "Multi-cache", count: 1 },
      { name: "Unknown type", count: 1 }
    ]
  });
});

test("travel search bounds cover the requested radius", () => {
  const bounds = travelSearchBounds([{ latitude: 56.1612, longitude: 15.5869 }], 10);

  assert.ok(bounds.minimumLatitude < 56.071);
  assert.ok(bounds.maximumLatitude > 56.251);
  assert.ok((bounds.minimumLongitude ?? 0) < 15.426);
  assert.ok((bounds.maximumLongitude ?? 0) > 15.748);
});

test("nearby search filters geographically and bounds matching cache candidates", async () => {
  let query: Record<string, unknown> | undefined;
  const prisma = {
    userCacheData: {
      findMany: async (input: Record<string, unknown>) => {
        query = input;
        return [];
      }
    }
  };
  const service = new TravelSearchService(prisma as never);

  const result = await service.search("user-1", {
    mode: "nearby",
    origin: "Karlskrona",
    radiusKm: 10,
    includeFound: false,
    mysteryCaches: [],
    originPlace: { label: "Karlskrona", latitude: 56.1612, longitude: 15.5869 }
  });

  assert.equal(query!.take, 5001);
  assert.deepEqual(query!.orderBy, [{ updatedAt: "desc" }, { id: "desc" }]);
  const bounds = travelSearchBounds([{ latitude: 56.1612, longitude: 15.5869 }], 10);
  assert.deepEqual((query!.where as any).cache.OR[0], {
    latitude: { gte: bounds.minimumLatitude, lte: bounds.maximumLatitude },
    longitude: { gte: bounds.minimumLongitude, lte: bounds.maximumLongitude }
  });
  assert.equal(result.importedCacheCount, 0);
  assert.equal(result.poolTruncated, false);
});

test("route sampling preserves endpoints and uses a bounded number of points", () => {
  const coordinates = Array.from({ length: 2501 }, (_, index) => ({ latitude: index, longitude: -index }));

  const sampled = sampleRouteCoordinates(coordinates, 2000);

  assert.equal(sampled.length, 2000);
  assert.deepEqual(sampled[0], coordinates[0]);
  assert.deepEqual(sampled.at(-1), coordinates.at(-1));
});

test("travel search reports database and route-geometry truncation", async () => {
  const originalFetch = globalThis.fetch;
  const geometry = Array.from({ length: 2001 }, (_, index) => [index / 1000, index / 1000] as [number, number]);
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: "Ok",
    routes: [{ distance: 1234, duration: 567, geometry: { coordinates: geometry } }]
  }), { status: 200 });
  const cache = {
    id: "cache-1",
    gcCode: "GCCACHE",
    name: "Cache",
    cacheType: "Traditional Cache",
    difficulty: 1,
    terrain: 1,
    size: "Micro",
    latitude: 0,
    longitude: 0,
    country: null,
    region: null,
    county: null,
    finds: [],
    corrections: []
  };
  const prisma = { userCacheData: { findMany: async () => Array(5001).fill({ cache }) } };
  const service = new TravelSearchService(prisma as never);

  try {
    const result = await service.search("user-1", {
      mode: "route",
      origin: "Origin",
      destination: "Destination",
      radiusKm: 10,
      includeFound: false,
      mysteryCaches: [],
      originPlace: { label: "Origin", latitude: 0, longitude: 0 },
      destinationPlace: { label: "Destination", latitude: 2, longitude: 2 }
    });

    assert.equal(result.importedCacheCount, 5000);
    assert.equal(result.poolTruncated, true);
    assert.deepEqual(result.route, {
      distanceMeters: 1234,
      durationSeconds: 567,
      geometryPointCount: 2000,
      originalGeometryPointCount: 2001,
      geometryTruncated: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
