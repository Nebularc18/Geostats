import assert from "node:assert/strict";
import test from "node:test";
import { MapController } from "./map.controller";

const user = { id: "user-1" } as any;

function cache(index = 1) {
  return {
    id: `cache-${index}`,
    gcCode: `GC${index}`,
    name: `Cache ${index}`,
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 2.5,
    size: "Regular",
    latitude: 56,
    longitude: 15,
    country: "Sweden",
    region: "Blekinge",
    county: "Karlskrona",
    hiddenDate: new Date("2020-01-01T00:00:00.000Z")
  };
}

function controllerWith({ finds = [], hides = [] }: { finds?: any[]; hides?: any[] } = {}) {
  const calls = { finds: [] as any[], hides: [] as any[] };
  const prisma = {
    geocachingProfile: {
      findUnique: async () => ({ gcUsername: "owner" })
    },
    find: {
      findMany: async (query: any) => {
        calls.finds.push(query);
        return finds;
      }
    },
    hide: {
      findMany: async (query: any) => {
        calls.hides.push(query);
        return hides;
      }
    }
  } as any;

  return { controller: new MapController(prisma, {} as any), calls };
}

test("map point endpoints can return the complete data set for filtering", async () => {
  const find = { foundAt: new Date("2024-01-02T00:00:00.000Z"), cache: cache() };
  const hide = { placedAt: new Date("2024-01-03T00:00:00.000Z"), cache: cache(2) };
  const { controller, calls } = controllerWith({ finds: [find], hides: [hide] });

  const finds = await controller.caches(user, { includeAll: "true" });
  const hides = await controller.hides(user, { includeAll: "true" });

  assert.equal(calls.finds[0].take, undefined);
  assert.equal(calls.hides[0].take, undefined);
  assert.equal(finds.truncated, false);
  assert.equal(hides.truncated, false);
  assert.equal(finds.points.length, 1);
  assert.equal(hides.points.length, 1);
});

test("capped map requests retain the existing safety limit", async () => {
  const finds = Array.from({ length: 5001 }, (_, index) => ({
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(index)
  }));
  const { controller, calls } = controllerWith({ finds });

  const result = await controller.caches(user, {});

  assert.equal(calls.finds[0].take, 5001);
  assert.equal(result.truncated, true);
  assert.equal(result.points.length, 5000);
});
