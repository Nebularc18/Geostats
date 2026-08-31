import assert from "node:assert/strict";
import test from "node:test";
import { friendComparisonStats } from "./friend-comparison";

test("keeps comparison stats and strips malformed buckets", () => {
  assert.deepEqual(
    friendComparisonStats({
      totalFinds: 42,
      hideStats: { totalHides: 3 },
      countries: [
        { key: " Sweden ", count: 40 },
        { key: "", count: 2 },
        { key: "Norway", count: -1 }
      ],
      cacheTypes: [{ key: "Traditional Cache", count: 30 }],
      difficultyTerrain: [
        { difficulty: 1, terrain: 1, count: 4 },
        { difficulty: 1, terrain: 1.5, count: 0 }
      ],
      streaks: { longest: 7, current: 2 },
      ftfStats: { total: 5 }
    }),
    {
      totalFinds: 42,
      totalHides: 3,
      countryCount: 1,
      cacheTypeCount: 1,
      difficultyTerrainCount: 1,
      longestStreak: 7,
      currentStreak: 2,
      ftfCount: 5,
      countries: [{ key: "Sweden", count: 40 }],
      cacheTypes: [{ key: "Traditional Cache", count: 30 }]
    }
  );
});
