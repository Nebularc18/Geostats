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
        const cursorIndex = query.cursor ? finds.findIndex((find) => find.id === query.cursor.id) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (query.skip ?? 0) : 0;
        return finds.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    },
    hide: {
      findMany: async (query: any) => {
        calls.hides.push(query);
        const cursorIndex = query.cursor ? hides.findIndex((hide) => hide.id === query.cursor.id) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (query.skip ?? 0) : 0;
        return hides.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    }
  } as any;

  return { controller: new MapController(prisma, {} as any), calls };
}

test("map point endpoints page complete histories without unbounded queries", async () => {
  const finds = Array.from({ length: 10001 }, (_, index) => ({
    id: `find-${index}`,
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(index)
  }));
  const hides = [{ id: "hide-10002", placedAt: new Date("2024-01-03T00:00:00.000Z"), cache: cache(10002) }];
  const { controller, calls } = controllerWith({ finds, hides });

  const firstPage = await controller.caches(user, {});
  const secondPage = await controller.caches(user, { cursor: firstPage.nextCursor });
  const lastPage = await controller.caches(user, { cursor: secondPage.nextCursor });
  const hidePage = await controller.hides(user, {});

  assert.equal(calls.finds[0].cursor, undefined);
  assert.equal(calls.finds[0].skip, undefined);
  assert.equal(calls.finds[0].take, 5001);
  assert.equal(firstPage.truncated, true);
  assert.equal(firstPage.nextCursor, "find-4999");
  assert.equal(firstPage.points.length, 5000);
  assert.deepEqual(calls.finds[1].cursor, { id: "find-4999" });
  assert.equal(calls.finds[1].skip, 1);
  assert.equal(secondPage.truncated, true);
  assert.equal(secondPage.nextCursor, "find-9999");
  assert.equal(secondPage.points.length, 5000);
  assert.deepEqual(calls.finds[2].cursor, { id: "find-9999" });
  assert.equal(calls.finds[2].skip, 1);
  assert.equal(lastPage.truncated, false);
  assert.equal(lastPage.nextCursor, null);
  assert.equal(lastPage.points.length, 1);
  assert.equal(calls.hides[0].cursor, undefined);
  assert.equal(calls.hides[0].skip, undefined);
  assert.equal(calls.hides[0].take, 5001);
  assert.equal(hidePage.truncated, false);
  assert.equal(hidePage.nextCursor, null);
});

test("cursor pagination keeps the next page anchored when an import adds a newer find", async () => {
  const finds = Array.from({ length: 5001 }, (_, index) => ({
    id: `find-${index}`,
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(index)
  }));
  const { controller } = controllerWith({ finds });

  const firstPage = await controller.caches(user, {});
  finds.unshift({
    id: "find-imported",
    foundAt: new Date("2025-01-02T00:00:00.000Z"),
    cache: cache(6000)
  });
  const secondPage = await controller.caches(user, { cursor: firstPage.nextCursor });

  assert.equal(secondPage.points[0]?.gcCode, "GC5000");
});

test("map pages keep an immutable ordering and snapshot cutoff", async () => {
  const finds = [{
    id: "find-1",
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(1)
  }];
  const { controller, calls } = controllerWith({ finds });

  const firstPage = await controller.caches(user, {});
  const secondPage = await controller.caches(user, { snapshot: firstPage.snapshot });

  assert.equal(typeof firstPage.snapshot, "string");
  assert.deepEqual(calls.finds[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(calls.finds[0].where.createdAt, { lte: new Date(firstPage.snapshot) });
  assert.deepEqual(calls.finds[1].where.createdAt, { lte: new Date(firstPage.snapshot) });
  assert.equal(secondPage.snapshot, firstPage.snapshot);
});
