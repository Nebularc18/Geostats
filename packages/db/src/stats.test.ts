import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateUserStats } from "./stats";

test("shared snapshots include hosted events and use personal cache corrections and metadata", async () => {
  const foundCache = {
    gcCode: "GC123",
    name: "Found cache",
    cacheType: "Traditional Cache",
    latitude: 0,
    longitude: 0,
    difficulty: 2,
    terrain: 3,
    size: "Regular",
    country: "Sweden",
    region: null,
    county: null,
    hiddenDate: new Date("2020-01-01"),
    ownerName: "Someone else",
    corrections: [{ latitude: 59, longitude: 18 }],
    userData: [{ raw: { ele: { text: "123" } } }],
  };
  const tx = {
    geocachingProfile: {
      findUnique: async () => ({
        gcUsername: "Alice",
        homeLatitude: 59,
        homeLongitude: 18,
      }),
    },
    find: {
      findMany: async (query: Prisma.FindFindManyArgs) => {
        assert.deepEqual(query.where, {
          userId: "user-1",
          AND: [
            { cache: { hides: { none: { userId: "user-1" } } } },
            {
              cache: {
                OR: [
                  { metadataTrusted: false },
                  { ownerName: null },
                  { ownerName: { not: "alice", mode: "insensitive" } },
                ],
              },
            },
            { cache: { OR: [
              { metadataTrusted: true },
              { userData: { none: { userId: "user-1", raw: { path: ["geostatsMetadata", "ownerNameNormalized"], equals: "alice" } } } }
            ] } },
          ],
        });
        return [
          {
            foundAt: new Date("2024-05-01"),
            isFtf: false,
            logText: "Found it",
            cache: foundCache,
          },
        ];
      },
    },
    hide: {
      findMany: async () => [
        {
          placedAt: new Date("2024-01-01"),
          receivedLogCount: 0,
          receivedLogsRaw: null,
          cache: {
            ...foundCache,
            gcCode: "GC456",
            cacheType: "Event Cache",
            ownerName: "Alice",
          },
        },
      ],
    },
    ownerFinderCountryStat: { findMany: async () => [] },
  };
  const stats = await calculateUserStats(
    tx as unknown as Prisma.TransactionClient,
    "user-1",
  );
  assert.equal(stats.totalFinds, 1);
  assert.deepEqual(stats.elevationBuckets, [{ key: "< 125", count: 1 }]);
  assert.equal(stats.hideStats.hostedEventCaches, 1);
  assert.equal(stats.achievementStats.hostedEventCaches, 1);
  assert.equal(stats.milestoneStats.countMilestones[0]?.gcCode, "GC123");
  assert.equal(stats.distanceStats?.maxDistanceKm, 0);
});

test("neutral catalog identities retain personal statistics without counting the user's own cache", async () => {
  const neutral = { gcCode: "GC1", name: "GC1", metadataTrusted: false, latitude: 0, longitude: 0,
    cacheType: null, difficulty: null, terrain: null, size: null, country: null, region: null, county: null,
    hiddenDate: null, ownerName: null, corrections: [] };
  const raw = { lat: "59", lon: "18", time: "2020-01-01", "groundspeak:cache": {
    "groundspeak:name": "Private cache", "groundspeak:type": "Mystery", "groundspeak:difficulty": "2.5",
    "groundspeak:terrain": "3", "groundspeak:country": "Sweden", "groundspeak:state": "Stockholm",
    "groundspeak:owner": { text: "Bob" }
  } };
  const tx = {
    find: { findMany: async (query: any) => {
      assert.deepEqual(query.include.cache.include.userData, { where: { userId: "alice-id" }, take: 1 });
      return [
        { foundAt: new Date("2024-05-01"), cache: { ...neutral, userData: [{ raw }] } },
        { foundAt: new Date("2024-05-02"), cache: { ...neutral, gcCode: "GCOWN", userData: [{ raw: { ...raw,
          "groundspeak:cache": { ...raw["groundspeak:cache"], "groundspeak:owner": " ALICE " }
        } }] } }
      ];
    } },
    hide: { findMany: async () => [] }, ownerFinderCountryStat: { findMany: async () => [] }
  };
  const stats = await calculateUserStats(tx as unknown as Prisma.TransactionClient, "alice-id", { gcUsername: "Alice", homeLatitude: 59, homeLongitude: 18 });
  assert.equal(stats.totalFinds, 1);
  assert.deepEqual(stats.countries, [{ key: "Sweden", count: 1 }]);
  assert.deepEqual(stats.cacheTypes, [{ key: "Mystery Cache", count: 1 }]);
  assert.equal(stats.distanceStats?.maxDistanceKm, 0);
  assert.equal(stats.milestoneStats.countMilestones[0]?.name, "Private cache");
});
