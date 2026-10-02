import { BadRequestException, NotFoundException } from "@nestjs/common";
import assert from "node:assert/strict";
import test from "node:test";
import { STATS_VERSION } from "@geostats/stats";
import { elevationExtremeSql, StatsService } from "./stats.service";

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
