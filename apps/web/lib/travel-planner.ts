export type TravelAttempt = {
  state: "correct" | "wrong" | "unchecked" | "planned";
  kind?: "coordinate" | "keyword" | "approach";
  latitude?: number;
  longitude?: number;
  finalLatitude?: number;
  finalLongitude?: number;
};

export type TravelPlannerCache = {
  id: string;
  trip?: string;
  tripUpdatedAt?: string;
  attempts: TravelAttempt[];
};

export const MAX_TRIP_NAME_LENGTH = 80;

export function normalizedTripName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, MAX_TRIP_NAME_LENGTH)
    : "";
}

export function finalTravelCoordinate(cache: Pick<TravelPlannerCache, "attempts">) {
  for (const attempt of cache.attempts) {
    if (attempt.state !== "correct") continue;
    if (Number.isFinite(attempt.finalLatitude) && Number.isFinite(attempt.finalLongitude)) {
      return { latitude: attempt.finalLatitude!, longitude: attempt.finalLongitude! };
    }
    if (
      attempt.kind !== "keyword" &&
      attempt.kind !== "approach" &&
      Number.isFinite(attempt.latitude) &&
      Number.isFinite(attempt.longitude)
    ) {
      return { latitude: attempt.latitude!, longitude: attempt.longitude! };
    }
  }
  return null;
}

export function travelGroups<T extends TravelPlannerCache>(caches: T[]) {
  const groups = new Map<string, T[]>();
  for (const cache of caches) {
    const trip = normalizedTripName(cache.trip);
    if (!trip) continue;
    const existingName = [...groups.keys()].find((name) => name.toLocaleLowerCase() === trip.toLocaleLowerCase());
    const name = existingName ?? trip;
    groups.set(name, [...(groups.get(name) ?? []), cache]);
  }
  return [...groups.entries()].sort(([first], [second]) => first.localeCompare(second));
}

export function newerTravelAssignment<T extends TravelPlannerCache>(server: T, device: T): T {
  const serverTime = Date.parse(server.tripUpdatedAt ?? "");
  const deviceTime = Date.parse(device.tripUpdatedAt ?? "");
  if (Number.isFinite(serverTime) && (!Number.isFinite(deviceTime) || serverTime > deviceTime)) {
    return { ...device, trip: server.trip, tripUpdatedAt: server.tripUpdatedAt };
  }
  if (Number.isFinite(deviceTime)) return device;
  if (normalizedTripName(device.trip) && !normalizedTripName(server.trip)) return device;
  return { ...device, trip: server.trip, tripUpdatedAt: server.tripUpdatedAt };
}

export function reconcileStaleTravelAssignment<T extends TravelPlannerCache>(server: T, desired: T) {
  const resolved = newerTravelAssignment(server, desired);
  if (resolved === desired) {
    return {
      retry: true,
      cache: {
        ...server,
        id: desired.id,
        trip: desired.trip,
        tripUpdatedAt: desired.tripUpdatedAt
      }
    };
  }
  return {
    retry: false,
    cache: {
      ...desired,
      trip: server.trip,
      tripUpdatedAt: server.tripUpdatedAt
    }
  };
}

export function travelDirectionsUrl(caches: TravelPlannerCache[]) {
  const coordinates = caches.flatMap((cache) => {
    const coordinate = finalTravelCoordinate(cache);
    return coordinate ? [`${coordinate.latitude},${coordinate.longitude}`] : [];
  });
  if (!coordinates.length) return "";
  const destination = coordinates.at(-1)!;
  const waypoints = coordinates.slice(0, -1);
  const params = new URLSearchParams({ api: "1", destination, travelmode: "driving" });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
