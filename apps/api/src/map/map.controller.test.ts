import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
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
  let latestImport: any = null;
  const prisma = {
    geocachingProfile: {
      findUnique: async () => ({ gcUsername: "owner" })
    },
    find: {
      count: async () => finds.length,
      findFirst: async () => finds.length ? { id: finds[0].id, updatedAt: finds[0].updatedAt ?? new Date("2024-01-01T00:00:00.000Z") } : null,
      findMany: async (query: any) => {
        calls.finds.push(query);
        const cursorIndex = query.cursor ? finds.findIndex((find) => find.id === query.cursor.id) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (query.skip ?? 0) : 0;
        return finds.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    },
    hide: {
      count: async () => hides.length,
      findFirst: async () => hides.length ? { id: hides[0].id, updatedAt: hides[0].updatedAt ?? new Date("2024-01-01T00:00:00.000Z") } : null,
      findMany: async (query: any) => {
        calls.hides.push(query);
        const cursorIndex = query.cursor ? hides.findIndex((hide) => hide.id === query.cursor.id) : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (query.skip ?? 0) : 0;
        return hides.slice(start, query.take === undefined ? undefined : start + query.take);
      }
    },
    import: {
      findFirst: async () => latestImport
    }
  } as any;

  return {
    controller: new MapController(prisma, {} as any),
    calls,
    setLatestImport: (id: string) => {
      latestImport = {
        id,
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        updatedAt: new Date("2024-01-01T00:00:00.000Z")
      };
    }
  };
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
  const secondPage = await controller.caches(user, {
    cursor: firstPage.nextCursor,
    snapshot: firstPage.snapshot,
    snapshotRevision: firstPage.snapshotRevision
  });
  const lastPage = await controller.caches(user, {
    cursor: secondPage.nextCursor,
    snapshot: secondPage.snapshot,
    snapshotRevision: secondPage.snapshotRevision
  });
  const hidePage = await controller.hides(user, {});

  assert.equal(calls.finds[0].cursor, undefined);
  assert.equal(calls.finds[0].skip, undefined);
  assert.equal(calls.finds[0].take, 5001);
  assert.equal(firstPage.truncated, true);
  assert.equal(firstPage.totalCount, finds.length);
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

test("rejects a cursor when an import adds a newer find", async () => {
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
  await assert.rejects(
    () => controller.caches(user, {
      cursor: firstPage.nextCursor,
      snapshot: firstPage.snapshot,
      snapshotRevision: firstPage.snapshotRevision
    }),
    (error: unknown) => error instanceof ConflictException && error.message === "map snapshot expired"
  );
});

test("map pages keep an immutable ordering and snapshot cutoff", async () => {
  const finds = [{
    id: "find-1",
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(1)
  }];
  const { controller, calls } = controllerWith({ finds });

  const firstPage = await controller.caches(user, {});
  const secondPage = await controller.caches(user, {
    snapshot: firstPage.snapshot,
    snapshotRevision: firstPage.snapshotRevision
  });

  assert.equal(typeof firstPage.snapshot, "string");
  assert.deepEqual(calls.finds[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(calls.finds[0].where.AND.find((condition: any) => condition.createdAt)?.createdAt, { lte: new Date(firstPage.snapshot) });
  assert.deepEqual(calls.finds[1].where.AND.find((condition: any) => condition.createdAt)?.createdAt, { lte: new Date(firstPage.snapshot) });
  assert.equal(secondPage.snapshot, firstPage.snapshot);
});

test("rejects a cursor when an import changes the map snapshot", async () => {
  const finds = Array.from({ length: 5001 }, (_, index) => ({
    id: `find-${index}`,
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    cache: cache(index)
  }));
  const { controller, setLatestImport } = controllerWith({ finds });

  const firstPage = await controller.caches(user, {});
  setLatestImport("import-1");

  await assert.rejects(
    () => controller.caches(user, {
      cursor: firstPage.nextCursor,
      snapshot: firstPage.snapshot,
      snapshotRevision: firstPage.snapshotRevision
    }),
    (error: unknown) => error instanceof ConflictException && error.message === "map snapshot expired"
  );
});

test("rejects a cursor when an existing point is updated", async () => {
  const finds = Array.from({ length: 5001 }, (_, index) => ({
    id: `find-${index}`,
    foundAt: new Date("2024-01-02T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    cache: cache(index)
  }));
  const { controller } = controllerWith({ finds });

  const firstPage = await controller.caches(user, {});
  finds[0]!.updatedAt = new Date("2025-01-01T00:00:00.000Z");

  await assert.rejects(
    () => controller.caches(user, {
      cursor: firstPage.nextCursor,
      snapshot: firstPage.snapshot,
      snapshotRevision: firstPage.snapshotRevision
    }),
    (error: unknown) => error instanceof ConflictException && error.message === "map snapshot expired"
  );
});

test("map filters are applied before pagination", async () => {
  const { controller, calls } = controllerWith({ finds: [{ id: "find-1", foundAt: new Date("2024-06-01T12:00:00.000Z"), cache: cache(1) }] });

  const result = await controller.caches(user, {
    query: "old cache",
    cacheType: "Mystery Cache",
    size: "Regular",
    country: "Sweden",
    region: "Blekinge",
    difficultyMin: "1.5",
    difficultyMax: "3",
    terrainMin: "2",
    terrainMax: "4",
    dateFrom: "2024-01-01",
    dateTo: "2024-12-31"
  });

  const conditions = calls.finds[0].where.AND as any[];
  const cacheCondition = conditions.find((condition) => condition.cache).cache;
  const cacheFilters = cacheCondition.AND as any[];
  assert.equal(cacheFilters[0].OR[0].gcCode.contains, "old cache");
  assert.equal(cacheFilters.find((condition) => condition.cacheType)?.cacheType, "Mystery Cache");
  assert.deepEqual(cacheFilters.find((condition) => condition.difficulty)?.difficulty, { gte: 1.5, lte: 3 });
  assert.deepEqual(cacheFilters.find((condition) => condition.terrain)?.terrain, { gte: 2, lte: 4 });
  assert.deepEqual(conditions.find((condition) => condition.foundAt)?.foundAt, {
    gte: new Date("2024-01-01T00:00:00.000Z"),
    lte: new Date("2024-12-31T23:59:59.999Z")
  });
  assert.equal(result.totalCount, 1);
});
