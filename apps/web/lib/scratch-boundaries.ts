import type { CacheMapPoint } from "../components/cache-map";
import { isUnknownLocationName } from "./scratch-boundary-config";

type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];

type BoundaryFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoordinates | MultiPolygonCoordinates;
  };
};

type BoundaryFeatureCollection = {
  type: "FeatureCollection";
  features: BoundaryFeature[];
};

const boundaryGeoJsonCache = new Map<string, Promise<BoundaryFeatureCollection>>();

function loadBoundaryGeoJson(url: string) {
  const existing = boundaryGeoJsonCache.get(url);
  if (existing) {
    return existing;
  }

  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("Could not load boundary data");
      }
      return (await response.json()) as BoundaryFeatureCollection;
    })
    .catch((error: unknown) => {
      boundaryGeoJsonCache.delete(url);
      throw error;
    });
  boundaryGeoJsonCache.set(url, request);
  return request;
}

function pointInRing(longitude: number, latitude: number, ring: Position[]) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLongitude, currentLatitude] = ring[current] ?? [0, 0];
    const [previousLongitude, previousLatitude] = ring[previous] ?? [0, 0];
    const crosses =
      currentLatitude > latitude !== previousLatitude > latitude &&
      longitude <
        ((previousLongitude - currentLongitude) * (latitude - currentLatitude)) /
          (previousLatitude - currentLatitude || Number.EPSILON) +
          currentLongitude;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(longitude: number, latitude: number, polygon: PolygonCoordinates) {
  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(longitude, latitude, outerRing)) {
    return false;
  }
  return !holes.some((hole) => pointInRing(longitude, latitude, hole));
}

function pointInFeature(longitude: number, latitude: number, feature: BoundaryFeature) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as PolygonCoordinates]
      : (feature.geometry.coordinates as MultiPolygonCoordinates);

  return polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
}

export async function deriveBucketsFromBoundaries(points: CacheMapPoint[], url: string, propertyName: string) {
  const geoJson = await loadBoundaryGeoJson(url);
  const counts = new Map<string, number>();

  for (const point of points) {
    const feature = geoJson.features.find((candidate) => pointInFeature(point.longitude, point.latitude, candidate));
    const name = String(feature?.properties[propertyName] ?? "").trim();
    if (!isUnknownLocationName(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export async function boundaryNames(url: string, propertyName: string) {
  const geoJson = await loadBoundaryGeoJson(url);
  return [...new Set(geoJson.features.map((feature) => String(feature.properties[propertyName] ?? "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
}
