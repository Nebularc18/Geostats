export type MergeableMysteryAttempt = {
  id: string;
  kind?: "coordinate" | "keyword";
  latitude?: number;
  longitude?: number;
  answer?: string;
  finalLatitude?: number;
  finalLongitude?: number;
  state: "correct" | "wrong" | "unchecked";
  createdAt: string;
  geocachingSyncedAt?: string;
};

export type MergeableMysteryCache = {
  id: string;
  gcCode: string;
  name: string;
  area: string;
  county?: string;
  country: string;
  region?: string;
  locality?: string;
  locationHierarchy?: string[];
  status: "solving" | "solved" | "planned";
  notes: string;
  clues: string[];
  sharedWith: Array<{ id: string }>;
  attempts: MergeableMysteryAttempt[];
  image?: string;
};

function coordinateKey(latitude: unknown, longitude: unknown) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude}:${longitude}`
    : "";
}

function attemptKey(attempt: MergeableMysteryAttempt) {
  if (attempt.kind === "keyword") {
    const answer = attempt.answer?.trim().toLocaleLowerCase();
    return answer ? `keyword:${answer}` : `id:${attempt.id}`;
  }
  const coordinate = coordinateKey(attempt.latitude, attempt.longitude);
  return coordinate ? `coordinate:${coordinate}` : `id:${attempt.id}`;
}

function mergeDuplicateAttempt<T extends MergeableMysteryAttempt>(existing: T, incoming: T): T {
  const stateRank = { unchecked: 0, wrong: 1, correct: 2 } as const;
  const preferred = stateRank[incoming.state] > stateRank[existing.state] ? incoming : existing;
  const fallback = preferred === existing ? incoming : existing;
  const preferredHasFinal = Number.isFinite(preferred.finalLatitude) && Number.isFinite(preferred.finalLongitude);
  const fallbackHasFinal = Number.isFinite(fallback.finalLatitude) && Number.isFinite(fallback.finalLongitude);

  const merged: T = {
    ...fallback,
    ...preferred,
    // Keep the first ID stable so server-side receipts still match after a merge.
    id: existing.id,
    createdAt: existing.createdAt || incoming.createdAt
  };
  const final = preferredHasFinal ? preferred : fallbackHasFinal ? fallback : null;
  if (final) {
    merged.finalLatitude = final.finalLatitude;
    merged.finalLongitude = final.finalLongitude;
  } else {
    delete merged.finalLatitude;
    delete merged.finalLongitude;
  }
  const syncedAt = existing.geocachingSyncedAt || incoming.geocachingSyncedAt;
  if (syncedAt) merged.geocachingSyncedAt = syncedAt;
  else delete merged.geocachingSyncedAt;
  return merged;
}

/** Merge offline and server attempts without retaining the same coordinate twice. */
export function mergeMysteryAttempts<T extends MergeableMysteryAttempt>(attempts: T[]): T[] {
  const merged = new Map<string, T>();
  for (const attempt of attempts) {
    const key = attemptKey(attempt);
    const existing = merged.get(key);
    merged.set(key, existing ? mergeDuplicateAttempt(existing, attempt) : attempt);
  }
  return [...merged.values()];
}

/** Produce one cache from server and offline copies while retaining their useful data. */
export function mergeMysteryCaches<T extends MergeableMysteryCache>(existing: T, incoming: T): T {
  const sharedWith = new Map([...existing.sharedWith, ...incoming.sharedWith].map((user) => [user.id, user]));
  const statusRank = { solving: 0, planned: 1, solved: 2 } as const;
  return {
    ...existing,
    name: existing.name || incoming.name,
    area: existing.area || incoming.area,
    county: existing.county || incoming.county,
    country: existing.country || incoming.country,
    region: existing.region || incoming.region,
    locality: existing.locality || incoming.locality,
    locationHierarchy: existing.locationHierarchy?.length ? existing.locationHierarchy : incoming.locationHierarchy,
    status: statusRank[incoming.status] > statusRank[existing.status] ? incoming.status : existing.status,
    notes: (incoming.notes?.length ?? 0) > (existing.notes?.length ?? 0) ? incoming.notes : existing.notes,
    clues: [...new Set([...existing.clues, ...incoming.clues])],
    attempts: mergeMysteryAttempts([...existing.attempts, ...incoming.attempts]),
    sharedWith: [...sharedWith.values()],
    image: existing.image || incoming.image
  };
}
