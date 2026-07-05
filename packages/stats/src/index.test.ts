import assert from "node:assert/strict";
import test from "node:test";
import { calculateHideStats, calculateStats } from "./index";

test("calculateStats returns core buckets, milestones, and streaks", () => {
  const stats = calculateStats([
    {
      foundAt: "2024-01-01T10:00:00.000Z",
      cache: {
        gcCode: "GC1",
        name: "First",
        cacheType: "Traditional Cache",
        difficulty: 1.5,
        terrain: 2,
        size: "Regular",
        country: "Sweden",
        region: "Blekinge",
        county: "Karlskrona"
      }
    },
    {
      foundAt: "2024-01-02T10:00:00.000Z",
      isFtf: true,
      cache: {
        gcCode: "GC2",
        name: "Second",
        cacheType: "Mystery Cache",
        difficulty: 3,
        terrain: 2.5,
        size: "Micro",
        latitude: 56.1612,
        longitude: 15.5869,
        country: "Sweden",
        region: "Blekinge",
        county: "Ronneby"
      }
    }
  ]);

  assert.equal(stats.totalFinds, 2);
  assert.deepEqual(stats.findsByMonth, [{ key: "2024-01", count: 2 }]);
  assert.deepEqual(stats.findsByDay, [
    { key: "2024-01-01", count: 1 },
    { key: "2024-01-02", count: 1 }
  ]);
  assert.equal(stats.cacheTypes.length, 2);
  assert.equal(stats.ftfStats.total, 1);
  assert.equal(stats.ftfStats.first?.gcCode, "GC2");
  assert.equal(stats.ftfStats.first?.dateTime, "2024-01-02T10:00:00.000Z");
  assert.equal(stats.ftfStats.firstByLocation[0]?.dateTime, "2024-01-02T10:00:00.000Z");
  assert.deepEqual(stats.ftfStats.byYear, [{ key: "2024", count: 1 }]);
  assert.equal(stats.ftfStats.bestDay?.key, "2024-01-02");
  assert.equal(stats.ftfStats.byDifficulty.find((row) => row.key === "3.0")?.count, 1);
  assert.equal(stats.ftfStats.byDifficultyTerrain[0]?.terrain, 2.5);
  assert.equal(stats.ftfStats.firstByLocation[0]?.label, "Sweden / Blekinge / Ronneby");
  assert.equal(stats.difficultyTerrain.length, 2);
  assert.deepEqual(stats.countries, [{ key: "Sweden", count: 2 }]);
  assert.equal(stats.milestones[0]?.count, 1);
  assert.equal(stats.milestones.at(-1)?.count, 1);
  assert.equal(stats.milestoneStats.firstByCountry[0]?.label, "Sweden");
  assert.equal(stats.milestoneStats.firstByHomeCountryRegion[0]?.label, "Blekinge");
  assert.equal(stats.milestoneStats.firstByType.length, 2);
  assert.equal(stats.milestoneStats.firstBySize.length, 2);
  assert.equal(stats.milestoneStats.firstByDifficultyTerrain.length, 2);
  assert.equal(stats.streaks.longest, 2);
});

test("calculateStats uses Geocaching cache milestone ranks", () => {
  const finds = Array.from({ length: 222 }, (_, index) => ({
    foundAt: `2024-01-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    cache: {
      gcCode: `GC${index + 1}`,
      name: `Cache ${index + 1}`,
      cacheType: "Traditional Cache",
      difficulty: 1.5,
      terrain: 1.5,
      size: "Regular",
      country: "Sweden",
      region: "Blekinge",
      county: "Karlskrona"
    }
  }));

  const stats = calculateStats(finds);

  assert.deepEqual(
    stats.milestones.map((milestone) => milestone.count),
    [1, 5, 10, 25, 50, 75, 100, 200]
  );
});

test("calculateHideStats derives owner-side log and date buckets", () => {
  const stats = calculateHideStats([
    {
      placedAt: "2026-05-01T00:00:00.000Z",
      receivedLogCount: 0,
      receivedLogsRaw: {
        "groundspeak:cache": {
          "groundspeak:logs": {
            "groundspeak:log": [
              {
                "groundspeak:date": "2026-05-03T19:00:00Z",
                "groundspeak:type": "Found it",
                "groundspeak:finder": "FinderOne",
                "geostats:finder_country": "Sweden",
                "groundspeak:text": "Nice hide"
              },
              {
                "groundspeak:date": "2026-05-04T19:00:00Z",
                "groundspeak:type": "Publish Listing",
                "groundspeak:finder": "Reviewer"
              }
            ]
          }
        }
      },
      cache: {
        gcCode: "GCHIDE1",
        name: "First hide",
        cacheType: "Traditional Cache",
        difficulty: 1.5,
        terrain: 1.5,
        size: "Small",
        latitude: 56.1,
        longitude: 15.1,
        country: "Sweden",
        region: "Blekinge",
        county: "Karlskrona"
      }
    }
  ]);

  assert.equal(stats.totalHides, 1);
  assert.equal(stats.totalReceivedLogs, 1);
  assert.equal(stats.totalUniqueFinders, 1);
  assert.deepEqual(stats.receivedLogsByMonth, [{ key: "2026-05", count: 1 }]);
  assert.deepEqual(stats.placedHiddenDateMatrix, [{ key: "05-01", count: 1 }]);
  assert.deepEqual(stats.receivedFoundDateMatrix, [{ key: "05-03", count: 1 }]);
  assert.equal(stats.logsReceived[0]?.gcCode, "GCHIDE1");
  assert.equal(stats.finderBuckets[0]?.key, "FinderOne");
  assert.deepEqual(stats.finderCountryBuckets, [{ key: "Sweden", count: 1, percent: 100 }]);
});
