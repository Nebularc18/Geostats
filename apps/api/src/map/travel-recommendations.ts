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
  hiddenDate?: string | null;
  fillsGaps?: string[];
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

export function prepareTravelRoute(route: Coordinate[]) {
  const segmentLengths = route.slice(1).map((end, index) => haversineKm(route[index]!, end));
  return { route, segmentLengths, routeLength: segmentLengths.reduce((total, length) => total + length, 0) };
}

type PreparedRoute = ReturnType<typeof prepareTravelRoute>;

function closestRoutePoint(point: Coordinate, { route, segmentLengths, routeLength }: PreparedRoute) {
  if (route.length === 0) return { distanceKm: Number.POSITIVE_INFINITY, progress: 0 };
  if (route.length === 1) return { distanceKm: haversineKm(point, route[0]!), progress: 0 };

  const latitudeScale = 110.574;
  const longitudeScale = 111.32 * Math.cos(radians(point.latitude));
  let closest = Number.POSITIVE_INFINITY;
  let closestProgress = 0;
  let traveled = 0;

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

export function compareTravelCandidates(first: RankedTravelCandidate, second: RankedTravelCandidate) {
  if (first.routeProgress !== undefined && second.routeProgress !== undefined) {
    return first.routeProgress - second.routeProgress || first.distanceKm - second.distanceKm || first.gcCode.localeCompare(second.gcCode);
  }
  return Number(first.found) - Number(second.found) || first.distanceKm - second.distanceKm || first.gcCode.localeCompare(second.gcCode);
}

export function roundTravelCandidate(candidate: RankedTravelCandidate) {
  return { ...candidate, distanceKm: Math.round(candidate.distanceKm * 10) / 10 };
}

export function rankTravelCandidates(
  candidates: TravelCandidate[],
  origin: Coordinate,
  radiusKm: number,
  includeFound: boolean,
  route?: PreparedRoute
): RankedTravelCandidate[] {
  return candidates.flatMap((candidate) => {
    if (!includeFound && candidate.found) return [];
    const closest = route ? closestRoutePoint(candidate, route) : undefined;
    const distanceKm = closest?.distanceKm ?? haversineKm(candidate, origin);
    if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) return [];
    return [{ ...candidate, distanceKm, ...(closest && { routeProgress: closest.progress }) }];
  }).sort(compareTravelCandidates);
}

export function recommendNearbyCaches(
  candidates: TravelCandidate[],
  center: Coordinate,
  radiusKm: number,
  includeFound: boolean,
  limit = 100
) {
  return rankTravelCandidates(candidates, center, radiusKm, includeFound).slice(0, limit).map(roundTravelCandidate);
}

export function recommendRouteCaches(
  candidates: TravelCandidate[],
  route: Coordinate[],
  corridorKm: number,
  includeFound: boolean,
  limit = 100
) {
  return rankTravelCandidates(candidates, route[0] ?? { latitude: 0, longitude: 0 }, corridorKm, includeFound, prepareTravelRoute(route))
    .slice(0, limit).map(roundTravelCandidate);
}
