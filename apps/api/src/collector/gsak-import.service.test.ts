import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { GsakImportService, gsakCsvRecords } from "./gsak-import.service";

test("gsakCsvRecords preserves quoted commas and multiline log text", () => {
  const rows = gsakCsvRecords('gcCode,text\r\nGC123,"Nice, easy\r\ncache"\r\n');
  assert.deepEqual(rows, [{ gccode: "GC123", text: "Nice, easy\r\ncache" }]);
});

test("gsakCsvRecords rejects empty and oversized batches", () => {
  assert.throws(() => gsakCsvRecords("gcCode\n"), BadRequestException);
  const rows = Array.from({ length: 501 }, (_, index) => `GC${index}`).join(
    "\n",
  );
  assert.throws(() => gsakCsvRecords(`gcCode\n${rows}\n`), /at most 500 rows/);
});

test("GSAK completion records the run in import history", async () => {
  const created: any[] = [];
  const tx = { import: { create: async (input: any) => created.push(input) } };
  const prisma = {
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const stats = {
    buildSnapshotForUser: async (userId: string) => ({ userId }),
    replaceSnapshotForUser: async (
      userId: string,
      snapshot: unknown,
      client: unknown,
    ) => {
      assert.equal(userId, "user-1");
      assert.deepEqual(snapshot, { userId: "user-1" });
      assert.equal(client, tx);
    },
  };
  const service = new GsakImportService(prisma as any, stats as any);

  const result = await service.importBatch("user-1", "complete", undefined);

  assert.deepEqual(result, { completed: true });
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].data, {
    userId: "user-1",
    fileName: "GSAK database",
    fileType: "JSON",
    source: "GSAK",
    status: "COMPLETED",
    objectKey: created[0].data.objectKey,
  });
  assert.match(created[0].data.objectKey, /^gsak\/user-1\/\d+\.json$/);
});

test("trackable cache code pages return code-only journey placeholders", async () => {
  const queries: any[] = [];
  const prisma = {
    $queryRaw: async (query: any) => {
      queries.push(query);
      return queries.length === 1
        ? [{ count: 2n }]
        : [{ gcCode: "GC123" }, { gcCode: "GC456" }];
    },
  };
  const service = new GsakImportService(prisma as any, {} as any);

  const result = await service.trackableCacheCodes("user-1", "200", "500");

  assert.deepEqual(result, { total: 2, codes: "GC123,GC456" });
  assert.match(queries[0].sql, /trackable_logs/);
  assert.match(queries[0].sql, /upper\(trim\(c\.name\)\)/);
  assert.deepEqual(queries[0].values, ["user-1"]);
  assert.deepEqual(queries[1].values, ["user-1", 200, 500]);
});

test("admin GSAK code pages merge missing references across global sources", async () => {
  const prisma = {
    trackableLog: {
      findMany: async () => [{ gcCode: "gc123" }, { gcCode: "GC456" }],
    },
    mysteryWorkspace: {
      findMany: async () => [{ gcCode: "GC123" }, { gcCode: "GC789" }],
    },
    challengeChecker: {
      findMany: async () => [{ gcCode: "GC456" }, { gcCode: "not-a-cache" }],
    },
    cache: {
      findMany: async (input: any) => {
        assert.deepEqual(input.where.gcCode.in, ["GC123", "GC456", "GC789"]);
        return [{ gcCode: "GC456" }];
      },
    },
  };
  const service = new GsakImportService(prisma as any, {} as any);

  assert.deepEqual(await service.adminMissingCacheCodes("0", "500"), {
    total: 2,
    codes: "GC123,GC789",
  });
});

test("admin GSAK cache batches create shared metadata without personal records", async () => {
  const actions: Array<[string, any]> = [];
  const tx = {
    cache: {
      upsert: async (input: any) => {
        actions.push(["cache", input]);
        return { id: "cache-1" };
      },
    },
    trackableLog: {
      updateMany: async (input: any) => {
        actions.push(["trackableLog", input]);
        return { count: 2 };
      },
    },
  };
  const prisma = {
    trackableLog: { findMany: async () => [{ gcCode: "GC123" }] },
    mysteryWorkspace: { findMany: async () => [] },
    challengeChecker: { findMany: async () => [] },
    cache: {
      findMany: async () => [],
    },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,name,cacheType,difficulty,terrain,size,latitude,longitude,country,region,county,hiddenDate,ownerName,foundDate,isFtf,isOwner,favoritePoints,elevationMeters,status,isPremium,correctedLatitude,correctedLongitude,hasCorrected,userNote,attributes",
    "GC123,Shared cache,Traditional Cache,2,2.5,Small,56.1,15.6,Sweden,Blekinge,Ronneby,2024-01-02,Owner,2024-01-03,1,1,7,42,Available,1,56.2,15.7,1,Private note,1:1",
  ].join("\r\n");

  const result = await service.importAdminCacheBatch(csv);

  assert.deepEqual(result, { caches: 1, ignored: 0, linkedTrackableLogs: 2 });
  assert.deepEqual(
    actions.map(([name]) => name),
    ["cache", "trackableLog"],
  );
  assert.equal(actions[0][1].create.gcCode, "GC123");
  assert.equal(actions[0][1].create.name, "Shared cache");
  assert.equal(actions[1][1].where.gcCode.mode, "insensitive");
});

test("GSAK cache batches upsert owned caches and corrected coordinates", async () => {
  const actions: Array<[string, any]> = [];
  const tx = {
    cache: {
      upsert: async (input: any) => {
        actions.push(["cache", input]);
        return { id: "cache-1" };
      },
    },
    userCacheData: {
      upsert: async (input: any) => actions.push(["userData", input]),
    },
    hide: { upsert: async (input: any) => actions.push(["hide", input]) },
    correctedCoordinate: {
      upsert: async (input: any) => actions.push(["correction", input]),
    },
  };
  const prisma = {
    cache: { findMany: async () => [] },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,name,cacheType,difficulty,terrain,size,latitude,longitude,country,region,county,hiddenDate,ownerName,foundDate,isFtf,isOwner,favoritePoints,elevationMeters,status,isPremium,correctedLatitude,correctedLongitude,hasCorrected,userNote,attributes",
    'GC123,"Owned, cache",Traditional Cache,2,2.5,Small,56.1,15.6,Sweden,Blekinge,Ronneby,2024-01-02,Owner,,0,1,7,42,Available,0,56.2,15.7,1,"Solved note",1:1|2:0',
  ].join("\r\n");

  const result = await service.importBatch("user-1", "caches", csv);

  assert.deepEqual(result, { caches: 1, hides: 1, corrections: 1 });
  assert.deepEqual(
    actions.map(([name]) => name),
    ["cache", "userData", "hide", "correction"],
  );
  assert.equal(actions[0][1].create.gcCode, "GC123");
  assert.deepEqual(actions[0][1].where, { gcCode: "GC123" });
  assert.equal("userId" in actions[0][1].create, false);
  assert.equal("raw" in actions[0][1].create, false);
  assert.equal(actions[1][1].create.userId, "user-1");
  assert.equal(actions[1][1].create.raw.ele, "42");
  assert.deepEqual(
    actions[1][1].create.raw["groundspeak:cache"]["groundspeak:attributes"][
      "groundspeak:attribute"
    ],
    [
      { id: "1", inc: "1" },
      { id: "2", inc: "0" },
    ],
  );
});

test("GSAK cache batches enrich a cache placeholder created by a trackable import", async () => {
  const updates: any[] = [];
  const existingCache = {
    id: "cache-1",
    gcCode: "GC123",
    name: "GC123",
    userData: [],
  };
  const tx = {
    cache: {
      upsert: async (input: any) => {
        updates.push(input);
        return { id: existingCache.id };
      },
    },
    userCacheData: { upsert: async () => ({}) },
    hide: { upsert: async () => ({}) },
    correctedCoordinate: { upsert: async () => ({}) },
  };
  const prisma = {
    cache: { findMany: async () => [existingCache] },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,name,cacheType,difficulty,terrain,size,latitude,longitude",
    "GC123,Named cache,Traditional Cache,2,2.5,Small,56.1,15.6",
  ].join("\r\n");

  await service.importBatch("user-1", "caches", csv);

  assert.deepEqual(updates[0].update, { name: "Named cache" });
});

test("GSAK log batches merge owned logs and preserve manual FTF choices", async () => {
  const updates: any[] = [];
  const existingFind = { id: "find-1", isFtfManual: true, isFtf: false };
  const tx = {
    $queryRaw: async (query: any) => {
      assert.match(query.sql, /FOR UPDATE/);
      assert.deepEqual(query.values, ["hide-1", "user-1"]);
      return [{ id: "hide-1", receivedLogsRaw: null }];
    },
    find: {
      findFirst: async () => existingFind,
      update: async (input: any) => updates.push(["find", input]),
    },
    hide: {
      update: async (input: any) => updates.push(["hide", input]),
    },
  };
  const prisma = {
    cache: {
      findMany: async (input: any) => {
        assert.deepEqual(input.where.userData, { some: { userId: "user-1" } });
        return [
          {
            id: "cache-1",
            gcCode: "GC123",
            userData: [{ raw: { "gsak:wptExtension": { "gsak:FTF": true } } }],
          },
        ];
      },
    },
    hide: {
      findMany: async () => [{ id: "hide-1", cache: { gcCode: "GC123" } }],
    },
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"] }),
    },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,First!,1",
  ].join("\r\n");

  const result = await service.importBatch("user-1", "logs", csv);

  assert.deepEqual(result, { logs: 1, finds: 1, receivedLogs: 1 });
  assert.equal("isFtf" in updates[0][1].data, false);
  assert.equal(updates[1][1].data.receivedLogCount, 1);
  assert.equal(
    updates[1][1].data.receivedLogsRaw["groundspeak:cache"]["groundspeak:logs"][
      "groundspeak:log"
    ][0]["geostats:log_id"],
    "99",
  );
});

test("concurrent GSAK log batches serialize received-log merges", async () => {
  let storedRaw: any = null;
  let lockTail = Promise.resolve();
  const prisma = {
    cache: {
      findMany: async () => [
        { id: "cache-1", gcCode: "GC123", userData: [{ raw: {} }] },
      ],
    },
    hide: {
      findMany: async () => [{ id: "hide-1", cache: { gcCode: "GC123" } }],
    },
    geocachingProfile: { findUnique: async () => null },
    $transaction: async (run: (client: any) => Promise<unknown>) => {
      const previousLock = lockTail;
      let releaseLock!: () => void;
      lockTail = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      let locked = false;
      const tx = {
        $queryRaw: async () => {
          await previousLock;
          locked = true;
          return [{ id: "hide-1", receivedLogsRaw: storedRaw }];
        },
        hide: {
          update: async (input: any) => {
            assert.equal(locked, true);
            await new Promise((resolve) => setImmediate(resolve));
            storedRaw = input.data.receivedLogsRaw;
          },
        },
      };
      try {
        return await run(tx);
      } finally {
        releaseLock();
      }
    },
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = (logId: string) =>
    [
      "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
      `GC123,${logId},Found it,Visitor,2024-01-02,13:14:15,,,42,0,Log ${logId},1`,
    ].join("\r\n");

  const results = await Promise.all([
    service.importBatch("user-1", "logs", csv("100")),
    service.importBatch("user-1", "logs", csv("101")),
  ]);

  assert.deepEqual(
    results.map((result) => (result as { receivedLogs: number }).receivedLogs),
    [1, 1],
  );
  const logs =
    storedRaw["groundspeak:cache"]["groundspeak:logs"]["groundspeak:log"];
  assert.deepEqual(logs.map((log: any) => log["geostats:log_id"]).sort(), [
    "100",
    "101",
  ]);
});

test("GSAK log batches merge a single adjacent-day GPX find instead of duplicating it", async () => {
  const actions: Array<[string, any]> = [];
  const adjacentFind = { id: "find-gpx", isFtfManual: false, isFtf: false };
  const tx = {
    find: {
      findFirst: async () => null,
      findMany: async (input: any) => {
        actions.push(["findMany", input]);
        return [adjacentFind];
      },
      update: async (input: any) => actions.push(["update", input]),
      create: async (input: any) => actions.push(["create", input]),
    },
  };
  const prisma = {
    cache: {
      findMany: async () => [{ id: "cache-1", gcCode: "GC123", raw: {} }],
    },
    hide: { findMany: async () => [] },
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"] }),
    },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,Found it,0",
  ].join("\r\n");

  const result = await service.importBatch("user-1", "logs", csv);

  assert.deepEqual(result, { logs: 1, finds: 1, receivedLogs: 0 });
  assert.equal(
    actions.some(([name]) => name === "create"),
    false,
  );
  assert.equal(actions[0][0], "findMany");
  assert.equal(actions[0][1].where.importedFrom.not, "GSAK");
  assert.equal(
    actions[0][1].where.foundDate.gte.toISOString(),
    "2024-01-01T00:00:00.000Z",
  );
  assert.equal(
    actions[0][1].where.foundDate.lte.toISOString(),
    "2024-01-03T00:00:00.000Z",
  );
  assert.equal(actions[1][0], "update");
  assert.equal(actions[1][1].where.id, "find-gpx");
  assert.equal(
    actions[1][1].data.foundDate.toISOString(),
    "2024-01-02T00:00:00.000Z",
  );
  assert.equal(
    actions[1][1].data.foundAt.toISOString(),
    "2024-01-02T13:14:15.000Z",
  );
});

test("GSAK log batches do not guess when multiple adjacent imported finds exist", async () => {
  const actions: Array<[string, any]> = [];
  const tx = {
    find: {
      findFirst: async () => null,
      findMany: async () => [
        { id: "find-1", isFtfManual: false },
        { id: "find-2", isFtfManual: false },
      ],
      update: async (input: any) => actions.push(["update", input]),
      create: async (input: any) => actions.push(["create", input]),
    },
  };
  const prisma = {
    cache: {
      findMany: async () => [{ id: "cache-1", gcCode: "GC123", raw: {} }],
    },
    hide: { findMany: async () => [] },
    geocachingProfile: { findUnique: async () => null },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx),
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,Found it,0",
  ].join("\r\n");

  await service.importBatch("user-1", "logs", csv);

  assert.equal(
    actions.some(([name]) => name === "update"),
    false,
  );
  assert.equal(actions.filter(([name]) => name === "create").length, 1);
});
