export type ComparisonBucket = {
  key: string;
  count: number;
};

export type ComparisonStats = {
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

export type ComparisonProfile = {
  username: string;
  latestImportAt: string | null;
  stats: ComparisonStats;
};

export type FriendComparison = {
  you: ComparisonProfile;
  friend: ComparisonProfile;
};

export type ComparisonBucketRow = {
  key: string;
  you: number;
  friend: number;
};

export function comparisonBucketRows(you: ComparisonBucket[], friend: ComparisonBucket[]): ComparisonBucketRow[] {
  const youByKey = new Map(you.map((bucket) => [bucket.key, bucket.count]));
  const friendByKey = new Map(friend.map((bucket) => [bucket.key, bucket.count]));
  return [...new Set([...youByKey.keys(), ...friendByKey.keys()])]
    .map((key) => ({
      key,
      you: youByKey.get(key) ?? 0,
      friend: friendByKey.get(key) ?? 0
    }))
    .sort((left, right) => right.you + right.friend - (left.you + left.friend) || left.key.localeCompare(right.key));
}

export function comparisonCountries(you: ComparisonBucket[], friend: ComparisonBucket[]) {
  const youNames = new Set(you.map((bucket) => bucket.key));
  const friendNames = new Set(friend.map((bucket) => bucket.key));
  return {
    shared: [...youNames].filter((name) => friendNames.has(name)).sort(),
    onlyYou: [...youNames].filter((name) => !friendNames.has(name)).sort(),
    onlyFriend: [...friendNames].filter((name) => !youNames.has(name)).sort()
  };
}

export function readSavedFriends(value: string | null) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return [
      ...new Set(
        parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    ].slice(0, 20);
  } catch {
    return [];
  }
}
