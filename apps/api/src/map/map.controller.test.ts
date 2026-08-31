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
        const start = query.skip ?? 0;
        return finds.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    },
    hide: {
      findMany: async (query: any) => {
        calls.hides.push(query);
        const start = query.skip ?? 0;
        return hides.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    }
  } as any;

  return { controller: new MapController(prisma, {} as any), calls };
}

test("map point endpoints page complete histories without unbounded queries", async () => {
  const finds = Array.from({ length: 10001 }, (_, index) => ({
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(index)
  }));
  const hides = [{ placedAt: new Date("2024-01-03T00:00:00.000Z"), cache: cache(10002) }];
  const { controller, calls } = controllerWith({ finds, hides });

  const firstPage = await controller.caches(user, {});
  const secondPage = await controller.caches(user, { offset: "5000" });
  const lastPage = await controller.caches(user, { offset: "10000" });
  const hidePage = await controller.hides(user, {});

  assert.equal(calls.finds[0].skip, 0);
  assert.equal(calls.finds[0].take, 5001);
  assert.equal(firstPage.truncated, true);
  assert.equal(firstPage.nextOffset, 5000);
  assert.equal(firstPage.points.length, 5000);
  assert.equal(calls.finds[1].skip, 5000);
  assert.equal(secondPage.truncated, true);
  assert.equal(secondPage.nextOffset, 10000);
  assert.equal(secondPage.points.length, 5000);
  assert.equal(calls.finds[2].skip, 10000);
  assert.equal(lastPage.truncated, false);
  assert.equal(lastPage.nextOffset, null);
  assert.equal(lastPage.points.length, 1);
  assert.equal(calls.hides[0].skip, 0);
  assert.equal(calls.hides[0].take, 5001);
  assert.equal(hidePage.truncated, false);
  assert.equal(hidePage.nextOffset, null);
});
