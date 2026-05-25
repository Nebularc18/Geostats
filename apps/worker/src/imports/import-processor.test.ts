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

test("process uses database object metadata and does not overwrite existing shared cache rows", async () => {
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
  const cacheCreates: unknown[] = [];
  const cacheFinds: string[] = [];

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
      findUnique: async ({ where }: any) => {
        cacheFinds.push(where.gcCode);
        return existingCache;
      },
      create: async (input: unknown) => {
        cacheCreates.push(input);
        return existingCache;
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
  assert.deepEqual(cacheFinds, ["GC12345"]);
  assert.equal(cacheCreates.length, 0);
});

test("process recovers from concurrent cache creation before the import transaction", async () => {
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
  let findUniqueCalls = 0;
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
      findUnique: async () => {
        findUniqueCalls += 1;
        return findUniqueCalls === 1 ? null : createdCache;
      },
      create: async () => {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test"
        });
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

  assert.equal(findUniqueCalls, 2);
  assert.equal(importTransactionStarted, true);
});
