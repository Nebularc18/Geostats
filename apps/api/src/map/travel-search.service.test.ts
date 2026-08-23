import assert from "node:assert/strict";
import test from "node:test";
import { TravelSearchService } from "./travel-search.service";

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
