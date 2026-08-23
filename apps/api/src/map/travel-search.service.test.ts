import assert from "node:assert/strict";
import test from "node:test";
import { TravelSearchService, travelSearchBounds } from "./travel-search.service";

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

test("nearby search filters geographically before loading every matching cache", async () => {
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

  assert.equal("take" in query!, false);
  assert.equal("orderBy" in query!, false);
  const bounds = travelSearchBounds([{ latitude: 56.1612, longitude: 15.5869 }], 10);
  assert.deepEqual((query!.where as any).cache.OR[0], {
    latitude: { gte: bounds.minimumLatitude, lte: bounds.maximumLatitude },
    longitude: { gte: bounds.minimumLongitude, lte: bounds.maximumLongitude }
  });
  assert.equal(result.importedCacheCount, 0);
  assert.equal(result.poolTruncated, false);
});
