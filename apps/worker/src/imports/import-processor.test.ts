import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@geostats/db";
import { ImportFileType, ImportSource, ImportStatus } from "@geostats/shared";
import { ImportProcessor } from "./import-processor";

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

test("process uses database object metadata and updates existing shared cache rows", async () => {
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
  const updatedCache = {
    ...existingCache,
    name: "Attacker Cache Name"
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
      upsert: async (input: any) => {
        cacheUpserts.push(input);
        return updatedCache;
      }
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
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async (key: string) => {
      seenObjectKeys.push(key);
      return Buffer.from(gpx);
    }
  };

  const processor = new ImportProcessor(prisma as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/tampered.gpx",
    source: ImportSource.MY_FINDS_GPX
  });

  assert.deepEqual(seenObjectKeys, ["user-1/original.gpx"]);
  assert.equal(cacheUpserts.length, 1);
  assert.deepEqual(cacheUpserts[0].where, { gcCode: "GC12345" });
  assert.equal(cacheUpserts[0].create.name, "Attacker Cache Name");
  assert.equal(cacheUpserts[0].update.name, "Attacker Cache Name");
});

test("process recovers from concurrent cache upsert conflict before the import transaction", async () => {
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
  let cacheUpdateCalls = 0;
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
      update: async () => {
        cacheUpdateCalls += 1;
        return createdCache;
      }
    },
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
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  const processor = new ImportProcessor(prisma as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_HIDES_GPX
  });

  assert.equal(cacheUpsertCalls, 1);
  assert.equal(cacheUpdateCalls, 1);
  assert.equal(importTransactionStarted, true);
});

test("process updates existing cache metadata before the import transaction", async () => {
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
  const updatedCache = {
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
  let cacheUpdateCompleted = false;

  const tx = {
    hide: {
      upsert: async () => {
        assert.equal(cacheUpdateCompleted, true);
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
      upsert: async ({ update }: any) => {
        assert.equal(update.name, "Attacker Cache Name");
        assert.equal(update.latitude, 56.1612);
        assert.equal(update.longitude, 15.5869);
        cacheUpdateCompleted = true;
        return updatedCache;
      }
    },
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
    statSnapshot: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => ({})
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  const processor = new ImportProcessor(prisma as any, storage as any);
  await processor.process({
    importId: "import-1",
    userId: "user-1",
    objectKey: "user-1/original.gpx",
    source: ImportSource.MY_HIDES_GPX
  });

  assert.equal(cacheUpdateCompleted, true);
  assert.equal(importTransactionStarted, true);
});

test("process keeps a committed import completed when stats recalculation fails", async () => {
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
  const originalError = console.error;
  console.error = () => {};

  const tx = {
    hide: {
      upsert: async () => ({})
    },
    find: {
      upsert: async () => ({})
    }
  };
  const prisma = {
    import: {
      findFirst: async () => importRecord,
      update: async ({ data }: any) => {
        importStatuses.push(data.status);
        return {};
      }
    },
    cache: {
      upsert: async () => existingCache
    },
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    geocachingProfile: {
      findUnique: async () => {
        throw new Error("stats timeout");
      }
    }
  };
  const storage = {
    getObject: async () => Buffer.from(gpx)
  };

  try {
    const processor = new ImportProcessor(prisma as any, storage as any);
    await processor.process({
      importId: "import-1",
      userId: "user-1",
      objectKey: "user-1/original.gpx",
      source: ImportSource.MY_HIDES_GPX
    });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(importStatuses, [ImportStatus.PROCESSING, ImportStatus.COMPLETED]);
});
