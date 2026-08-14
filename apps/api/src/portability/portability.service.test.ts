import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  parsePortableArchive,
  PortabilityService,
} from "./portability.service";
import { PortabilityController } from "./portability.controller";

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

test("export includes every portable user data category and excludes server secrets", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const foundAt = new Date("2026-02-03T12:30:00.000Z");
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

test("account deletion removes uploaded objects, the user, and only orphaned caches", async () => {
  const deletedObjects: string[] = [];
  const operations: Array<{ operation: string; input: any }> = [];
  const tx = {
    user: {
      delete: async (input: any) =>
        operations.push({ operation: "user", input }),
    },
    cache: {
      deleteMany: async (input: any) =>
        operations.push({ operation: "caches", input }),
    },
  };
  const prisma = {
    import: {
      findMany: async () => [
        { objectKey: "user-1/first.gpx" },
        { objectKey: "user-1/second.zip" },
      ],
    },
    find: { findMany: async () => [{ cacheId: "cache-1" }] },
    hide: {
      findMany: async () => [{ cacheId: "cache-1" }, { cacheId: "cache-2" }],
    },
    correctedCoordinate: { findMany: async () => [{ cacheId: "cache-2" }] },
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
    operation: "user",
    input: { where: { id: user.id } },
  });
  assert.deepEqual(operations[1].input.where, {
    id: { in: ["cache-1", "cache-2"] },
    finds: { none: {} },
    hides: { none: {} },
    corrections: { none: {} },
  });
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
