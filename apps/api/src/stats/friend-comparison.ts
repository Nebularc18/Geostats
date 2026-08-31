export type ComparisonBucket = {
  key: string;
  count: number;
};

export type FriendComparisonStats = {
  totalFinds: number;
  totalHides: number;
  countryCount: number;
  cacheTypeCount: number;
  difficultyTerrainCount: number;
  longestStreak: number;
  currentStreak: number;
  ftfCount: number;
  countries: ComparisonBucket[];
  cacheTypes: ComparisonBucket[];
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function buckets(value: unknown): ComparisonBucket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => ({
      key: typeof entry?.key === "string" ? entry.key.trim() : "",
      count: numberValue(entry?.count)
    }))
    .filter((entry) => entry.key && entry.count > 0);
}

export function friendComparisonStats(stats: any): FriendComparisonStats {
  const countries = buckets(stats?.countries);
  const cacheTypes = buckets(stats?.cacheTypes);
  const difficultyTerrain = Array.isArray(stats?.difficultyTerrain) ? stats.difficultyTerrain.filter((entry: any) => numberValue(entry?.count) > 0) : [];

  return {
    totalFinds: numberValue(stats?.totalFinds),
    totalHides: numberValue(stats?.hideStats?.totalHides),
    countryCount: countries.length,
    cacheTypeCount: cacheTypes.length,
    difficultyTerrainCount: difficultyTerrain.length,
    longestStreak: numberValue(stats?.streaks?.longest),
    currentStreak: numberValue(stats?.streaks?.current),
    ftfCount: numberValue(stats?.ftfStats?.total),
    countries,
    cacheTypes
  };
}
