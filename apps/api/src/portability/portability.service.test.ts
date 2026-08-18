import assert from "node:assert/strict";
import test from "node:test";
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastValueFrom, of, Subject, throwError } from "rxjs";
import {
  parsePortableArchive,
  PortabilityService,
} from "./portability.service";
import {
  portabilityMaxBytes,
  PortabilityController,
} from "./portability.controller";
import {
  PortabilityUploadAdmissionInterceptor,
  preparePortabilityTempRoot,
} from "./portability-upload.interceptor";

const user = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
};

function archive(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      format: "geostats-portable-data",
      version: 1,
      exportedAt: "2026-08-12T00:00:00.000Z",
      account: {
        username: "alice",
        email: "alice@example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      data: {
        profile: null,
        caches: [],
        finds: [],
        hides: [],
        correctedCoordinates: [],
        ownerFinderCountryStats: [],
        statSnapshots: [],
        mysteryWorkspaces: [],
      },
      ...overrides,
    }),
  );
}

test("portable parser accepts the current documented format", () => {
  const parsed = parsePortableArchive(archive());
  assert.equal(parsed.format, "geostats-portable-data");
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.data.finds, []);
});

test("portable parser rejects files from an unknown format", () => {
  assert.throws(
    () => parsePortableArchive(archive({ format: "some-other-app" })),
    BadRequestException,
  );
});

test("portable parser rejects future versions instead of partially importing them", () => {
  assert.throws(
    () => parsePortableArchive(archive({ version: 2 })),
    /Unsupported Geostats export version/,
  );
});

test("portable parser rejects malformed JSON", () => {
  assert.throws(
    () => parsePortableArchive(Buffer.from("not json")),
    /not valid JSON/,
  );
});

function archiveWithCache(gcCode = "GCPOISON") {
  return archive({
    data: {
      profile: null,
      caches: [
        {
          gcCode,
          name: "Archive controlled name",
          cacheType: "Traditional Cache",
          difficulty: 1,
          terrain: 1,
          size: "Micro",
          latitude: 0,
          longitude: 0,
          country: "Nowhere",
          region: "Poisoned",
          county: null,
          hiddenDate: null,
          ownerName: "Attacker",
          raw: { attackerControlled: true },
        },
      ],
      finds: [],
      hides: [],
      correctedCoordinates: [],
      ownerFinderCountryStats: [],
      statSnapshots: [],
      mysteryWorkspaces: [],
    },
  });
}

function importTransaction(
  storedCaches: Array<{ id: string; gcCode: string }>,
  cacheWrites: any[] = [],
  importWrites: any[] = [],
) {
  return {
    geocachingProfile: { upsert: async () => undefined },
    cache: {
      createMany: async (input: any) => {
        cacheWrites.push(input);
      },
      findMany: async (input: any) => {
        assert.equal(input.where.userId, user.id);
        return storedCaches;
      },
    },
    find: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    hide: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    correctedCoordinate: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    ownerFinderCountryStat: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    statSnapshot: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    mysteryWorkspace: { upsert: async () => undefined },
    mysteryWorkspaceDeletion: { deleteMany: async () => undefined },
    import: {
      create: async (input: any) => {
        importWrites.push(input);
      },
    },
  };
}

test("import creates archive cache metadata only inside the authenticated user's scope", async () => {
  const cacheWrites: any[] = [];
  const tx = importTransaction(
    [{ id: "user-cache-1", gcCode: "GCPOISON" }],
    cacheWrites,
  );
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
  };
  const service = new PortabilityService(prisma as any, {} as any);

  await service.importData(user, archiveWithCache());

  assert.equal(cacheWrites.length, 1);
  assert.equal(cacheWrites[0].data[0].userId, user.id);
  assert.equal(cacheWrites[0].data[0].gcCode, "GCPOISON");
});

test("import can attach portable records to cache metadata already owned by the user", async () => {
  const importWrites: any[] = [];
  const tx = importTransaction([
    { id: "trusted-cache-1", gcCode: "GCTRUSTED" },
  ], [], importWrites);
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
  };
  const service = new PortabilityService(prisma as any, {} as any);

  assert.deepEqual(
    await service.importData(user, archiveWithCache("GCTRUSTED"), "old-server.json"),
    {
      imported: {
        caches: 1,
        finds: 0,
        hides: 0,
        correctedCoordinates: 0,
        mysteryWorkspaces: 0,
      },
    },
  );
  assert.equal(importWrites.length, 1);
  assert.deepEqual(
    {
      fileName: importWrites[0].data.fileName,
      fileType: importWrites[0].data.fileType,
      source: importWrites[0].data.source,
      status: importWrites[0].data.status,
    },
    {
      fileName: "old-server.json",
      fileType: "JSON",
      source: "GEOSTATS_EXPORT",
      status: "COMPLETED",
    },
  );
});

test("archive limits are hard-clamped and imports are serialized per API process", async () => {
  const previousLimit = process.env.PORTABILITY_MAX_BYTES;
  process.env.PORTABILITY_MAX_BYTES = String(250 * 1024 * 1024);
  assert.equal(portabilityMaxBytes(), 50 * 1024 * 1024);
  if (previousLimit === undefined) delete process.env.PORTABILITY_MAX_BYTES;
  else process.env.PORTABILITY_MAX_BYTES = previousLimit;

  const directory = await mkdtemp(join(tmpdir(), "geostats-portability-test-"));
  const path = join(directory, "archive.json");
  await writeFile(path, archive());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = new PortabilityService({} as any, {} as any);
  (service as any).importData = async () => {
    await gate;
    return { imported: {} };
  };
  try {
    const first = service.importFile(user, path);
    await assert.rejects(service.importFile(user, path), /already in progress/);
    release();
    await first;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("portability uploads are rejected before a concurrent upload can start", async () => {
  const interceptor = new PortabilityUploadAdmissionInterceptor();
  const firstUpload = new Subject<string>();
  const firstResult = lastValueFrom(
    interceptor.intercept({} as any, {
      handle: () => firstUpload,
    }),
  );
  let rejectedUploadStarted = false;

  assert.throws(
    () =>
      interceptor.intercept({} as any, {
        handle: () => {
          rejectedUploadStarted = true;
          return of("should not run");
        },
      }),
    ServiceUnavailableException,
  );
  assert.equal(rejectedUploadStarted, false);

  firstUpload.next("imported");
  firstUpload.complete();
  assert.equal(await firstResult, "imported");
  assert.equal(
    await lastValueFrom(
      interceptor.intercept({} as any, { handle: () => of("next upload") }),
    ),
    "next upload",
  );
});

test("portability upload artifacts are removed when an inner interceptor fails", async () => {
  const interceptor = new PortabilityUploadAdmissionInterceptor();
  const directory = await preparePortabilityTempRoot();
  await writeFile(join(directory, "partial-upload.json"), archive());

  await assert.rejects(
    lastValueFrom(
      interceptor.intercept({} as any, {
        handle: () => throwError(() => new Error("upload rejected")),
      }),
    ),
    /upload rejected/,
  );
  await assert.rejects(access(directory), /ENOENT/);
  assert.equal(
    await lastValueFrom(
      interceptor.intercept({} as any, {
        handle: () => of("upload after rejection"),
      }),
    ),
    "upload after rejection",
  );
});

test("portability uploads remain available when temporary cleanup fails", async () => {
  class CleanupFailureInterceptor extends PortabilityUploadAdmissionInterceptor {
    protected override cleanupTempRoot() {
      return Promise.reject(new Error("temporary filesystem error"));
    }
  }

  const interceptor = new CleanupFailureInterceptor();
  (interceptor as any).logger.error = () => undefined;

  assert.equal(
    await lastValueFrom(
      interceptor.intercept({} as any, { handle: () => of("first upload") }),
    ),
    "first upload",
  );
  assert.equal(
    await lastValueFrom(
      interceptor.intercept({} as any, { handle: () => of("next upload") }),
    ),
    "next upload",
  );
});

test("controller removes a spooled archive even when import fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "geostats-portability-test-"));
  const path = join(directory, "archive.json");
  await writeFile(path, archive());
  const controller = new PortabilityController({
    importFile: async () => {
      throw new BadRequestException("invalid archive");
    },
  } as any);
  try {
    await assert.rejects(
      controller.importData(user, { path } as Express.Multer.File),
      /invalid archive/,
    );
    await assert.rejects(readFile(path), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("export includes every portable user data category and excludes server secrets", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const foundAt = new Date("2026-02-03T12:30:00.000Z");
  const foundDate = new Date("2026-02-03T00:00:00.000Z");
  const placedAt = new Date("2025-05-06T00:00:00.000Z");
  const generatedAt = new Date("2026-08-01T08:00:00.000Z");
  const workspaceUpdatedAt = new Date("2026-08-02T09:00:00.000Z");
  const cache = {
    id: "cache-1",
    gcCode: "GC12345",
    name: "Forest puzzle",
    cacheType: "Mystery Cache",
    difficulty: 4.5,
    terrain: 2.5,
    size: "Regular",
    latitude: 57.123456,
    longitude: 14.654321,
    country: "Sweden",
    region: "Jönköping",
    county: "Jönköping",
    hiddenDate: placedAt,
    ownerName: "CacheOwner",
    raw: { groundspeak: { favoritePoints: 17 } },
    createdAt,
    updatedAt: createdAt,
  };
  const secondCache = {
    ...cache,
    id: "cache-2",
    gcCode: "GC99999",
    name: "Corrected cache",
  };
  const prisma = {
    user: {
      findUniqueOrThrow: async () => ({
        ...user,
        createdAt,
        passwordHash: "must-not-export-password-hash",
      }),
    },
    geocachingProfile: {
      findUnique: async () => ({
        id: "profile-1",
        userId: user.id,
        gcUsername: "AliceGC",
        homeLatitude: 57.7,
        homeLongitude: 14.2,
        timeZone: "Europe/Stockholm",
        ftfDetectionTerms: ["FTF", "first to find"],
        createdAt,
        updatedAt: createdAt,
      }),
    },
    find: {
      findMany: async () => [
        {
          id: "find-1",
          userId: user.id,
          cacheId: cache.id,
          importId: "import-1",
          foundAt,
          foundDate,
          logText: "Found after solving the cipher",
          isFtf: true,
          isFtfManual: true,
          importedFrom: "MY_FINDS_GPX",
          createdAt,
          updatedAt: createdAt,
          cache,
        },
      ],
    },
    hide: {
      findMany: async () => [
        {
          id: "hide-1",
          userId: user.id,
          cacheId: cache.id,
          importId: "import-2",
          placedAt,
          receivedLogCount: 2,
          receivedLogsRaw: { logs: [{ finder: "Bob", text: "TFTC" }] },
          createdAt,
          updatedAt: createdAt,
          cache,
        },
      ],
    },
    correctedCoordinate: {
      findMany: async () => [
        {
          id: "coordinate-1",
          userId: user.id,
          cacheId: secondCache.id,
          latitude: 57.765432,
          longitude: 14.234567,
          note: "Final coordinates",
          createdAt,
          updatedAt: createdAt,
          cache: secondCache,
        },
      ],
    },
    ownerFinderCountryStat: {
      findMany: async () => [
        { id: "country-1", userId: user.id, country: "Sweden", count: 12 },
      ],
    },
    statSnapshot: {
      findMany: async () => [
        {
          id: "snapshot-1",
          userId: user.id,
          statsJson: { finds: 42 },
          generatedAt,
        },
      ],
    },
    mysteryWorkspace: {
      findMany: async () => [
        {
          id: "workspace-1",
          ownerId: user.id,
          clientId: "local-mystery-1",
          gcCode: "GC12345",
          data: {
            id: "local-mystery-1",
            gcCode: "GC12345",
            name: "Forest puzzle",
            notes: "Try ROT13",
          },
          snapshotRevision: 7,
          createdAt,
          updatedAt: workspaceUpdatedAt,
          shares: [{ recipientId: "recipient-secret" }],
        },
      ],
    },
  };
  const service = new PortabilityService(prisma as any, {} as any);

  const exported = await service.exportData(user);

  assert.deepEqual(exported.account, {
    username: "alice",
    email: "alice@example.com",
    createdAt: createdAt.toISOString(),
  });
  assert.deepEqual(exported.data.profile, {
    gcUsername: "AliceGC",
    homeLatitude: 57.7,
    homeLongitude: 14.2,
    timeZone: "Europe/Stockholm",
    ftfDetectionTerms: ["FTF", "first to find"],
  });
  assert.deepEqual(exported.data.caches, [
    {
      gcCode: "GC12345",
      name: "Forest puzzle",
      cacheType: "Mystery Cache",
      difficulty: 4.5,
      terrain: 2.5,
      size: "Regular",
      latitude: 57.123456,
      longitude: 14.654321,
      country: "Sweden",
      region: "Jönköping",
      county: "Jönköping",
      hiddenDate: placedAt,
      ownerName: "CacheOwner",
      raw: { groundspeak: { favoritePoints: 17 } },
    },
    {
      gcCode: "GC99999",
      name: "Corrected cache",
      cacheType: "Mystery Cache",
      difficulty: 4.5,
      terrain: 2.5,
      size: "Regular",
      latitude: 57.123456,
      longitude: 14.654321,
      country: "Sweden",
      region: "Jönköping",
      county: "Jönköping",
      hiddenDate: placedAt,
      ownerName: "CacheOwner",
      raw: { groundspeak: { favoritePoints: 17 } },
    },
  ]);
  assert.deepEqual(exported.data.finds, [
    {
      gcCode: "GC12345",
      foundAt,
      foundDate,
      logText: "Found after solving the cipher",
      isFtf: true,
      isFtfManual: true,
      importedFrom: "MY_FINDS_GPX",
    },
  ]);
  assert.deepEqual(exported.data.hides, [
    {
      gcCode: "GC12345",
      placedAt,
      receivedLogCount: 2,
      receivedLogsRaw: { logs: [{ finder: "Bob", text: "TFTC" }] },
    },
  ]);
  assert.deepEqual(exported.data.correctedCoordinates, [
    {
      gcCode: "GC99999",
      latitude: 57.765432,
      longitude: 14.234567,
      note: "Final coordinates",
    },
  ]);
  assert.deepEqual(exported.data.ownerFinderCountryStats, [
    { country: "Sweden", count: 12 },
  ]);
  assert.deepEqual(exported.data.statSnapshots, [
    { statsJson: { finds: 42 }, generatedAt },
  ]);
  assert.deepEqual(exported.data.mysteryWorkspaces, [
    {
      clientId: "local-mystery-1",
      gcCode: "GC12345",
      data: {
        id: "local-mystery-1",
        gcCode: "GC12345",
        name: "Forest puzzle",
        notes: "Try ROT13",
      },
      snapshotRevision: 7,
      createdAt,
      updatedAt: workspaceUpdatedAt,
    },
  ]);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes("must-not-export-password-hash"), false);
  assert.equal(serialized.includes("recipient-secret"), false);
  assert.equal(serialized.includes("import-1"), false);
});

test("account deletion commits a durable object-cleanup outbox before touching storage", async () => {
  const deletedObjects: string[] = [];
  const operations: Array<{ operation: string; input: any }> = [];
  const pending = [
    { objectKey: "user-1/first.gpx", createdAt: new Date() },
    { objectKey: "user-1/second.zip", createdAt: new Date() },
  ];
  const tx = {
    import: { findMany: async () => pending },
    pendingObjectDeletion: {
      createMany: async (input: any) =>
        operations.push({ operation: "outbox", input }),
    },
    user: {
      delete: async (input: any) =>
        operations.push({ operation: "user", input }),
    },
  };
  const prisma = {
    pendingObjectDeletion: {
      findMany: async () => [...pending],
      deleteMany: async ({ where }: any) => {
        const index = pending.findIndex(
          (item) => item.objectKey === where.objectKey,
        );
        if (index >= 0) pending.splice(index, 1);
      },
      update: async () => undefined,
    },
    $transaction: async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
  };
  const storage = {
    deleteObject: async (key: string) => deletedObjects.push(key),
  };
  const service = new PortabilityService(prisma as any, storage as any);

  await service.deleteAccount(user);

  assert.deepEqual(deletedObjects, ["user-1/first.gpx", "user-1/second.zip"]);
  assert.deepEqual(operations[0], {
    operation: "outbox",
    input: {
      data: [
        { objectKey: "user-1/first.gpx" },
        { objectKey: "user-1/second.zip" },
      ],
      skipDuplicates: true,
    },
  });
  assert.deepEqual(operations[1], {
    operation: "user",
    input: { where: { id: user.id } },
  });
  assert.deepEqual(pending, []);
});

test("a failed account transaction never deletes import objects", async () => {
  const deletedObjects: string[] = [];
  const tx = {
    import: {
      findMany: async () => [{ objectKey: "user-1/upload.gpx" }],
    },
    pendingObjectDeletion: { createMany: async () => undefined },
    user: { delete: async () => undefined },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => unknown) => {
      await callback(tx);
      throw new Error("database commit failed");
    },
  };
  const storage = {
    deleteObject: async (key: string) => deletedObjects.push(key),
  };
  const service = new PortabilityService(prisma as any, storage as any);

  await assert.rejects(service.deleteAccount(user), /database commit failed/);
  assert.deepEqual(deletedObjects, []);
});

test("failed object cleanup remains queued for a later retry after account deletion", async () => {
  const updates: any[] = [];
  const pending = [{ objectKey: "user-1/upload.gpx", createdAt: new Date() }];
  const tx = {
    import: { findMany: async () => pending },
    pendingObjectDeletion: { createMany: async () => undefined },
    user: { delete: async () => undefined },
  };
  const prisma = {
    pendingObjectDeletion: {
      findMany: async () => pending,
      deleteMany: async () => {
        throw new Error("must not remove failed cleanup work");
      },
      update: async (input: any) => updates.push(input),
    },
    $transaction: async (callback: (transaction: typeof tx) => unknown) =>
      callback(tx),
  };
  const storage = {
    deleteObject: async () => {
      throw new Error("S3 unavailable");
    },
  };
  const service = new PortabilityService(prisma as any, storage as any);

  await service.deleteAccount(user);

  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { objectKey: "user-1/upload.gpx" });
  assert.deepEqual(updates[0].data.attempts, { increment: 1 });
  assert.match(updates[0].data.lastError, /S3 unavailable/);
});

test("account deletion requires exact confirmation and clears the session after deletion", async () => {
  let deleted = false;
  const clearedCookies: string[] = [];
  const controller = new PortabilityController({
    deleteAccount: async () => {
      deleted = true;
    },
  } as any);
  const response = {
    clearCookie: (name: string) => clearedCookies.push(name),
  } as any;

  await assert.rejects(
    controller.deleteAccount(user, { confirmation: "delete" }, response),
    BadRequestException,
  );
  assert.equal(deleted, false);
  assert.deepEqual(clearedCookies, []);

  assert.deepEqual(
    await controller.deleteAccount(user, { confirmation: "DELETE" }, response),
    { deleted: true },
  );
  assert.equal(deleted, true);
  assert.deepEqual(clearedCookies, ["geostats_session"]);
});
