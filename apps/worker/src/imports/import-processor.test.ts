import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@geostats/db";
import { ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { ImportProcessor } from "./import-processor";

function withUserCacheData<T extends Record<string, any>>(prisma: T): T {
  const models = prisma as T & {
    userCacheData?: { upsert: () => Promise<object> };
    import?: { updateMany?: () => Promise<{ count: number }> };
    $transaction?: (callback: (tx: any) => Promise<unknown>) => Promise<unknown>;
  };
  models.userCacheData ??= { upsert: async () => ({}) };
  const injectedImportClaim = Boolean(models.import && typeof models.import.updateMany !== "function");
  if (injectedImportClaim) {
    models.import = { ...models.import, updateMany: async () => ({ count: 1 }) };
  }
  const transaction = models.$transaction;
  if (typeof transaction === "function") {
    let transactionCalls = 0;
    models.$transaction = (callback: (tx: any) => Promise<unknown>) =>
      transaction.call(models, async (tx: any) => {
        transactionCalls += 1;
        const injectedQueryRaw = transactionCalls === 1 && typeof tx.$queryRaw !== "function";
        const injectedImport = typeof tx.import?.update !== "function";
        if (injectedQueryRaw) tx.$queryRaw = async () => [];
        if (injectedImport) tx.import = { ...(tx.import ?? {}), update: async () => ({}) };
        try {
          return await callback(tx);
        } finally {
          if (injectedQueryRaw) delete tx.$queryRaw;
          if (injectedImport) delete tx.import.update;
        }
      });
  }
  return prisma;
}

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0">
  <wpt lat="56.161200" lon="15.586900">
    <time>2020-01-01T00:00:00Z</time>
    <name>GC12345</name>
    <groundspeak:cache>
      <groundspeak:name>Attacker Cache Name</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Regular</groundspeak:container>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
    </groundspeak:cache>
  </wpt>
</gpx>`;

const myFindsGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0">
  <wpt lat="56.161200" lon="15.586900">
    <time>2020-01-01T00:00:00Z</time>
    <name>GC12345</name>
    <groundspeak:cache>
      <groundspeak:name>Found Cache</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Regular</groundspeak:container>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
      <groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2024-05-01T12:34:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:text>Nice find.</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>
  </wpt>
</gpx>`;

const ftfLogTimeGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0">
  <wpt lat="56.161200" lon="15.586900">
    <time>2020-01-01T00:00:00Z</time>
    <name>GC12345</name>
    <groundspeak:cache>
      <groundspeak:name>Found Cache</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Regular</groundspeak:container>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
      <groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2026-05-03T19:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:text>FTF
Time 08:11

TFTC</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>
  </wpt>
</gpx>`;

test("stats recalculations for one user run in order", async () => {
  const processor = new ImportProcessor({} as any, {} as any);
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstCanFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let run = 0;

  (processor as any).calculateAndStoreStats = async () => {
    run += 1;
    const currentRun = run;
    events.push(`start-${currentRun}`);
    if (currentRun === 1) await firstCanFinish;
    events.push(`finish-${currentRun}`);
  };

  const first = (processor as any).recalculateStats("user-1");
  await new Promise((resolve) => setImmediate(resolve));
  const second = (processor as any).recalculateStats("user-1");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ["start-1"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["start-1", "finish-1", "start-2", "finish-2"]);
});

test("stats recalculation holds a database user lock before loading inputs", async () => {
  const events: string[] = [];
  const tx = {
    $queryRaw: async (query: TemplateStringsArray, userId: string) => {
      assert.match(query.join("?"), /pg_advisory_xact_lock/);
      assert.equal(userId, "user-1");
      events.push("lock");
      return [];
    },
    geocachingProfile: { findUnique: async () => (events.push("read"), null) },
    hide: { findMany: async () => [] },
    ownerFinderCountryStat: { findMany: async () => [] },
    find: { findMany: async () => [] },
    statSnapshot: {
      deleteMany: async () => events.push("delete"),
      create: async () => events.push("create")
    }
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, {} as any);
  await (processor as any).calculateAndStoreStats("user-1");

  assert.deepEqual(events, ["lock", "read", "delete", "create"]);
});

test("process skips a job when the import is no longer queued", async () => {
  let objectRead = false;
  const prisma = {
    import: {
      findFirst: async () => ({
        id: "import-1",
        userId: "user-1",
        fileName: "my-finds.gpx",
        fileType: ImportFileType.GPX,
        source: ImportSource.MY_FINDS_GPX,
        objectKey: "user-1/original.gpx",
      }),
      updateMany: async (input: any) => {
        assert.deepEqual(input.where, {
          id: "import-1",
          userId: "user-1",
          status: ImportStatus.QUEUED,
        });
        return { count: 0 };
      },
    },
  };
  const storage = {
    getObject: async () => {
      objectRead = true;
      return Buffer.from(gpx);
    },
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX,
  });

  assert.equal(objectRead, false);
});

test("process leaves a failed attempt queued when BullMQ will retry it", async () => {
  const statusUpdates: any[] = [];
  const prisma = {
    import: {
      findFirst: async () => ({
        id: "import-1",
        userId: "user-1",
        fileName: "my-finds.gpx",
        fileType: ImportFileType.GPX,
        source: ImportSource.MY_FINDS_GPX,
        objectKey: "user-1/original.gpx",
      }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }: any) => {
        statusUpdates.push(data);
        return {};
      },
    },
  };
  const storage = {
    getObject: async () => {
      throw new Error("temporary storage failure");
    },
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await assert.rejects(
    processor.process(
      {
        importId: "import-1",
        userId: "user-1",
        objectKey: "user-1/original.gpx",
        source: ImportSource.MY_FINDS_GPX,
      },
      { attemptsMade: 0, maxAttempts: 3 },
    ),
    /temporary storage failure/,
  );

  assert.deepEqual(statusUpdates, [{ status: ImportStatus.QUEUED, errorMessage: null }]);
});

test("process uses the user's existing cache metadata without overwriting it", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Trusted Cache Name",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-hides.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_HIDES_GPX,
    objectKey: "user-1/original.gpx"
  };
  const seenObjectKeys: string[] = [];
  const cacheUpserts: any[] = [];
  const userCacheUpserts: any[] = [];
  const hideUpserts: any[] = [];
  const storedGSAKRaw = {
    "groundspeak:cache": {
      "groundspeak:logs": {
        "groundspeak:log": [
          {
            "geostats:log_id": "900",
            "groundspeak:date": "2024-06-01T12:00:00.000Z",
            "groundspeak:type": "Found it",
            "groundspeak:finder": "GSAK finder",
            "groundspeak:text": "Imported by GSAK"
          }
        ]
      }
    }
  };

  const tx = {
    $queryRaw: async (query: any) => {
      if (typeof query.sql === "string" && query.sql.includes('FROM "hides"')) {
        assert.match(query.sql, /FOR UPDATE/);
        assert.deepEqual(query.values, ["user-1", "cache-1"]);
        return [{ receivedLogsRaw: storedGSAKRaw }];
      }
      return [];
    },
    geocachingProfile: { findUnique: async () => null },
    ownerFinderCountryStat: { findMany: async () => [] },
    hide: {
      upsert: async (input: any) => hideUpserts.push(input),
      findMany: async () => []
    },
    find: {
      upsert: async () => ({}),
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async (input: any) => {
        cacheUpserts.push(input);
        return existingCache;
      }
    },
    userCacheData: { upsert: async (input: any) => userCacheUpserts.push(input) },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async (key: string) => {
      seenObjectKeys.push(key);
      return Buffer.from(
        gpx.replace(
          "    </groundspeak:cache>",
          `      <groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2024-06-02T12:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>GPX finder</groundspeak:finder>
          <groundspeak:text>Imported by GPX</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>`
        )
      );
    }
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/tampered.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.deepEqual(seenObjectKeys, ["user-1/original.gpx"]);
  assert.equal(cacheUpserts.length, 1);
  assert.deepEqual(cacheUpserts[0].where, { gcCode: "GC12345" });
  assert.equal(cacheUpserts[0].create.userId, undefined);
  assert.equal(cacheUpserts[0].create.name, "Attacker Cache Name");
  assert.deepEqual(cacheUpserts[0].update, {});
  assert.equal(userCacheUpserts.length, 1);
  assert.deepEqual(userCacheUpserts[0].where, {
    userId_cacheId: { userId: "user-1", cacheId: "cache-1" }
  });
  assert.equal(userCacheUpserts[0].create.raw["groundspeak:cache"]["groundspeak:name"], "Attacker Cache Name");
  assert.equal(hideUpserts.length, 1);
  assert.equal(hideUpserts[0].update.receivedLogCount, 2);
  const mergedLogs = hideUpserts[0].update.receivedLogsRaw["groundspeak:cache"]["groundspeak:logs"]["groundspeak:log"];
  assert.deepEqual(
    mergedLogs.map((log: any) => log["groundspeak:finder"]),
    ["GPX finder", "GSAK finder"]
  );
});

test("process recovers from concurrent cache upsert conflict by reading the existing cache", async () => {
  const createdCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Concurrent Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-hides.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_HIDES_GPX,
    objectKey: "user-1/original.gpx"
  };
  let cacheUpsertCalls = 0;
  let cacheFindCalls = 0;
  let importTransactionStarted = false;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      upsert: async () => ({})
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => {
        cacheUpsertCalls += 1;
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test"
        });
      },
      findUnique: async (input: any) => {
        assert.deepEqual(input.where, { gcCode: "GC12345" });
        cacheFindCalls += 1;
        return createdCache;
      }
    },
    userCacheData: { upsert: async () => ({}) },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      importTransactionStarted = true;
      return callback(tx);
    },
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_HIDES_GPX
  });

  assert.equal(cacheUpsertCalls, 1);
  assert.equal(cacheFindCalls, 1);
  assert.equal(importTransactionStarted, true);
});

test("process creates missing cache metadata before the import transaction", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Stale Cache Name",
    cacheType: "Traditional Cache",
    difficulty: 1,
    terrain: 1,
    size: "Regular",
    latitude: 55,
    longitude: 14,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const createdCache = {
    ...existingCache,
    name: "Attacker Cache Name",
    difficulty: 2,
    terrain: 1.5,
    latitude: 56.1612,
    longitude: 15.5869
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-hides.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_HIDES_GPX,
    objectKey: "user-1/original.gpx"
  };
  let importTransactionStarted = false;
  let cacheCreateCompleted = false;

  const tx = {
    hide: {
      upsert: async () => {
        assert.equal(cacheCreateCompleted, true);
        return {};
      }
    },
    find: {
      upsert: async () => ({})
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async ({ create, update }: any) => {
        assert.equal(create.name, "Attacker Cache Name");
        assert.equal(create.latitude, 56.1612);
        assert.equal(create.longitude, 15.5869);
        assert.deepEqual(update, {});
        cacheCreateCompleted = true;
        return createdCache;
      }
    },
    userCacheData: { upsert: async () => ({}) },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => {
      importTransactionStarted = true;
      return callback(tx);
    },
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_HIDES_GPX
  });

  assert.equal(cacheCreateCompleted, true);
  assert.equal(importTransactionStarted, true);
});

test("process marks a committed import failed when stats recalculation fails", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Trusted Cache Name",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-hides.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_HIDES_GPX,
    objectKey: "user-1/original.gpx"
  };
  const importStatuses: ImportStatus[] = [];
  const events: string[] = [];
  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      upsert: async () => ({})
    },
    import: {
      update: async ({ where, data }: any) => {
        assert.deepEqual(where, { id: "import-1" });
        assert.ok(data.updatedAt instanceof Date);
        events.push("MAP_REVISION");
        return {};
      }
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      updateMany: async ({ data }: any) => {
        importStatuses.push(data.status);
        events.push(data.status);
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        importStatuses.push(data.status);
        events.push(data.status);
        return {};
      }
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => {
        events.push("RECALCULATE");
        throw new Error("stats timeout");
      }
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await assert.rejects(
    processor.process({
      importId: "import-1",
      userId: "user-1",
      objectKey: "user-1/original.gpx",
      source: ImportSource.MY_HIDES_GPX
    }),
    /stats timeout/
  );

  assert.deepEqual(importStatuses, [ImportStatus.PROCESSING, ImportStatus.FAILED]);
  assert.deepEqual(events, [ImportStatus.PROCESSING, "MAP_REVISION", "RECALCULATE", ImportStatus.FAILED]);
});

test("process updates an existing find to the full GPX timestamp", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFind = {
    id: "find-1",
    userId: "user-1",
    cacheId: "cache-1",
    importId: "old-import",
    foundAt: new Date("2024-05-01T00:00:00.000Z"),
    logText: "Nice find.",
    isFtf: false,
    importedFrom: ImportSource.MY_FINDS_GPX,
    createdAt: new Date("2024-05-01T00:00:00.000Z"),
    updatedAt: new Date("2024-05-01T00:00:00.000Z")
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let updatedFoundAt: Date | string | undefined;
  let recalculationFindsLoaded = false;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [existingFind],
      update: async ({ data }: any) => {
        updatedFoundAt = data.foundAt;
        return { ...existingFind, ...data };
      },
      create: async () => {
        throw new Error("existing find should be updated, not created");
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => {
        recalculationFindsLoaded = true;
        return [];
      }
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(myFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal((updatedFoundAt as Date).toISOString(), "2024-05-01T10:34:00.000Z");
  assert.equal(recalculationFindsLoaded, true);
});

test("process matches same-cache re-imports to each existing find once", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFinds = [
    {
      id: "find-1",
      userId: "user-1",
      cacheId: "cache-1",
      importId: "old-import",
      foundAt: new Date("2024-05-01T12:34:00.000Z"),
      logText: "First old log.",
      isFtf: false,
      isFtfManual: false,
      importedFrom: ImportSource.MY_FINDS_GPX,
      createdAt: new Date("2024-05-01T12:34:00.000Z"),
      updatedAt: new Date("2024-05-01T12:34:00.000Z")
    },
    {
      id: "find-2",
      userId: "user-1",
      cacheId: "cache-1",
      importId: "old-import",
      foundAt: new Date("2024-05-02T12:34:00.000Z"),
      logText: "Second old log.",
      isFtf: false,
      isFtfManual: false,
      importedFrom: ImportSource.MY_FINDS_GPX,
      createdAt: new Date("2024-05-02T12:34:00.000Z"),
      updatedAt: new Date("2024-05-02T12:34:00.000Z")
    }
  ];
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  const updates: Array<{ id: string; foundAt: Date; logText: string | null | undefined }> = [];
  const firstWaypoint = myFindsGpx.match(/  <wpt[\s\S]*?  <\/wpt>/)?.[0] ?? "";
  const twoFindsGpx = myFindsGpx.replace(
    "</gpx>",
    `${firstWaypoint.replace("2024-05-01T12:34:00Z", "2024-05-02T12:34:00Z").replace("Nice find.", "Second find.")}\n</gpx>`
  );

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => existingFinds,
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, foundAt: data.foundAt, logText: data.logText });
        return { ...existingFinds.find((find) => find.id === where.id), ...data };
      },
      create: async () => {
        throw new Error("existing finds should be updated, not created");
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(twoFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.deepEqual(
    updates.map((update) => [update.id, update.foundAt.toISOString(), update.logText]),
    [
      ["find-1", "2024-05-01T10:34:00.000Z", "Nice find."],
      ["find-2", "2024-05-02T10:34:00.000Z", "Second find."]
    ]
  );
});

test("process pairs same-cache re-import fallbacks in chronological order when GPX entries are reversed", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFinds = [
    {
      id: "find-1",
      userId: "user-1",
      cacheId: "cache-1",
      importId: "old-import",
      foundAt: new Date("2024-05-01T12:34:00.000Z"),
      logText: "First old log.",
      isFtf: false,
      isFtfManual: false,
      importedFrom: ImportSource.MY_FINDS_GPX,
      createdAt: new Date("2024-05-01T12:34:00.000Z"),
      updatedAt: new Date("2024-05-01T12:34:00.000Z")
    },
    {
      id: "find-2",
      userId: "user-1",
      cacheId: "cache-1",
      importId: "old-import",
      foundAt: new Date("2024-05-02T12:34:00.000Z"),
      logText: "Second old log.",
      isFtf: false,
      isFtfManual: false,
      importedFrom: ImportSource.MY_FINDS_GPX,
      createdAt: new Date("2024-05-02T12:34:00.000Z"),
      updatedAt: new Date("2024-05-02T12:34:00.000Z")
    }
  ];
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  const updates: Array<{ id: string; foundAt: Date; logText: string | null | undefined }> = [];
  const firstWaypoint = myFindsGpx.match(/  <wpt[\s\S]*?  <\/wpt>/)?.[0] ?? "";
  const secondWaypoint = firstWaypoint.replace("2024-05-01T12:34:00Z", "2024-05-02T12:34:00Z").replace("Nice find.", "Second find.");
  const reversedFindsGpx = myFindsGpx.replace(firstWaypoint, `${secondWaypoint}\n${firstWaypoint}`);

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => existingFinds,
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, foundAt: data.foundAt, logText: data.logText });
        return { ...existingFinds.find((find) => find.id === where.id), ...data };
      },
      create: async () => {
        throw new Error("existing finds should be updated, not created");
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(reversedFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.deepEqual(
    updates.map((update) => [update.id, update.foundAt.toISOString(), update.logText]),
    [
      ["find-1", "2024-05-01T10:34:00.000Z", "Nice find."],
      ["find-2", "2024-05-02T10:34:00.000Z", "Second find."]
    ]
  );
});

test("process clears an auto-detected FTF mark when re-imported log text no longer matches", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFind = {
    id: "find-1",
    userId: "user-1",
    cacheId: "cache-1",
    importId: "old-import",
    foundAt: new Date("2024-05-01T10:34:00.000Z"),
    logText: "FTF",
    isFtf: true,
    isFtfManual: false,
    importedFrom: ImportSource.MY_FINDS_GPX,
    createdAt: new Date("2024-05-01T10:34:00.000Z"),
    updatedAt: new Date("2024-05-01T10:34:00.000Z")
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let updatedData: any;
  let recalculationFindsLoaded = false;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [existingFind],
      update: async ({ data }: any) => {
        updatedData = data;
        return { ...existingFind, ...data };
      },
      create: async () => {
        throw new Error("existing find should be updated, not created");
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => {
        recalculationFindsLoaded = true;
        return [];
      }
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(myFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(updatedData?.isFtf, false);
  assert.equal(recalculationFindsLoaded, true);
});

test("process creates multiple same-cache finds when no existing row matches the second timestamp", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  const createdFinds: any[] = [];
  const firstWaypoint = myFindsGpx.match(/  <wpt[\s\S]*?  <\/wpt>/)?.[0] ?? "";
  const twoFindsGpx = myFindsGpx.replace(
    "</gpx>",
    `${firstWaypoint.replace("2024-05-01T12:34:00Z", "2024-05-02T12:34:00Z").replace("Nice find.", "Second find.")}\n</gpx>`
  );

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new same-cache finds should not update a row created earlier in the import");
      },
      create: async ({ data }: any) => {
        const created = {
          id: `find-${createdFinds.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        createdFinds.push(created);
        return created;
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(twoFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.deepEqual(
    createdFinds.map((find) => [find.id, find.foundAt.toISOString(), find.logText]),
    [
      ["find-1", "2024-05-01T10:34:00.000Z", "Nice find."],
      ["find-2", "2024-05-02T10:34:00.000Z", "Second find."]
    ]
  );
});

test("process skips stats recalculation when an import has no new or changed finds", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFind = {
    id: "find-1",
    userId: "user-1",
    cacheId: "cache-1",
    importId: "import-1",
    foundAt: new Date("2024-05-01T10:34:00.000Z"),
    foundDate: new Date("2024-05-01T00:00:00.000Z"),
    logText: "Nice find.",
    isFtf: false,
    importedFrom: ImportSource.MY_FINDS_GPX,
    createdAt: new Date("2024-05-01T10:34:00.000Z"),
    updatedAt: new Date("2024-05-01T10:34:00.000Z")
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let findUpdated = false;
  let findCreated = false;
  let recalculationFindsLoaded = false;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [existingFind],
      update: async () => {
        findUpdated = true;
        return existingFind;
      },
      create: async () => {
        findCreated = true;
        return existingFind;
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => {
        recalculationFindsLoaded = true;
        return [];
      }
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(myFindsGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(findUpdated, false);
  assert.equal(findCreated, false);
  assert.equal(recalculationFindsLoaded, false);
});

test("process uses an explicit FTF time near the FTF term when the GPX timestamp is generic", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let createdFoundAt: Date | undefined;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new find should be created");
      },
      create: async ({ data }: any) => {
        createdFoundAt = data.foundAt;
        return {
          id: "find-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(ftfLogTimeGpx.replace("FTF\nTime 08:11", "FTF\n\nJoint find with friends\nTime 08:11"))
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(createdFoundAt?.toISOString(), "2026-05-03T06:11:00.000Z");
});

test("process uses an explicit FTF time next to a custom detection term", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let createdFind: any;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new find should be created");
      },
      create: async ({ data }: any) => {
        createdFind = data;
        return {
          id: "find-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["silver medal"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(ftfLogTimeGpx.replace("FTF\nTime 08:11", "silver medal\nTime 08:11"))
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(createdFind?.isFtf, true);
  assert.equal(createdFind?.foundAt.toISOString(), "2026-05-03T06:11:00.000Z");
});

test("process keeps the GPX wall-clock date when applying a late-evening FTF log time", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let createdFoundAt: Date | undefined;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new find should be created");
      },
      create: async ({ data }: any) => {
        createdFoundAt = data.foundAt;
        return {
          id: "find-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () =>
      Buffer.from(ftfLogTimeGpx.replace("2026-05-03T19:00:00Z", "2024-06-01T22:30:00Z").replace("Time 08:11", "Time 22:30"))
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(createdFoundAt?.toISOString(), "2024-06-01T20:30:00.000Z");
});

test("process ignores incidental time mentions in FTF log text", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let createdFoundAt: Date | undefined;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new find should be created");
      },
      create: async ({ data }: any) => {
        createdFoundAt = data.foundAt;
        return {
          id: "find-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => null
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () =>
      Buffer.from(ftfLogTimeGpx.replace("FTF\nTime 08:11", "FTF! Spent some time here - 10:30 was a gorgeous morning"))
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(createdFoundAt?.toISOString(), "2026-05-03T17:00:00.000Z");
});

test("process interprets GPX find timestamps in the profile time zone", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let createdFoundAt: Date | undefined;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [],
      update: async () => {
        throw new Error("new find should be created");
      },
      create: async ({ data }: any) => {
        createdFoundAt = data.foundAt;
        return {
          id: "find-1",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => []
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () =>
      Buffer.from(myFindsGpx.replace("2024-05-01T12:34:00Z", "2026-02-01T00:53:53Z"))
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(createdFoundAt?.toISOString(), "2026-01-31T23:53:53.000Z");
});

test("process preserves a manually cleared FTF mark during re-import", async () => {
  const existingCache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Found Cache",
    cacheType: "Traditional Cache",
    difficulty: 2,
    terrain: 1.5,
    size: "Regular",
    latitude: 56.1612,
    longitude: 15.5869,
    country: null,
    region: null,
    county: null,
    hiddenDate: null,
    ownerName: null,
    raw: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const existingFind = {
    id: "find-1",
    userId: "user-1",
    cacheId: "cache-1",
    importId: "old-import",
    foundAt: new Date("2026-05-03T06:11:00.000Z"),
    foundDate: new Date("2026-05-03T00:00:00.000Z"),
    logText: null,
    isFtf: false,
    isFtfManual: true,
    importedFrom: ImportSource.MY_FINDS_GPX,
    createdAt: new Date("2026-05-03T06:11:00.000Z"),
    updatedAt: new Date("2026-05-03T06:11:00.000Z")
  };
  const importRecord = {
    id: "import-1",
    userId: "user-1",
    fileName: "my-finds.gpx",
    fileType: ImportFileType.GPX,
    source: ImportSource.MY_FINDS_GPX,
    objectKey: "user-1/original.gpx"
  };
  let updatedData: any;
  let recalculationFindsLoaded = false;

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      findMany: async () => [existingFind],
      update: async ({ data }: any) => {
        updatedData = data;
        return { ...existingFind, ...data };
      },
      create: async () => {
        throw new Error("existing find should be updated, not created");
      }
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async () => ({})
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => ({ ftfDetectionTerms: ["FTF"], timeZone: "Europe/Stockholm" })
    },
    find: {
      findMany: async () => {
        recalculationFindsLoaded = true;
        return [];
      }
    },
    hide: {
      findMany: async () => []
    },
    ownerFinderCountryStat: {
      findMany: async () => []
    },
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(ftfLogTimeGpx)
  };

  const processor = new ImportProcessor(withUserCacheData(prisma) as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.equal(updatedData?.isFtf, undefined);
  assert.equal(recalculationFindsLoaded, false);
});
