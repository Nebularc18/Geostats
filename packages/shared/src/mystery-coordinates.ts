export function validCoordinatePair(latitude: unknown, longitude: unknown) {
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180
  ) return null;
  return { latitude, longitude };
}

type SolutionAttempt = {
  state?: unknown;
  kind?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  finalLatitude?: unknown;
  finalLongitude?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

function timestamp(value: unknown) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

export function latestMysterySolution<T extends SolutionAttempt>(attempts: readonly T[]) {
  let latest: ({ attempt: T } & NonNullable<ReturnType<typeof validCoordinatePair>>) | null = null;
  let latestTime = -Infinity;
  for (const attempt of attempts) {
    if (attempt?.state !== "correct") continue;
    const revealed = validCoordinatePair(attempt.finalLatitude, attempt.finalLongitude);
    const entered = attempt.kind === "keyword" || attempt.kind === "approach"
      ? null
      : validCoordinatePair(attempt.latitude, attempt.longitude);
    const coordinate = revealed ?? entered;
    if (!coordinate) continue;
    const time = Math.max(timestamp(attempt.createdAt), timestamp(attempt.updatedAt));
    // Agent attempts can be appended or edited in place. Keep stored order
    // as the tie-breaker for legacy attempts without usable timestamps.
    if (!latest || time > latestTime) {
      latest = { attempt, ...coordinate };
      latestTime = time;
    }
  }
  return latest;
}

export function mysteryFinalCoordinate(attempts: unknown) {
  const solution = Array.isArray(attempts) ? latestMysterySolution(attempts) : null;
  return solution ? { latitude: solution.latitude, longitude: solution.longitude } : null;
}
