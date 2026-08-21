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
  const rows = Array.from({ length: 501 }, (_, index) => `GC${index}`).join("\n");
  assert.throws(() => gsakCsvRecords(`gcCode\n${rows}\n`), /at most 500 rows/);
});

test("GSAK cache batches upsert owned caches and corrected coordinates", async () => {
  const actions: Array<[string, any]> = [];
  const tx = {
    cache: {
      upsert: async (input: any) => {
        actions.push(["cache", input]);
        return { id: "cache-1" };
      }
    },
    userCacheData: { upsert: async (input: any) => actions.push(["userData", input]) },
    hide: { upsert: async (input: any) => actions.push(["hide", input]) },
    correctedCoordinate: { upsert: async (input: any) => actions.push(["correction", input]) }
  };
  const prisma = {
    cache: { findMany: async () => [] },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx)
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,name,cacheType,difficulty,terrain,size,latitude,longitude,country,region,county,hiddenDate,ownerName,foundDate,isFtf,isOwner,favoritePoints,elevationMeters,status,isPremium,correctedLatitude,correctedLongitude,hasCorrected,userNote,attributes",
    'GC123,"Owned, cache",Traditional Cache,2,2.5,Small,56.1,15.6,Sweden,Blekinge,Ronneby,2024-01-02,Owner,,0,1,7,42,Available,0,56.2,15.7,1,"Solved note",1:1|2:0'
  ].join("\r\n");

  const result = await service.importBatch("user-1", "caches", csv);

  assert.deepEqual(result, { caches: 1, hides: 1, corrections: 1 });
  assert.deepEqual(actions.map(([name]) => name), ["cache", "userData", "hide", "correction"]);
  assert.equal(actions[0][1].create.gcCode, "GC123");
  assert.deepEqual(actions[0][1].where, { gcCode: "GC123" });
  assert.equal("userId" in actions[0][1].create, false);
  assert.equal("raw" in actions[0][1].create, false);
  assert.equal(actions[1][1].create.userId, "user-1");
  assert.equal(actions[1][1].create.raw.ele, "42");
  assert.deepEqual(
    actions[1][1].create.raw["groundspeak:cache"]["groundspeak:attributes"]["groundspeak:attribute"],
    [{ id: "1", inc: "1" }, { id: "2", inc: "0" }]
  );
});

test("GSAK log batches merge owned logs and preserve manual FTF choices", async () => {
  const updates: any[] = [];
  const existingFind = { id: "find-1", isFtfManual: true, isFtf: false };
  const tx = {
    find: {
      findFirst: async () => existingFind,
      update: async (input: any) => updates.push(["find", input])
    },
    hide: {
      findUnique: async () => ({ id: "hide-1", receivedLogCount: 0, receivedLogsRaw: null }),
      update: async (input: any) => updates.push(["hide", input])
    }
  };
  const prisma = {
    cache: {
      findMany: async (input: any) => {
        assert.deepEqual(input.where.userData, { some: { userId: "user-1" } });
        return [{ id: "cache-1", gcCode: "GC123", userData: [{ raw: { "gsak:wptExtension": { "gsak:FTF": true } } }] }];
      }
    },
    hide: { findMany: async () => [{ id: "hide-1", cache: { gcCode: "GC123" } }] },
    geocachingProfile: { findUnique: async () => ({ ftfDetectionTerms: ["FTF"] }) },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx)
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,First!,1"
  ].join("\r\n");

  const result = await service.importBatch("user-1", "logs", csv);

  assert.deepEqual(result, { logs: 1, finds: 1, receivedLogs: 1 });
  assert.equal("isFtf" in updates[0][1].data, false);
  assert.equal(updates[1][1].data.receivedLogCount, 1);
  assert.equal(updates[1][1].data.receivedLogsRaw["groundspeak:cache"]["groundspeak:logs"]["groundspeak:log"][0]["geostats:log_id"], "99");
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
      create: async (input: any) => actions.push(["create", input])
    }
  };
  const prisma = {
    cache: { findMany: async () => [{ id: "cache-1", gcCode: "GC123", raw: {} }] },
    hide: { findMany: async () => [] },
    geocachingProfile: { findUnique: async () => ({ ftfDetectionTerms: ["FTF"] }) },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx)
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,Found it,0"
  ].join("\r\n");

  const result = await service.importBatch("user-1", "logs", csv);

  assert.deepEqual(result, { logs: 1, finds: 1, receivedLogs: 0 });
  assert.equal(actions.some(([name]) => name === "create"), false);
  assert.equal(actions[0][0], "findMany");
  assert.equal(actions[0][1].where.importedFrom.not, "GSAK");
  assert.equal(actions[0][1].where.foundDate.gte.toISOString(), "2024-01-01T00:00:00.000Z");
  assert.equal(actions[0][1].where.foundDate.lte.toISOString(), "2024-01-03T00:00:00.000Z");
  assert.equal(actions[1][0], "update");
  assert.equal(actions[1][1].where.id, "find-gpx");
  assert.equal(actions[1][1].data.foundDate.toISOString(), "2024-01-02T00:00:00.000Z");
  assert.equal(actions[1][1].data.foundAt.toISOString(), "2024-01-02T13:14:15.000Z");
});

test("GSAK log batches do not guess when multiple adjacent imported finds exist", async () => {
  const actions: Array<[string, any]> = [];
  const tx = {
    find: {
      findFirst: async () => null,
      findMany: async () => [
        { id: "find-1", isFtfManual: false },
        { id: "find-2", isFtfManual: false }
      ],
      update: async (input: any) => actions.push(["update", input]),
      create: async (input: any) => actions.push(["create", input])
    }
  };
  const prisma = {
    cache: { findMany: async () => [{ id: "cache-1", gcCode: "GC123", raw: {} }] },
    hide: { findMany: async () => [] },
    geocachingProfile: { findUnique: async () => null },
    $transaction: async (run: (client: any) => Promise<unknown>) => run(tx)
  };
  const service = new GsakImportService(prisma as any, {} as any);
  const csv = [
    "gcCode,logId,type,finder,date,time,latitude,longitude,ownerId,isOwnLog,text,cacheIsOwned",
    "GC123,99,Found it,Owner,2024-01-02,13:14:15,,,42,1,Found it,0"
  ].join("\r\n");

  await service.importBatch("user-1", "logs", csv);

  assert.equal(actions.some(([name]) => name === "update"), false);
  assert.equal(actions.filter(([name]) => name === "create").length, 1);
});
