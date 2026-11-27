import { BadRequestException, NotFoundException } from "@nestjs/common";
import assert from "node:assert/strict";
import test from "node:test";
import { STATS_VERSION } from "@geostats/stats";
import { effectiveExtremeCachesSql, locationExtremeSql, elevationExtremeSql, StatsService } from "./stats.service";

test("legacy elevation SQL guards conversion inside CASE and bounds terrestrial values", () => {
  for (const direction of ["ASC", "DESC"] as const) {
    const sql = elevationExtremeSql(direction, null);
    assert.match(sql, /CASE WHEN length\(ele_text\) <= 32[\s\S]*THEN CAST\(ele_text AS double precision\)[\s\S]*ELSE NULL/);
    assert.match(sql, /WHERE elevation BETWEEN -12000 AND 10000/);
    assert.match(sql, new RegExp(`ORDER BY v.elevation ${direction}`));
    assert.match(sql, /u\."raw"->'ele'->>'text'/);
  }
});

test("FTF rows display only requesting-user metadata on neutral catalog entries", async () => {
  const neutral = { gcCode: "GC1", name: "GC1", cacheType: null, difficulty: null, terrain: null,
    size: null, country: null, region: null, metadataTrusted: false };
  const row = (id: string, owner: string) => ({ id, foundAt: new Date("2024-01-01"), isFtf: true, logText: "Found",
    cache: { ...neutral, userData: [{ raw: { geostatsMetadata: { name: "Private name", cacheType: "Mystery",
      difficulty: 2.5, terrain: 3, country: "Sweden", ownerName: owner } } }] }
  });
  const prisma = {
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Alice" }) },
    find: { findMany: async (query: any) => {
      assert.deepEqual(query.select.cache.select.userData, { where: { userId: "alice-id" }, take: 1, select: { raw: true } });
      return [row("own", " ALICE "), row("other", "Bob")];
    } }
  };
  const result = await new StatsService(prisma as any).ftfFindsForUser("alice-id");
  assert.equal(result.finds.length, 1);
  assert.equal(result.finds[0].cache.name, "Private name");
  assert.equal(result.finds[0].cache.cacheType, "Mystery Cache");
  assert.equal(result.finds[0].cache.country, "Sweden");
  assert.equal(result.finds[0].cache.gcCode, "GC1");
});

test("rejects ambiguous case-insensitive geocaching usernames", async () => {
  let latestImportLookups = 0;
  const prisma = {
    $queryRaw: async (query: any) => {
      assert.match(query.sql, /REGEXP_REPLACE/);
      assert.equal(query.values.at(-1), "alice");
      assert.ok(query.values.some((value: unknown) => typeof value === "string" && value.includes("\u00a0")));
      return [
        { userId: "user-1", gcUsername: " Alice " },
        { userId: "user-2", gcUsername: "alice\u00a0" },
      ];
    },
    import: {
      findFirst: async () => {
        latestImportLookups += 1;
        return null;
      },
    },
  };
  const service = new StatsService(prisma as any);

  await assert.rejects(
    () => (service as any).snapshotForUsername(" ALICE "),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message === "Geocaching username matches multiple profiles",
  );
  assert.equal(latestImportLookups, 0);
});

test("resolves a uniquely padded Geocaching username", async () => {
  let usernameQuery: any;
  const prisma = {
    $queryRaw: async (query: any) => {
      usernameQuery = query;
      return [{ userId: "user-1", gcUsername: " Alice " }];
    },
    geocachingProfile: {
      findUnique: async () => ({ userId: "user-1", gcUsername: " Alice ", homeLatitude: null, homeLongitude: null })
    },
    statSnapshot: {
      findFirst: async () => ({ statsJson: { statsVersion: STATS_VERSION } })
    },
    import: {
      findFirst: async () => null
    }
  };
  const service = new StatsService(prisma as any);

  const snapshot = await (service as any).snapshotForUsername(" ALICE ");

  assert.equal(snapshot.profile.userId, "user-1");
  assert.equal(snapshot.profile.gcUsername, " Alice ");
  assert.doesNotMatch(usernameQuery.sql, /public_stats_enabled/);
});

test("public snapshots only resolve profiles with explicit publication consent", async () => {
  let usernameQuery: any;
  const prisma = {
    $queryRaw: async (query: any) => {
      usernameQuery = query;
      return [];
    },
    import: {
      findFirst: async () => {
        throw new Error("private profiles must be rejected before loading imports");
      }
    }
  };
  const service = new StatsService(prisma as any);

  await assert.rejects(() => service.publicSnapshotForUsername("Alice"), NotFoundException);
  assert.match(usernameQuery.sql, /public_stats_enabled/);
});


test("extremes rank private locations only within the requesting account", async () => {
  const rows: any[] = [];
  let homeQuery: any;
  const prisma = {
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Alice" }) },
    find: { findFirst: async (query: any) => {
      homeQuery = query;
      return { cache: { country: null, metadataTrusted: false, userData: [{ raw: {
        geostatsMetadata: { country: "Sweden" }
      } }] } };
    } },
    $queryRawUnsafe: async (sql: string, ...bindings: unknown[]) => {
      assert.deepEqual(bindings, [null, null, "alice"]);
      assert.match(sql, /u.user_id = \$3/);
      rows.push(sql);
      if (sql.includes("SELECT DISTINCT country")) return [{ country: "Sweden" }];
      if (sql.includes("ORDER BY latitude DESC")) return [{ id: "private", gcCode: "GC1", name: "Private", cacheType: "Mystery Cache",
        country: "Sweden", region: null, latitude: 65, longitude: 18, hiddenDate: "2020-01-01T00:00:00.000Z" }];
      return [];
    }
  };
  const service = new StatsService(prisma as any);
  (service as any).foundCacheIdsFor = async () => new Set(["private"]);
  const result = await service.extremeCachesForUser("alice");
  assert.deepEqual(result.countries, ["Sweden"]);
  assert.equal(result.homeCountry, "Sweden");
  assert.equal(result.extremes.northernmost?.name, "Private");
  assert.equal(result.extremes.northernmost?.latitude, 65);
  assert.equal(result.extremes.northernmost?.hiddenDate, "2020-01-01");
  assert.equal(rows.length, 8);
  // Countryless private rows cannot win the earliest-home-find query.
  const privateFilter = homeQuery.where.cache.OR[1].userData.some;
  assert.equal(privateFilter.userId, "alice");
  assert.deepEqual(privateFilter.AND[0].raw, { path: ["geostatsMetadata", "country"], not: "" });
});

test("extreme SQL discards neutral placeholders and scopes elevation data", () => {
  assert.match(effectiveExtremeCachesSql(), /WHERE c.metadata_trusted = true/);
  assert.match(effectiveExtremeCachesSql(), /u.user_id = \$3/);
  assert.match(locationExtremeSql("latitude", "DESC"), /latitude IS NOT NULL AND longitude IS NOT NULL/);
  assert.match(elevationExtremeSql("ASC", null), /u."user_id" = \$3/);
});

test("stats rebuild older snapshots and refresh maintenance after a UTC day", async () => {
  let latest = { generatedAt: new Date("2000-01-01"), statsJson: { statsVersion: STATS_VERSION, hideStats: { activeHides: 1 } } };
  let recalculations = 0;
  const service = new StatsService({
    geocachingProfile: { findUnique: async () => null },
    statSnapshot: { findFirst: async () => latest }
  } as never);
  Object.assign(service, { recalculateSnapshotForUser: async () => { recalculations += 1; } });

  await service.snapshotForUser("owner");
  latest = { ...latest, generatedAt: new Date() };
  assert.equal(await service.snapshotForUser("owner"), latest.statsJson);
  latest = { ...latest, statsJson: { ...latest.statsJson, statsVersion: STATS_VERSION - 1 } };
  await service.snapshotForUser("owner");
  assert.equal(recalculations, 2);
});

test("cache detail uses the newest correct workspace coordinates and leaves missing coordinates empty", async () => {
  const workspace = {
    id: "workspace", clientId: "client", updatedAt: new Date(),
    data: { attempts: [
      { state: "wrong", latitude: 1, longitude: 2 },
      { state: "correct", kind: "keyword", finalLatitude: 56, finalLongitude: 15 },
      { state: "correct", latitude: 57, longitude: 16 }
    ] }
  };
  const service = new StatsService({
    cache: { findUnique: async () => null },
    mysteryWorkspace: { findFirst: async () => workspace },
    savedFriend: { findMany: async () => [] },
    trackableLog: { findMany: async () => [] }
  } as never);

  const { cache } = await service.cacheDetailForUser("owner", "GCFINAL");
  assert.deepEqual([cache.latitude, cache.longitude, cache.correctedLatitude, cache.correctedLongitude], [null, null, 56, 15]);
});

test("cache detail normalizes nested Groundspeak hide logs", async () => {
  const cache = {
    gcCode: "GCHIDE", name: "Hide", latitude: 56, longitude: 15, finds: [], corrections: [],
    hides: [{ id: "hide", receivedLogCount: 1, receivedLogsRaw: {
      "groundspeak:cache": { "groundspeak:logs": { "groundspeak:log": {
        "groundspeak:type": "Found it",
        "groundspeak:date": "2026-02-13T09:00:00Z",
        "groundspeak:finder": { text: "Alice" }
      } } }
    } }]
  };
  const service = new StatsService({
    cache: { findUnique: async () => cache },
    mysteryWorkspace: { findFirst: async () => null },
    savedFriend: { findMany: async () => [] },
    trackableLog: { findMany: async () => [] }
  } as never);

  const result = await service.cacheDetailForUser("owner", "GCHIDE");
  assert.deepEqual(result.hide?.receivedLogs.map(({ date, finder, type }) => ({ date, finder, type })), [
    { date: "2026-02-13", finder: "Alice", type: "Found it" }
  ]);
});

test("Logbook pages by date in the database when no private owner check is needed", async () => {
  const row = { id: "third", foundAt: new Date("2025-01-01"), cache: { gcCode: "GCPAGE", metadataTrusted: true } };
  let reads = 0;
  const service = new StatsService({
    geocachingProfile: { findUnique: async () => null },
    find: {
      count: async () => 10,
      findMany: async (query: any) => {
        reads += 1;
        if (reads === 1) {
          assert.equal(query.skip, 2);
          assert.equal(query.take, 1);
          assert.equal(query.select.logText, false);
          return [row];
        }
        assert.deepEqual(query.where, { userId: "owner", id: { in: [row.id] } });
        return [{ id: row.id, logText: "A log on this page" }];
      }
    }
  } as never);

  const result = await service.findsForUser("owner", { offset: 2, limit: 1, includeFacets: false });
  assert.equal(result.total, 10);
  assert.equal(result.hasMore, true);
  assert.equal(result.finds[0]?.logText, "A log on this page");
});
