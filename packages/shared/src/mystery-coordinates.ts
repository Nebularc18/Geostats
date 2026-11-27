export function validCoordinatePair(latitude: unknown, longitude: unknown) {
  if (
    typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
    typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180
  ) return null;
  return { latitude, longitude };
}

export function mysteryFinalCoordinate(attempts: unknown) {
  if (!Array.isArray(attempts)) return null;
  // Both clients put the newest attempts first.
  for (const attempt of attempts) {
    if (attempt?.state !== "correct") continue;
    const revealed = validCoordinatePair(attempt.finalLatitude, attempt.finalLongitude);
    if (revealed) return revealed;
    if (attempt.kind === "keyword" || attempt.kind === "approach") continue;
    const entered = validCoordinatePair(attempt.latitude, attempt.longitude);
    if (entered) return entered;
  }
  return null;
}
