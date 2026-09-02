import assert from "node:assert/strict";
import test from "node:test";
import { TrackablesImportService } from "./trackables-import.service";

function log(overrides: Record<string, unknown> = {}) {
  return {
    trackingCode: "TB123",
    trackableName: "A traveller",
    logType: "VISITED" as const,
    loggedAt: new Date("2024-01-01T00:00:00.000Z"),
    gcCode: "GC123",
    cacheName: "Journey cache",
    latitude: 56.1,
    longitude: 15.6,
    locationName: null,
    holderName: null,
    notes: null,
    raw: {},
    ...overrides,
  };
}

function serviceHarness(existingCaches: unknown[] = []) {
  const createdLogs: any[] = [];
  const cacheCreates: any[] = [];
  const cacheUpdates: any[] = [];
  let transactions = 0;
  const tx = {
    cache: {
      findMany: async () => existingCaches,
      createMany: async (input: unknown) => cacheCreates.push(input),
      update: async (input: unknown) => cacheUpdates.push(input),
    },
    trackable: {
      upsert: async ({ where }: any) => ({
        id: `trackable-${where.userId_trackingCode.trackingCode}`,
      }),
    },
    trackableLog: {
      findMany: async () => [],
      createMany: async (input: unknown) => createdLogs.push(input),
    },
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return run(tx);
    },
  };
  return {
    service: new TrackablesImportService(prisma as any),
    createdLogs,
    cacheCreates,
    cacheUpdates,
    transactions,
  };
}

function parsedImport(trackables: any[], logs: any[]) {
  return { trackables, logs };
}

test("journey imports never overwrite or create shared cache metadata", async () => {
  const harness = serviceHarness([
    {
      id: "cache-1",
      gcCode: "GC123",
      name: "Trusted cache",
      latitude: 56.2,
      longitude: 15.7,
    },
  ]);
  const service = harness.service as any;
  service.parse = async () =>
    parsedImport(
      [{ trackingCode: "TB123", name: "A traveller", raw: {} }],
      [log()],
    );

  const result = await harness.service.import(
    "user-1",
    "journey.kml",
    Buffer.from("ignored"),
  );

  assert.deepEqual(result.unresolvedCaches, []);
  assert.equal(harness.cacheCreates.length, 0);
  assert.equal(harness.cacheUpdates.length, 0);
  assert.equal(harness.createdLogs.length, 1);
  const created = harness.createdLogs[0].data[0];
  assert.equal(created.cacheId, "cache-1");
  assert.equal(created.gcCode, "GC123");
  assert.equal(created.cacheName, "Journey cache");
  assert.equal(created.latitude, 56.1);
  assert.equal(created.longitude, 15.6);
});

test("journey imports retain missing cache details on the private movement log", async () => {
  const harness = serviceHarness();
  const service = harness.service as any;
  service.parse = async () =>
    parsedImport(
      [{ trackingCode: "TB123", name: "A traveller", raw: {} }],
      [log()],
    );

  const result = await harness.service.import(
    "user-1",
    "journey.kml",
    Buffer.from("ignored"),
  );

  assert.deepEqual(result.unresolvedCaches, ["GC123"]);
  assert.equal(result.importedCaches, 0);
  assert.equal(harness.createdLogs[0].data[0].cacheId, null);
  assert.equal(harness.createdLogs[0].data[0].gcCode, "GC123");
  assert.equal(harness.createdLogs[0].data[0].cacheName, "Journey cache");
});

test("large journey logs are written in bounded batches", async () => {
  const harness = serviceHarness();
  const service = harness.service as any;
  const logs = Array.from({ length: 501 }, (_, index) =>
    log({
      gcCode: null,
      cacheName: null,
      loggedAt: new Date(Date.UTC(2024, 0, 1, index)),
    }),
  );
  service.parse = async () =>
    parsedImport(
      [{ trackingCode: "TB123", name: "A traveller", raw: {} }],
      logs,
    );

  const result = await harness.service.import(
    "user-1",
    "journey.gpx",
    Buffer.from("ignored"),
  );

  assert.equal(result.importedLogs, 501);
  assert.deepEqual(
    harness.createdLogs.map((input) => input.data.length),
    [500, 1],
  );
});
