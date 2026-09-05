import { BadGatewayException, Injectable, NotFoundException } from "@nestjs/common";
import { envOrDefault } from "../common/env";
import { PrismaService } from "../common/prisma.service";
import {
  recommendNearbyCaches,
  recommendRouteCaches,
  mergeTravelCandidates,
  type Coordinate,
  type TravelCandidate
} from "./travel-recommendations";
import { placeSuggestionsFromPhoton, type PlaceSuggestion } from "./place-suggestions";

type Place = Coordinate & { label: string };
type RouteResult = {
  coordinates: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  originalCoordinateCount: number;
  coordinatesTruncated: boolean;
};
type GeographicBounds = {
  minimumLatitude: number;
  maximumLatitude: number;
  minimumLongitude?: number;
  maximumLongitude?: number;
};

const MAX_CACHE_POOL = 5000;
const MAX_RECOMMENDATIONS = 100;
const MAX_ROUTE_POINTS = 2000;
const geocodeCache = new Map<string, Place>();
const suggestionCache = new Map<string, PlaceSuggestion[]>();
let geocodeQueue: Promise<void> = Promise.resolve();
let lastGeocodeStartedAt = 0;
let suggestionQueue: Promise<void> = Promise.resolve();
let lastSuggestionStartedAt = 0;

function publicHeaders() {
  const webOrigin = envOrDefault("WEB_ORIGIN", "http://localhost:3000");
  return {
    "User-Agent": "Geostats/0.1 (travel planner)",
    Referer: webOrigin,
    Accept: "application/json"
  };
}

export function travelSearchBounds(coordinates: Coordinate[], paddingKm: number): GeographicBounds {
  const latitudes = coordinates.map(({ latitude }) => latitude);
  const longitudes = coordinates.map(({ longitude }) => longitude);
  const minimumLatitude = Math.max(-90, Math.min(...latitudes) - paddingKm / 110.574);
  const maximumLatitude = Math.min(90, Math.max(...latitudes) + paddingKm / 110.574);
  const furthestLatitude = Math.max(Math.abs(minimumLatitude), Math.abs(maximumLatitude));
  const longitudeKm = 111.32 * Math.cos(furthestLatitude * Math.PI / 180);
  const longitudePadding = longitudeKm > 0.01 ? paddingKm / longitudeKm : 180;
  const rawMinimumLongitude = Math.min(...longitudes) - longitudePadding;
  const rawMaximumLongitude = Math.max(...longitudes) + longitudePadding;
  const crossesDateLine = rawMinimumLongitude < -180 || rawMaximumLongitude > 180
    || rawMaximumLongitude - rawMinimumLongitude >= 360;
  return {
    minimumLatitude,
    maximumLatitude,
    minimumLongitude: crossesDateLine ? undefined : rawMinimumLongitude,
    maximumLongitude: crossesDateLine ? undefined : rawMaximumLongitude
  };
}

export function sampleRouteCoordinates(coordinates: Coordinate[], maximum = MAX_ROUTE_POINTS): Coordinate[] {
  if (coordinates.length <= maximum) return coordinates;
  if (maximum < 2) throw new RangeError("A sampled route must retain both endpoints");
  return Array.from({ length: maximum }, (_, index) => coordinates[Math.round(index * (coordinates.length - 1) / (maximum - 1))]!);
}

async function queuedGeocodeFetch(url: URL) {
  let releaseQueue!: () => void;
  const previous = geocodeQueue;
  geocodeQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previous;
  const waitMs = Math.max(0, 1100 - (Date.now() - lastGeocodeStartedAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastGeocodeStartedAt = Date.now();
  try {
    return await fetch(url, { headers: publicHeaders(), signal: AbortSignal.timeout(15_000) });
  } finally {
    releaseQueue();
  }
}

async function queuedSuggestionFetch(url: URL) {
  let releaseQueue!: () => void;
  const previous = suggestionQueue;
  suggestionQueue = new Promise<void>((resolve) => { releaseQueue = resolve; });
  await previous;
  const waitMs = Math.max(0, 250 - (Date.now() - lastSuggestionStartedAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastSuggestionStartedAt = Date.now();
  try {
    return await fetch(url, { headers: publicHeaders(), signal: AbortSignal.timeout(10_000) });
  } finally {
    releaseQueue();
  }
}

async function geocode(query: string): Promise<Place> {
  const cacheKey = query.trim().toLocaleLowerCase();
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  let response: Response;
  try {
    response = await queuedGeocodeFetch(url);
  } catch {
    throw new BadGatewayException("Place search is temporarily unavailable. Try again in a moment.");
  }
  if (!response.ok) throw new BadGatewayException("Place search is temporarily unavailable. Try again in a moment.");
  const results = await response.json() as Array<{ display_name?: unknown; lat?: unknown; lon?: unknown }>;
  const result = results[0];
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);
  if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new NotFoundException(`Could not find “${query}”. Add a town, region, or country and try again.`);
  }
  const place = { label: String(result.display_name ?? query), latitude, longitude };
  if (geocodeCache.size >= 200) geocodeCache.delete(geocodeCache.keys().next().value as string);
  geocodeCache.set(cacheKey, place);
  return place;
}

async function roadRoute(origin: Place, destination: Place): Promise<RouteResult> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coordinates}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");

  let response: Response;
  try {
    response = await fetch(url, { headers: publicHeaders(), signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new BadGatewayException("Road routing is temporarily unavailable. Try again in a moment.");
  }
  if (!response.ok) throw new BadGatewayException("Road routing is temporarily unavailable. Try again in a moment.");
  const body = await response.json() as {
    code?: string;
    routes?: Array<{
      distance?: unknown;
      duration?: unknown;
      geometry?: { coordinates?: Array<[unknown, unknown]> };
    }>;
  };
  const route = body.routes?.[0];
  const routeCoordinates = (route?.geometry?.coordinates ?? []).flatMap(([longitude, latitude]) => {
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);
    return Number.isFinite(parsedLatitude) && Number.isFinite(parsedLongitude)
      ? [{ latitude: parsedLatitude, longitude: parsedLongitude }]
      : [];
  });
  if (body.code !== "Ok" || routeCoordinates.length < 2) {
    throw new NotFoundException("No driving route was found between those places.");
  }
  const coordinatesTruncated = routeCoordinates.length > MAX_ROUTE_POINTS;
  return {
    coordinates: sampleRouteCoordinates(routeCoordinates),
    distanceMeters: Number(route?.distance ?? 0),
    durationSeconds: Number(route?.duration ?? 0),
    originalCoordinateCount: routeCoordinates.length,
    coordinatesTruncated
  };
}

@Injectable()
export class TravelSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async poolSummary(userId: string) {
    const records = await this.prisma.userCacheData.findMany({
      where: {
        userId,
        cache: { hides: { none: { userId } } }
      },
      select: {
        cache: {
          select: {
            cacheType: true,
            finds: { where: { userId }, select: { id: true }, take: 1 }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MAX_CACHE_POOL + 1
    });
    const poolTruncated = records.length > MAX_CACHE_POOL;
    const pool = records.slice(0, MAX_CACHE_POOL);
    const typeCounts = new Map<string, number>();
    let found = 0;
    for (const { cache } of pool) {
      const type = cache.cacheType?.trim() || "Unknown type";
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (cache.finds.length) found += 1;
    }
    const types = [...typeCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

    return {
      total: pool.length,
      found,
      unfound: pool.length - found,
      poolTruncated,
      types
    };
  }

  async suggestPlaces(userId: string, query: string) {
    const normalized = query.trim().toLocaleLowerCase();
    const cacheKey = `${userId}:${normalized}`;
    const cached = suggestionCache.get(cacheKey);
    if (cached) return { suggestions: cached };

    const url = new URL("https://photon.komoot.io/api");
    url.searchParams.set("q", query.trim());
    url.searchParams.set("limit", "6");
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { homeLatitude: true, homeLongitude: true }
    });
    if (profile?.homeLatitude !== null && profile?.homeLatitude !== undefined
      && profile.homeLongitude !== null && profile.homeLongitude !== undefined) {
      url.searchParams.set("lat", String(Number(profile.homeLatitude)));
      url.searchParams.set("lon", String(Number(profile.homeLongitude)));
      url.searchParams.set("zoom", "5");
      url.searchParams.set("location_bias_scale", "0.15");
    }

    let response: Response;
    try {
      response = await queuedSuggestionFetch(url);
    } catch {
      throw new BadGatewayException("Place suggestions are temporarily unavailable.");
    }
    if (!response.ok) throw new BadGatewayException("Place suggestions are temporarily unavailable.");
    const suggestions = placeSuggestionsFromPhoton(await response.json()).slice(0, 6);
    if (suggestionCache.size >= 300) suggestionCache.delete(suggestionCache.keys().next().value as string);
    suggestionCache.set(cacheKey, suggestions);
    return { suggestions };
  }

  async search(userId: string, input: {
    mode: "nearby" | "route";
    origin: string;
    destination?: string;
    radiusKm: number;
    includeFound: boolean;
    mysteryCaches: Array<{
      id: string;
      gcCode: string;
      name: string;
      latitude: number;
      longitude: number;
      country?: string;
      region?: string;
      county?: string;
    }>;
    originPlace?: Place;
    destinationPlace?: Place;
  }) {
    const origin = input.originPlace ?? await geocode(input.origin);
    const destination = input.mode === "route"
      ? input.destinationPlace ?? await geocode(input.destination!)
      : undefined;
    const route = destination ? await roadRoute(origin, destination) : undefined;
    const bounds = travelSearchBounds(route?.coordinates ?? [origin], input.radiusKm);
    const latitude = { gte: bounds.minimumLatitude, lte: bounds.maximumLatitude };
    const longitude = bounds.minimumLongitude === undefined || bounds.maximumLongitude === undefined
      ? undefined
      : { gte: bounds.minimumLongitude, lte: bounds.maximumLongitude };
    const records = await this.prisma.userCacheData.findMany({
      where: {
        userId,
        cache: {
          hides: { none: { userId } },
          OR: [
            { latitude, ...(longitude ? { longitude } : {}) },
            { corrections: { some: { userId, latitude, ...(longitude ? { longitude } : {}) } } }
          ]
        }
      },
      select: {
        cache: {
          select: {
            id: true,
            gcCode: true,
            name: true,
            cacheType: true,
            difficulty: true,
            terrain: true,
            size: true,
            latitude: true,
            longitude: true,
            country: true,
            region: true,
            county: true,
            finds: { where: { userId }, select: { id: true }, take: 1 },
            corrections: { where: { userId }, select: { latitude: true, longitude: true }, take: 1 }
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: MAX_CACHE_POOL + 1
    });
    const poolTruncated = records.length > MAX_CACHE_POOL;
    const importedCandidates: TravelCandidate[] = records.slice(0, MAX_CACHE_POOL).map(({ cache }) => {
      const correction = cache.corrections[0];
      return {
        id: cache.id,
        gcCode: cache.gcCode,
        name: cache.name,
        cacheType: cache.cacheType,
        difficulty: cache.difficulty === null ? null : Number(cache.difficulty),
        terrain: cache.terrain === null ? null : Number(cache.terrain),
        size: cache.size,
        latitude: Number(correction?.latitude ?? cache.latitude),
        longitude: Number(correction?.longitude ?? cache.longitude),
        country: cache.country,
        region: cache.region,
        county: cache.county,
        found: cache.finds.length > 0,
        source: "imported"
      };
    });
    const mysteryCandidates: TravelCandidate[] = input.mysteryCaches.map((cache) => ({
      ...cache,
      cacheType: "Mystery Cache",
      difficulty: null,
      terrain: null,
      size: null,
      country: cache.country ?? null,
      region: cache.region ?? null,
      county: cache.county ?? null,
      found: false,
      source: "mystery"
    }));
    const candidates = mergeTravelCandidates(importedCandidates, mysteryCandidates);
    const recommendations = route
      ? recommendRouteCaches(candidates, route.coordinates, input.radiusKm, input.includeFound, MAX_RECOMMENDATIONS)
      : recommendNearbyCaches(candidates, origin, input.radiusKm, input.includeFound, MAX_RECOMMENDATIONS);

    return {
      mode: input.mode,
      origin,
      destination,
      route: route ? {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        geometryPointCount: route.coordinates.length,
        originalGeometryPointCount: route.originalCoordinateCount,
        geometryTruncated: route.coordinatesTruncated
      } : undefined,
      recommendations,
      importedCacheCount: importedCandidates.length,
      mysteryCacheCount: mysteryCandidates.length,
      searchedCacheCount: candidates.length,
      poolTruncated,
      resultLimit: MAX_RECOMMENDATIONS,
      attribution: {
        places: "© OpenStreetMap contributors",
        routing: route ? "Routing by OSRM" : undefined
      }
    };
  }
}
