export type MergeableMysteryAttempt = {
  id: string;
  kind?: "coordinate" | "keyword" | "approach";
  latitude?: number;
  longitude?: number;
  answer?: string;
  finalLatitude?: number;
  finalLongitude?: number;
  state: "correct" | "wrong" | "unchecked" | "planned";
  createdAt: string;
  updatedAt?: string;
  geocachingSyncedAt?: string;
  note?: string;
  source?: string;
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

export type MysteryCacheMergeOptions = {
  preferIncomingNotes?: boolean;
  preferIncomingImage?: boolean;
};

/** A device field can win only when a baseline exists and proves it changed. */
export function fieldChangedSinceBaseline(currentFingerprint: string, baselineFingerprint?: string) {
  return typeof baselineFingerprint === "string" && currentFingerprint !== baselineFingerprint;
}

function coordinateKey(latitude: unknown, longitude: unknown) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude}:${longitude}`
    : "";
}

function attemptKey(attempt: MergeableMysteryAttempt) {
  if (attempt.kind === "keyword" || attempt.kind === "approach") {
    const answer = attempt.answer?.trim().toLocaleLowerCase();
    return answer ? `${attempt.kind}:${answer}` : `id:${attempt.id}`;
  }
  const coordinate = coordinateKey(attempt.latitude, attempt.longitude);
  return coordinate ? `coordinate:${coordinate}` : `id:${attempt.id}`;
}

function attemptModifiedAt(attempt: MergeableMysteryAttempt) {
  const updatedAt = Date.parse(attempt.updatedAt ?? "");
  if (Number.isFinite(updatedAt)) return updatedAt;
  const createdAt = Date.parse(attempt.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function mergeDuplicateAttempt<T extends MergeableMysteryAttempt>(existing: T, incoming: T): T {
  const stateRank = { planned: 0, unchecked: 1, wrong: 2, correct: 3 } as const;
  const preferred = stateRank[incoming.state] >= stateRank[existing.state] ? incoming : existing;
  const fallback = preferred === existing ? incoming : existing;
  const metadata = attemptModifiedAt(incoming) >= attemptModifiedAt(existing) ? incoming : existing;
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
  // Solve state and annotations have different conflict rules: retain the
  // strongest result, but take editable metadata from the newest record.
  for (const field of ["note", "source", "updatedAt"] as const) {
    if (field in metadata) merged[field] = metadata[field];
    else delete merged[field];
  }
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

/** Produce one cache from a server copy and an incoming device copy. */
export function mergeMysteryCaches<T extends MergeableMysteryCache>(
  existing: T,
  incoming: T,
  options: MysteryCacheMergeOptions = {}
): T {
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
    notes: options.preferIncomingNotes === false ? existing.notes : incoming.notes,
    clues: [...new Set([...existing.clues, ...incoming.clues])],
    attempts: mergeMysteryAttempts([...existing.attempts, ...incoming.attempts]),
    sharedWith: [...sharedWith.values()],
    // `undefined` is meaningful when the device changed this field: it records
    // an intentional removal rather than a missing value to fill from server.
    image: options.preferIncomingImage === false ? existing.image : incoming.image
  };
}
