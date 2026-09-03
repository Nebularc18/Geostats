import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { AdminService } from "./admin.service";

function serviceWith(prisma: any) {
  return new AdminService(prisma, {} as any, {} as any, {} as any, {} as any);
}

test("missingCaches merges unresolved references and excludes indexed caches", async () => {
  const prisma = {
    trackableLog: {
      findMany: async () => [
        {
          id: "log-1",
          userId: "user-1",
          gcCode: "gcorph",
          cacheName: "A journey cache",
          locationName: "Karlskrona",
          latitude: 56.16,
          longitude: 15.59,
          loggedAt: new Date("2026-08-20T00:00:00.000Z"),
        },
      ],
    },
    mysteryWorkspace: {
      findMany: async () => [
        {
          ownerId: "user-2",
          gcCode: "GCORPH",
          data: {
            name: "A mystery cache",
            publishedLatitude: 59.3,
            publishedLongitude: 18.1,
            country: "Sweden",
          },
          updatedAt: new Date("2026-08-21T00:00:00.000Z"),
        },
        {
          ownerId: "user-2",
          gcCode: "GCPRESENT",
          data: { name: "Already indexed" },
          updatedAt: new Date("2026-08-21T00:00:00.000Z"),
        },
      ],
    },
    challengeChecker: {
      findMany: async () => [
        {
          userId: "user-3",
          gcCode: "GCCHALLENGE",
          name: "A challenge cache",
          updatedAt: new Date("2026-08-22T00:00:00.000Z"),
        },
      ],
    },
    cache: {
      findMany: async () => [{ gcCode: "GCPRESENT" }],
    },
  };

  const result = await serviceWith(prisma).missingCaches();

  assert.equal(result.total, 2);
  assert.deepEqual(
    result.caches.map((candidate) => candidate.gcCode),
    ["GCCHALLENGE", "GCORPH"],
  );
  assert.deepEqual(result.caches[1], {
    gcCode: "GCORPH",
    referenceCount: 2,
    users: 2,
    sources: {
      trackableLogs: 1,
      mysteryWorkspaces: 1,
      challengeCheckers: 0,
    },
    name: "A journey cache",
    location: "Karlskrona",
    latitude: 56.16,
    longitude: 15.59,
    country: "Sweden",
    region: null,
    county: null,
    lastSeenAt: "2026-08-21T00:00:00.000Z",
  });
});

test("addCache validates metadata, creates the cache, and links orphaned trackable logs", async () => {
  let createInput: any;
  let updateInput: any;
  let activityInput: any;
  const tx = {
    cache: {
      create: async ({ data }: any) => {
        createInput = data;
        return { id: "cache-new", ...data };
      },
    },
    trackableLog: {
      updateMany: async (input: any) => {
        updateInput = input;
        return { count: 3 };
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (client: any) => Promise<unknown>) =>
      callback(tx),
    adminActivityLog: {
      create: async (input: any) => {
        activityInput = input;
        return input;
      },
    },
  };

  const result = await serviceWith(prisma).addCache(
    {
      gcCode: " gcnew1 ",
      name: "New cache",
      latitude: "56.1612",
      longitude: 15.5869,
      cacheType: "Traditional Cache",
      difficulty: "2",
      terrain: 2.5,
      size: "Regular",
      country: "Sweden",
      hiddenDate: "2026-08-01",
    },
    { id: "admin-1" } as any,
  );

  assert.equal(createInput.gcCode, "GCNEW1");
  assert.equal(createInput.latitude, 56.1612);
  assert.equal(
    createInput.hiddenDate.toISOString(),
    "2026-08-01T00:00:00.000Z",
  );
  assert.deepEqual(updateInput.where, {
    cacheId: null,
    gcCode: { equals: "GCNEW1", mode: "insensitive" },
  });
  assert.equal(updateInput.data.cacheId, "cache-new");
  assert.deepEqual(result.cache, {
    id: "cache-new",
    gcCode: "GCNEW1",
    name: "New cache",
    latitude: 56.1612,
    longitude: 15.5869,
  });
  assert.equal(result.linkedTrackableLogs, 3);
  assert.deepEqual(activityInput.data, {
    adminId: "admin-1",
    action: "CACHE_ADDED",
    targetType: "cache",
    targetId: "GCNEW1",
    details: { linkedTrackableLogs: 3 },
  });

  await assert.rejects(
    () =>
      serviceWith(prisma).addCache({
        gcCode: "GCNEW2",
        name: "Missing coordinates",
      }),
    BadRequestException,
  );
});

test("caches searches shared metadata and paginates results", async () => {
  let countInput: any;
  let findInput: any;
  const prisma = {
    cache: {
      count: async (input: any) => {
        countInput = input;
        return 3;
      },
      findMany: async (input: any) => {
        findInput = input;
        return [
          {
            id: "cache-1",
            gcCode: "GC123",
            name: "Stockholm cache",
            cacheType: "Traditional Cache",
            difficulty: 2,
            terrain: 2.5,
            size: "Regular",
            latitude: "59.3293",
            longitude: "18.0686",
            country: "Sweden",
            region: "Stockholm",
            county: null,
            ownerName: "Owner",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            updatedAt: new Date("2026-08-02T00:00:00.000Z"),
            _count: { finds: 4, hides: 1, trackableLogs: 2 },
          },
        ];
      },
    },
  };

  const result = await serviceWith(prisma).caches(" Stockholm ", "2", "2");

  assert.equal(countInput.where.OR[0].gcCode.contains, "Stockholm");
  assert.deepEqual(findInput.where, countInput.where);
  assert.equal(findInput.skip, 2);
  assert.equal(findInput.take, 2);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.pagination.total, 3);
  assert.equal(result.pagination.pageCount, 2);
  assert.equal(result.caches[0].latitude, 59.3293);
  assert.equal(result.caches[0].longitude, 18.0686);
});

test("imports filters by status and caps page size", async () => {
  let countInput: any;
  let findInput: any;
  const prisma = {
    import: {
      count: async (input: any) => {
        countInput = input;
        return 51;
      },
      findMany: async (input: any) => {
        findInput = input;
        return [];
      },
    },
  };

  const result = await serviceWith(prisma).imports(" failed ", "2", "100");

  assert.deepEqual(countInput.where, { status: "FAILED" });
  assert.deepEqual(findInput.where, { status: "FAILED" });
  assert.equal(findInput.skip, 50);
  assert.equal(findInput.take, 50);
  assert.equal(result.filter, "FAILED");
  assert.equal(result.pagination.pageSize, 50);
  assert.equal(result.pagination.pageCount, 2);

  await assert.rejects(
    () => serviceWith(prisma).imports("not-a-status"),
    BadRequestException,
  );
});

test("activity returns newest admin actions with pagination", async () => {
  let findInput: any;
  const prisma = {
    adminActivityLog: {
      count: async () => 13,
      findMany: async (input: any) => {
        findInput = input;
        return [
          {
            id: "activity-1",
            action: "CACHE_ADDED",
            targetType: "cache",
            targetId: "GC123",
            details: { linkedTrackableLogs: 2 },
            createdAt: new Date("2026-08-02T00:00:00.000Z"),
            admin: { username: "admin" },
          },
        ];
      },
    },
  };

  const result = await serviceWith(prisma).activity("2", "5");

  assert.deepEqual(findInput.orderBy, { createdAt: "desc" });
  assert.equal(findInput.skip, 5);
  assert.equal(findInput.take, 5);
  assert.equal(result.pagination.total, 13);
  assert.equal(result.pagination.pageCount, 3);
  assert.equal(result.activities[0].admin.username, "admin");
});

test("retryImport records the operator after requeueing a failed import", async () => {
  let enqueued: any;
  const updateManyInputs: any[] = [];
  let activityInput: any;
  const prisma = {
    import: {
      findUnique: async () => ({
        id: "import-1",
        userId: "user-1",
        objectKey: "imports/import-1.gpx",
        source: "GSAK",
        status: "FAILED",
        fileName: "export.gpx",
      }),
      updateMany: async (input: any) => {
        updateManyInputs.push(input);
        return { count: 1 };
      },
    },
    adminActivityLog: {
      create: async (input: any) => {
        activityInput = input;
        return input;
      },
    },
  };
  const queue = {
    enqueue: async (input: any) => {
      enqueued = input;
    },
  };
  const service = new AdminService(
    prisma as any,
    {} as any,
    queue as any,
    {} as any,
    {} as any,
  );

  await service.retryImport("import-1", { id: "admin-1" } as any);

  assert.deepEqual(updateManyInputs, [
    {
      where: { id: "import-1", status: "FAILED" },
      data: { status: "QUEUED", errorMessage: null },
    },
  ]);
  assert.deepEqual(enqueued, {
    importId: "import-1",
    userId: "user-1",
    objectKey: "imports/import-1.gpx",
    source: "GSAK",
  });
  assert.deepEqual(activityInput.data, {
    adminId: "admin-1",
    action: "IMPORT_RETRIED",
    targetType: "import",
    targetId: "import-1",
    details: { fileName: "export.gpx", source: "GSAK" },
  });
});

test("retryImport keeps a claimed import queued when queueing fails", async () => {
  const updateManyInputs: any[] = [];
  const prisma = {
    import: {
      findUnique: async () => ({
        id: "import-1",
        userId: "user-1",
        objectKey: "imports/import-1.gpx",
        source: "GSAK",
        status: "FAILED",
        fileName: "export.gpx",
      }),
      updateMany: async (input: any) => {
        updateManyInputs.push(input);
        return { count: 1 };
      },
    },
  };
  const queue = {
    enqueue: async () => {
      throw new Error("Redis offline");
    },
  };

  const service = new AdminService(
    prisma as any,
    {} as any,
    queue as any,
    {} as any,
    {} as any,
  );
  await assert.rejects(() => service.retryImport("import-1"), /Redis offline/);
  assert.deepEqual(updateManyInputs, [
    {
      where: { id: "import-1", status: "FAILED" },
      data: { status: "QUEUED", errorMessage: null },
    },
  ]);
});

test("retryImport lets only one concurrent request claim a failed import", async () => {
  let claimAttempts = 0;
  let enqueueCalls = 0;
  const prisma = {
    import: {
      findUnique: async () => ({
        id: "import-1",
        userId: "user-1",
        objectKey: "imports/import-1.gpx",
        source: "GSAK",
        status: "FAILED",
        fileName: "export.gpx",
      }),
      updateMany: async () => ({ count: ++claimAttempts === 1 ? 1 : 0 }),
    },
  };
  const queue = {
    enqueue: async () => {
      enqueueCalls += 1;
    },
  };
  const service = new AdminService(
    prisma as any,
    {} as any,
    queue as any,
    {} as any,
    {} as any,
  );

  const results = await Promise.allSettled([
    service.retryImport("import-1"),
    service.retryImport("import-1"),
  ]);

  assert.equal(enqueueCalls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.reason instanceof BadRequestException);
});
