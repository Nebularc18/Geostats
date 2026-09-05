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
                  { ownerName: null },
                  { ownerName: { not: "alice", mode: "insensitive" } },
                ],
              },
            },
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
