export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type TravelCandidate = Coordinate & {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  country: string | null;
  region: string | null;
  county: string | null;
  found: boolean;
  source: "imported" | "mystery";
};

export type RankedTravelCandidate = TravelCandidate & {
  distanceKm: number;
  routeProgress?: number;
};

const EARTH_RADIUS_KM = 6371.0088;

export function mergeTravelCandidates(imported: TravelCandidate[], mysteries: TravelCandidate[]) {
  const candidates = new Map(imported.map((candidate) => [candidate.gcCode.toLocaleUpperCase(), candidate]));
  for (const mystery of mysteries) {
    const key = mystery.gcCode.toLocaleUpperCase();
    const existing = candidates.get(key);
    candidates.set(key, existing
      ? { ...existing, ...mystery, found: existing.found, source: "mystery" }
      : mystery);
  }
  return [...candidates.values()];
}

function radians(value: number) {
  return value * Math.PI / 180;
}

export function haversineKm(first: Coordinate, second: Coordinate) {
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function distanceToRouteKm(point: Coordinate, route: Coordinate[]) {
  return closestRoutePoint(point, route).distanceKm;
}

function closestRoutePoint(point: Coordinate, route: Coordinate[]) {
  if (route.length === 0) return { distanceKm: Number.POSITIVE_INFINITY, progress: 0 };
  if (route.length === 1) return { distanceKm: haversineKm(point, route[0]!), progress: 0 };

  const latitudeScale = 110.574;
  const longitudeScale = 111.32 * Math.cos(radians(point.latitude));
  let closest = Number.POSITIVE_INFINITY;
  let closestProgress = 0;
  let traveled = 0;
  let routeLength = 0;

  const segmentLengths = route.slice(1).map((end, index) => {
    const length = haversineKm(route[index]!, end);
    routeLength += length;
    return length;
  });

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1]!;
    const end = route[index]!;
    const startX = (start.longitude - point.longitude) * longitudeScale;
    const startY = (start.latitude - point.latitude) * latitudeScale;
    const endX = (end.longitude - point.longitude) * longitudeScale;
    const endY = (end.latitude - point.latitude) * latitudeScale;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const projection = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(startX * segmentX + startY * segmentY) / segmentLengthSquared));
    const closestX = startX + projection * segmentX;
    const closestY = startY + projection * segmentY;
    const segmentDistance = Math.hypot(closestX, closestY);
    if (segmentDistance < closest) {
      closest = segmentDistance;
      closestProgress = routeLength === 0 ? 0 : (traveled + segmentLengths[index - 1]! * projection) / routeLength;
    }
    traveled += segmentLengths[index - 1]!;
  }

  return { distanceKm: closest, progress: closestProgress };
}

export function recommendNearbyCaches(
  candidates: TravelCandidate[],
  center: Coordinate,
  radiusKm: number,
  includeFound: boolean,
  limit = 100
): RankedTravelCandidate[] {
  return rankCandidates(candidates, (candidate) => haversineKm(candidate, center), radiusKm, includeFound, limit);
}

export function recommendRouteCaches(
  candidates: TravelCandidate[],
  route: Coordinate[],
  corridorKm: number,
  includeFound: boolean,
  limit = 100
): RankedTravelCandidate[] {
  return candidates
    .filter((candidate) => includeFound || !candidate.found)
    .map((candidate) => {
      const closest = closestRoutePoint(candidate, route);
      return { ...candidate, distanceKm: closest.distanceKm, routeProgress: closest.progress };
    })
    .filter((candidate) => Number.isFinite(candidate.distanceKm) && candidate.distanceKm <= corridorKm)
    .sort((first, second) => first.routeProgress - second.routeProgress
      || first.distanceKm - second.distanceKm
      || first.gcCode.localeCompare(second.gcCode))
    .slice(0, limit)
    .map((candidate) => ({ ...candidate, distanceKm: Math.round(candidate.distanceKm * 10) / 10 }));
}

function rankCandidates(
  candidates: TravelCandidate[],
  distance: (candidate: TravelCandidate) => number,
  maximumDistanceKm: number,
  includeFound: boolean,
  limit: number
) {
  return candidates
    .filter((candidate) => includeFound || !candidate.found)
    .map((candidate) => ({ ...candidate, distanceKm: distance(candidate) }))
    .filter((candidate) => Number.isFinite(candidate.distanceKm) && candidate.distanceKm <= maximumDistanceKm)
    .sort((first, second) => Number(first.found) - Number(second.found)
      || first.distanceKm - second.distanceKm
      || first.gcCode.localeCompare(second.gcCode))
    .slice(0, limit)
    .map((candidate) => ({ ...candidate, distanceKm: Math.round(candidate.distanceKm * 10) / 10 }));
}
