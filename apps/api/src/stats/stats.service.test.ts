import { BadRequestException } from "@nestjs/common";
import assert from "node:assert/strict";
import test from "node:test";
import { STATS_VERSION } from "@geostats/stats";
import { StatsService } from "./stats.service";

test("rejects ambiguous case-insensitive geocaching usernames", async () => {
  let latestImportLookups = 0;
  const prisma = {
    $queryRaw: async (query: any) => {
      assert.match(query.sql, /REGEXP_REPLACE/);
      assert.deepEqual(query.values, ["alice"]);
      return [
        { userId: "user-1", gcUsername: " Alice " },
        { userId: "user-2", gcUsername: "alice" },
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
  const prisma = {
    $queryRaw: async () => [{ userId: "user-1", gcUsername: " Alice " }],
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
});
