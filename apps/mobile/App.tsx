import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import MapView, { Callout, Marker, Polygon, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

type CountBucket = { key: string; count: number };
type LocationBucket = { name: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type CachePoint = { id: string; gcCode: string; name: string; cacheType: string | null; latitude: number; longitude: number; foundAt?: string; placedAt?: string; isOwnHide?: boolean };
type ImportListItem = { id: string; fileName: string; source: string; status: string; createdAt: string; errorMessage: string | null };
type AuthConfig = { mode: "dev" | "external" | "password"; providerName: string };
type ScratchLevel = "countries" | "regions" | "counties";
type ScreenId = "dashboard" | "stats" | "map" | "scratch" | "milestones" | "ftf" | "hides" | "upload" | "imports" | "profile";
type Session = { token: string; user: { id: string; email: string; username: string } };
type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];
type BoundaryFeature = {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: PolygonCoordinates | MultiPolygonCoordinates };
};
type BoundaryFeatureCollection = { type: "FeatureCollection"; features: BoundaryFeature[] };

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://10.0.2.2:3001" : "");
const ANDROID_MAP_PROVIDER = Platform.OS === "android" ? PROVIDER_GOOGLE : undefined;
const TOKEN_KEY = "geostats_session";
const SERVER_URL_KEY = "geostats_server_url";
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const defaultTimeZone = "Europe/Stockholm";
const defaultFtfTerms = ["FTF", "first to find"];
const badgeTiers = ["Bronze", "Silver", "Gold", "Platinum", "Ruby", "Sapphire", "Emerald", "Diamond"];
const ACTIVE_IMPORT_STATUSES = new Set(["UPLOADED", "QUEUED", "PROCESSING"]);
const COUNTRY_GEOJSON_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
const SWEDEN_REGION_GEOJSON_URL = "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_regions.geojson";
const SWEDEN_COUNTY_GEOJSON_URL = "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_municipalities.geojson";
const ICELAND_REGION_GEOJSON_URL =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen/ISL/ADM1/geoBoundaries-ISL-ADM1_simplified.geojson";
const ICELAND_COUNTY_GEOJSON_URL =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen/ISL/ADM2/geoBoundaries-ISL-ADM2_simplified.geojson";
const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  "United States": ["United States of America"],
  "Russia": ["Russian Federation"],
  "South Korea": ["Republic of Korea"],
  "North Korea": ["Democratic People's Republic of Korea"],
  "Czech Republic": ["Czechia"],
  "Czechia": ["Czech Republic"],
  "United Kingdom": ["United Kingdom of Great Britain and Northern Ireland"],
  "Vietnam": ["Viet Nam"],
  "Iran": ["Iran (Islamic Republic of)"],
  "Moldova": ["Republic of Moldova"],
  "Tanzania": ["United Republic of Tanzania"],
  "Syria": ["Syrian Arab Republic"],
  "Bolivia": ["Bolivia (Plurinational State of)"],
  "Venezuela": ["Venezuela (Bolivarian Republic of)"]
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const screens: Array<{ id: ScreenId; label: string }> = [
  { id: "dashboard", label: "Home" },
  { id: "stats", label: "Stats" },
  { id: "map", label: "Map" },
  { id: "scratch", label: "Scratch" },
  { id: "milestones", label: "Marks" },
  { id: "ftf", label: "FTF" },
  { id: "hides", label: "Hides" },
  { id: "upload", label: "Upload" },
  { id: "imports", label: "Imports" },
  { id: "profile", label: "Profile" }
];

function normalizeServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && !isLocalDevelopmentUrl(url)) {
    throw new Error("Use HTTPS for remote API servers. HTTP is only allowed for local development hosts.");
  }
  return url.toString().replace(/\/+$/, "");
}

function normalizeStoredServerUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_API_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).toString().replace(/\/+$/, "");
}

function isLocalDevelopmentUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1" || host === "10.0.2.2");
}

function sameOrigin(left: string, right: string) {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function confirmServerChange(currentUrl: string, nextUrl: string): Promise<boolean> {
  if (sameOrigin(currentUrl, nextUrl)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      "Switch API server?",
      "Your session token is only sent after you sign in again on the new server.",
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Continue", style: "destructive", onPress: () => resolve(true) }
      ]
    );
  });
}

function requireServerUrl(value: string) {
  const normalized = normalizeServerUrl(value);
  if (!normalized) {
    throw new Error("Enter your public API URL before signing in.");
  }
  return normalized;
}

async function apiFetch<T>(baseUrl: string, path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(body.message ?? "Request failed", response.status);
  }
  return response.json() as Promise<T>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return response.json() as Promise<T>;
}

function text(value: unknown, fallback = "0") {
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  if (typeof value === "string") return value;
  return fallback;
}

function dateText(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function latestTwelveMonths(findsByMonth: CountBucket[] = []) {
  const countByMonth = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
  const lastKey = findsByMonth.at(-1)?.key ?? monthKey(new Date());
  const [year, month] = lastKey.split("-").map(Number);
  const lastMonth = new Date(Date.UTC(year, month - 1, 1));
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + index - 11, 1));
    const key = monthKey(date);
    return { key: `${monthLabels[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`, count: countByMonth.get(key) ?? 0 };
  });
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed) : null;
}

function hasActiveImports(imports: ImportListItem[]) {
  return imports.some((item) => ACTIVE_IMPORT_STATUSES.has(item.status));
}

function powerShellString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function hidesCommand(baseUrl: string, token: string, csv = false) {
  const parts = [`$env:GEOSTATS_COLLECTOR_TOKEN=${powerShellString(token)}`];
  if (csv) parts.push("$env:GEOSTATS_COLLECTOR_NO_UPLOAD='1'");
  parts.push(`irm ${powerShellString(`${baseUrl}/collector/hides.ps1`)} | iex`);
  return parts.join("; ");
}

function mixColor(start: string, end: string, amount: number) {
  const normalized = Math.max(0, Math.min(1, amount));
  const startRgb = start.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const endRgb = end.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const mixed = startRgb.map((channel, index) => Math.round(channel + ((endRgb[index] ?? channel) - channel) * normalized));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function scratchColor(count: number, max: number) {
  if (count <= 0 || max <= 0) return "#263c2d";
  const intensity = Math.log1p(count) / Math.log1p(max);
  return mixColor("#dce88d", "#1f6f3b", intensity);
}

function countForBucket(buckets: CountBucket[] | undefined, names: string[]) {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  return (buckets ?? []).reduce((sum, bucket) => normalized.has(bucket.key.toLowerCase()) ? sum + bucket.count : sum, 0);
}

function uniqueDifficultyTerrain(cells: Array<{ difficulty: number; terrain: number }> | undefined) {
  return new Set((cells ?? []).map((cell) => `${cell.difficulty}/${cell.terrain}`)).size;
}

function countDifficultyTerrain(cells: Array<{ difficulty: number; terrain: number; count: number }> | undefined, difficulty?: number, terrain?: number) {
  return (cells ?? []).reduce((sum, cell) => {
    const matchesDifficulty = difficulty == null || cell.difficulty === difficulty;
    const matchesTerrain = terrain == null || cell.terrain === terrain;
    return matchesDifficulty && matchesTerrain ? sum + cell.count : sum;
  }, 0);
}

type MobileBadge = { id: string; name: string; metric: string; current: number | null; thresholds: number[] };

function mobileBadges(stats: any): MobileBadge[] {
  const typeBuckets = stats.cacheTypes ?? [];
  const sizeBuckets = stats.sizes ?? [];
  const difficultyTerrain = stats.difficultyTerrain ?? [];
  const achievementStats = stats.achievementStats ?? {};
  const distanceStats = stats.distanceStats ?? {};
  return [
    { id: "long-distance", name: "The Long-Distance Cacher", metric: "Farthest cache from home", current: achievementStats.maxDistanceKm ?? distanceStats.maxDistanceKm ?? null, thresholds: [1000, 1200, 1500, 2000, 2900, 4200, 6400, 10000] },
    { id: "attribute", name: "The Attribute Cacher", metric: "Distinct attributes", current: achievementStats.distinctAttributes ?? null, thresholds: [50, 70, 82, 88, 94, 100, 105, 108] },
    { id: "diverse", name: "The Diverse Cacher", metric: "Distinct cache types in a day", current: achievementStats.maxCacheTypesInDay ?? null, thresholds: [3, 4, 6, 7, 8, 9, 10, 11] },
    { id: "geocacher", name: "The Geocacher", metric: "Total finds", current: stats.totalFinds ?? 0, thresholds: [500, 1000, 2000, 3000, 5000, 8000, 12000, 18000] },
    { id: "calendar", name: "The Calendar Cacher", metric: "Calendar days", current: stats.foundDateMatrix?.length ?? 0, thresholds: [90, 150, 220, 280, 330, 350, 365, 366] },
    { id: "busy", name: "The Busy Cacher", metric: "Best day", current: stats.summaryNumbers?.bestDay?.count ?? 0, thresholds: [20, 30, 50, 80, 120, 180, 270, 400] },
    { id: "daily", name: "The Daily Cacher", metric: "Longest streak", current: stats.streaks?.longest ?? 0, thresholds: [7, 14, 30, 60, 122, 183, 274, 365] },
    { id: "matrix", name: "The Matrix Cacher", metric: "D/T combinations", current: Math.max(stats.wayTo81?.length ?? 0, uniqueDifficultyTerrain(difficultyTerrain)), thresholds: [25, 35, 50, 60, 70, 78, 80, 81] },
    { id: "jasmer", name: "The Jasmer Cacher", metric: "Hidden months", current: stats.hiddenMonthMatrix?.length ?? 0, thresholds: [36, 72, 144, 216, 283, 298, 308, 313] },
    { id: "traveling", name: "The Traveling Cacher", metric: "Countries", current: stats.countries?.length ?? 0, thresholds: [2, 3, 5, 8, 12, 18, 25, 35] },
    { id: "veteran", name: "The Caching Veteran", metric: "Caching years", current: stats.findsByYear?.length ?? 0, thresholds: [2, 3, 4, 5, 6, 7, 8, 10] },
    { id: "traditional", name: "The Traditional Cacher", metric: "Traditional caches", current: countForBucket(typeBuckets, ["traditional cache", "traditional"]), thresholds: [400, 1000, 2000, 3000, 5000, 7000, 10000, 14000] },
    { id: "multi", name: "The Multi Cacher", metric: "Multi caches", current: countForBucket(typeBuckets, ["multi-cache", "multi cache", "multi"]), thresholds: [50, 100, 200, 300, 500, 800, 1000, 1200] },
    { id: "mystery", name: "The Mysterious Cacher", metric: "Mystery caches", current: countForBucket(typeBuckets, ["mystery cache", "unknown cache", "mystery/unknown cache", "mystery"]), thresholds: [50, 100, 200, 300, 500, 800, 1200, 1800] },
    { id: "letterboxer", name: "The Letterboxer", metric: "Letterbox Hybrid caches", current: countForBucket(typeBuckets, ["letterbox hybrid", "letterbox"]), thresholds: [5, 6, 7, 8, 10, 15, 25, 50] },
    { id: "earth", name: "The Earth Cacher", metric: "EarthCaches", current: countForBucket(typeBuckets, ["earthcache", "earth cache"]), thresholds: [5, 10, 20, 30, 50, 80, 120, 180] },
    { id: "wherigo", name: "The Wherigo Cacher", metric: "Wherigo caches", current: countForBucket(typeBuckets, ["wherigo cache", "wherigo"]), thresholds: [2, 3, 5, 10, 15, 25, 40, 60] },
    { id: "virtual", name: "The Virtual Cacher", metric: "Virtual caches", current: countForBucket(typeBuckets, ["virtual cache", "virtual"]), thresholds: [5, 10, 20, 30, 50, 80, 120, 180] },
    { id: "photogenic", name: "The Photogenic Cacher", metric: "Webcam caches", current: countForBucket(typeBuckets, ["webcam cache", "webcam"]), thresholds: [2, 3, 5, 8, 12, 18, 25, 40] },
    { id: "event", name: "The Social Cacher", metric: "Event caches", current: countForBucket(typeBuckets, ["event cache", "event"]), thresholds: [5, 10, 20, 30, 50, 80, 120, 180] },
    { id: "environmental", name: "The Environmental Cacher", metric: "CITO events", current: countForBucket(typeBuckets, ["cache in trash out event", "cito event", "cito"]), thresholds: [2, 3, 4, 5, 6, 8, 10, 12] },
    { id: "mega-social", name: "The Mega Social Cacher", metric: "Mega Event caches", current: countForBucket(typeBuckets, ["mega-event cache", "mega event cache", "mega"]), thresholds: [1, 2, 3, 4, 5, 6, 8, 10] },
    { id: "giga-social", name: "The Giga Social Cacher", metric: "Giga Event caches", current: countForBucket(typeBuckets, ["giga-event cache", "giga event cache", "giga"]), thresholds: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: "gps-maze", name: "The GPS Maze Cacher", metric: "GPS Maze caches", current: countForBucket(typeBuckets, ["gps adventures exhibit", "gps maze exhibit", "gps maze"]), thresholds: [1, 2, 3, 4, 5, 6, 7, 8] },
    { id: "challenge", name: "The Achiever", metric: "Challenge caches", current: countForBucket(typeBuckets, ["challenge cache", "challenge"]), thresholds: [5, 20, 40, 80, 150, 225, 350, 500] },
    { id: "odd-sized", name: "The Odd-sized Cacher", metric: "Other/Unknown size caches", current: countForBucket(sizeBuckets, ["other", "not chosen", "unknown", "other/unknown"]), thresholds: [75, 125, 200, 300, 450, 600, 800, 1200] },
    { id: "micro", name: "The Micro Cacher", metric: "Micro caches", current: countForBucket(sizeBuckets, ["micro"]), thresholds: [200, 300, 500, 800, 1200, 1800, 3000, 4500] },
    { id: "small", name: "The Small Cacher", metric: "Small caches", current: countForBucket(sizeBuckets, ["small"]), thresholds: [150, 200, 300, 500, 800, 1200, 1800, 3000] },
    { id: "regular", name: "The Regular Cacher", metric: "Regular caches", current: countForBucket(sizeBuckets, ["regular"]), thresholds: [100, 150, 225, 350, 550, 800, 1200, 1600] },
    { id: "large", name: "The Large Cacher", metric: "Large caches", current: countForBucket(sizeBuckets, ["large"]), thresholds: [3, 10, 20, 40, 60, 80, 120, 180] },
    { id: "brainiac", name: "The Brainiac", metric: "D5 finds", current: countDifficultyTerrain(difficultyTerrain, 5), thresholds: [2, 4, 6, 10, 15, 30, 50, 100] },
    { id: "adventurous", name: "The Adventurous Cacher", metric: "D5/T5 finds", current: countDifficultyTerrain(difficultyTerrain, 5, 5), thresholds: [1, 2, 3, 5, 8, 12, 18, 30] },
    { id: "rugged", name: "The Rugged Cacher", metric: "T5 finds", current: countDifficultyTerrain(difficultyTerrain, undefined, 5), thresholds: [5, 10, 20, 30, 50, 70, 100, 150] },
    { id: "all-around", name: "The All Around Cacher", metric: "Bearing degrees", current: distanceStats.bearingBuckets?.filter((bucket: PercentBucket) => bucket.count > 0).length ?? 0, thresholds: [90, 120, 180, 270, 300, 330, 350, 360] },
    { id: "ftf", name: "The FTF Addict", metric: "First-to-Finds", current: stats.ftfStats?.total ?? 0, thresholds: [15, 20, 30, 50, 80, 120, 180, 300] },
    { id: "trackable", name: "The Trackable Lover", metric: "Discovered Trackables", current: null, thresholds: [50, 100, 200, 300, 500, 800, 1200, 1800] },
    { id: "author", name: "The Author", metric: "Long logs written", current: achievementStats.longLogsWritten ?? null, thresholds: [30, 40, 50, 60, 70, 80, 90, 100] },
    { id: "owner", name: "The Cache Owner", metric: "Hidden caches", current: stats.hideStats?.totalHides ?? 0, thresholds: [10, 15, 20, 30, 50, 80, 120, 200] },
    { id: "favorited-owner", name: "The Favorited Owner", metric: "Favorite points received", current: stats.hideStats?.totalFavoritePoints ?? 0, thresholds: [25, 40, 60, 90, 150, 210, 320, 500] },
    { id: "event-host", name: "The Event Host", metric: "Hosted event caches", current: achievementStats.hostedEventCaches ?? stats.hideStats?.hostedEventCaches ?? null, thresholds: [1, 2, 3, 5, 8, 12, 18, 30] }
  ];
}

function achievedIndex(badge: MobileBadge) {
  if (badge.current == null) return -1;
  return badge.thresholds.reduce((latest, threshold, index) => badge.current! >= threshold ? index : latest, -1);
}

function remainingForBadge(badge: MobileBadge) {
  if (badge.current == null) return "Needs data";
  const next = badge.thresholds[achievedIndex(badge) + 1];
  return next == null ? "Done" : String(Math.max(0, Math.ceil(next - badge.current)));
}

function getCacheTypeColor(cacheType?: string | null, isOwnHide?: boolean) {
  if (isOwnHide) return "#64d2a4";
  const normalized = cacheType?.toLowerCase() ?? "";
  if (normalized.includes("traditional")) return "#4ec878";
  if (normalized.includes("multi")) return "#f3b34d";
  if (normalized.includes("mystery") || normalized.includes("unknown")) return "#7ca8ff";
  if (normalized.includes("earth")) return "#c4975a";
  if (normalized.includes("event")) return "#ff8db3";
  if (normalized.includes("virtual")) return "#9dd8ff";
  return "#f3b34d";
}

function validMapPoints(points: CachePoint[]) {
  return points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function regionForPoints(points: CachePoint[]): Region {
  const visible = validMapPoints(points);
  if (visible.length === 0) {
    return { latitude: 59.3293, longitude: 18.0686, latitudeDelta: 18, longitudeDelta: 18 };
  }
  const latitudes = visible.map((point) => point.latitude);
  const longitudes = visible.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.08, (maxLat - minLat) * 1.35),
    longitudeDelta: Math.max(0.08, (maxLng - minLng) * 1.35)
  };
}

function regionForScratch(level: ScratchLevel, selectedCountry?: string | null): Region {
  if (selectedCountry === "Iceland" && level !== "countries") {
    return { latitude: 64.95, longitude: -18.8, latitudeDelta: 5.8, longitudeDelta: 9 };
  }
  if (selectedCountry === "Sweden" && level !== "countries") {
    return { latitude: 62.1, longitude: 15.2, latitudeDelta: 15, longitudeDelta: 17 };
  }
  return { latitude: 24, longitude: 11, latitudeDelta: 140, longitudeDelta: 170 };
}

function boundaryConfig(level: ScratchLevel, selectedCountry?: string | null) {
  if (selectedCountry === "Sweden" && level === "regions") {
    return { url: SWEDEN_REGION_GEOJSON_URL, propertyName: "name" };
  }
  if (selectedCountry === "Sweden" && level === "counties") {
    return { url: SWEDEN_COUNTY_GEOJSON_URL, propertyName: "kom_namn" };
  }
  if (selectedCountry === "Iceland" && level === "regions") {
    return { url: ICELAND_REGION_GEOJSON_URL, propertyName: "shapeName" };
  }
  if (selectedCountry === "Iceland" && level === "counties") {
    return { url: ICELAND_COUNTY_GEOJSON_URL, propertyName: "shapeName" };
  }
  return { url: COUNTRY_GEOJSON_URL, propertyName: "name" };
}

function namesForScratchBucket(bucket: any, level: ScratchLevel) {
  if (level === "countries") {
    return [bucket.name, ...(COUNTRY_NAME_ALIASES[bucket.name] ?? [])];
  }
  return [bucket.name];
}

function sampledRing(ring: Position[], maxPoints = 350) {
  const valid = ring.filter(([longitude, latitude]) =>
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
  if (valid.length <= maxPoints) return valid;
  const step = Math.ceil(valid.length / maxPoints);
  const sampled = valid.filter((_, index) => index % step === 0);
  const last = valid.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function polygonOuterRings(feature: BoundaryFeature, maxPoints = 350) {
  const polygons = feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as PolygonCoordinates]
    : feature.geometry.coordinates as MultiPolygonCoordinates;
  return polygons
    .map((polygon) => polygon[0] ?? [])
    .map((ring) => sampledRing(ring, maxPoints))
    .filter((ring) => ring.length >= 4)
    .map((ring) => ring.map(([longitude, latitude]) => ({ latitude, longitude })));
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
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(longitude: number, latitude: number, polygon: PolygonCoordinates) {
  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(longitude, latitude, outerRing)) return false;
  return !holes.some((hole) => pointInRing(longitude, latitude, hole));
}

function pointInFeature(longitude: number, latitude: number, feature: BoundaryFeature) {
  const polygons = feature.geometry.type === "Polygon"
    ? [feature.geometry.coordinates as PolygonCoordinates]
    : feature.geometry.coordinates as MultiPolygonCoordinates;
  return polygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
}

async function deriveBucketsFromBoundaries(points: CachePoint[], url: string, propertyName: string) {
  const geoJson = await fetchJson<BoundaryFeatureCollection>(url);
  const counts = new Map<string, number>();
  for (const point of validMapPoints(points)) {
    const feature = geoJson.features.find((candidate) => pointInFeature(point.longitude, point.latitude, candidate));
    const name = String(feature?.properties?.[propertyName] ?? "").trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function scratchBucketsForLevel(countries: any[], activeCountry: any, level: ScratchLevel) {
  if (level === "countries") return countries;
  return level === "regions" ? activeCountry?.regions ?? [] : activeCountry?.counties ?? [];
}

function useApi<T>(baseUrl: string, token: string, path: string, fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<T>(baseUrl, path, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load data");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [baseUrl, path, token]);
  return { data, loading, error, refresh };
}

function AuthScreen({ apiBaseUrl, onApiBaseUrlChange, onSession }: { apiBaseUrl: string; onApiBaseUrlChange: (value: string) => void; onSession: (session: Session, baseUrl: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [serverUrl, setServerUrl] = useState(apiBaseUrl);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [config, setConfig] = useState<AuthConfig>({ mode: "password", providerName: "Home Auth" });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const nextUrl = normalizeServerUrl(serverUrl);
        onApiBaseUrlChange(nextUrl);
        setServerUrl(nextUrl);
        if (!nextUrl) {
          setConfig({ mode: "password", providerName: "Home Auth" });
          return;
        }
        void apiFetch<AuthConfig>(nextUrl, "/auth/config", null)
          .then(setConfig)
          .catch(() => setConfig({ mode: "password", providerName: "Home Auth" }));
      } catch {
        setConfig({ mode: "password", providerName: "Home Auth" });
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [serverUrl]);
  async function saveServerUrl(): Promise<string | null> {
    let nextUrl: string;
    try {
      nextUrl = requireServerUrl(serverUrl);
    } catch (error) {
      setMessage(null);
      Alert.alert("Server URL required", error instanceof Error ? error.message : String(error));
      return null;
    }
    const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
    if (savedToken && !(await confirmServerChange(apiBaseUrl, nextUrl))) {
      return null;
    }
    if (savedToken && !sameOrigin(apiBaseUrl, nextUrl)) {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
    onApiBaseUrlChange(nextUrl);
    setServerUrl(nextUrl);
    await SecureStore.setItemAsync(SERVER_URL_KEY, nextUrl);
    return nextUrl;
  }
  async function submit() {
    setMessage("Signing in...");
    try {
      const nextUrl = await saveServerUrl();
      if (!nextUrl) return;
      const data = await apiFetch<Session>(nextUrl, `/auth/mobile/${mode}`, null, {
        method: "POST",
        body: JSON.stringify(mode === "login" ? { email, password } : { email, username, password })
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      onSession(data, nextUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in");
    }
  }
  async function continueDev() {
    setMessage("Signing in...");
    try {
      const nextUrl = await saveServerUrl();
      if (!nextUrl) return;
      const data = await apiFetch<Session>(nextUrl, "/auth/mobile/dev", null);
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      onSession(data, nextUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in");
    }
  }
  async function continueExternal() {
    setMessage(`Opening ${config.providerName}...`);
    try {
      const baseUrl = await saveServerUrl();
      if (!baseUrl) return;
      const redirectUri = process.env.EXPO_PUBLIC_MOBILE_AUTH_REDIRECT_URI ?? Linking.createURL("auth", { scheme: "geostats" });
      const authUrl = `${baseUrl}/auth/mobile/external?redirectUri=${encodeURIComponent(redirectUri)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type !== "success") {
        setMessage("Sign in was cancelled.");
        return;
      }
      const parsed = new URL(result.url);
      const params = new URLSearchParams(parsed.hash.replace(/^#/, "") || parsed.search.replace(/^\?/, ""));
      const authError = params.get("authError");
      const token = params.get("token");
      if (authError) {
        setMessage("External sign in failed.");
        return;
      }
      if (!token) {
        setMessage("External sign in did not return a session.");
        return;
      }
      const data = await apiFetch<{ user: Session["user"] }>(baseUrl, "/auth/me", token);
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      onSession({ token, user: data.user }, baseUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sign in");
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.authPage}>
        <Text style={styles.brand}>Geostats</Text>
        <Text style={styles.title}>{mode === "login" ? "Sign in" : "Create account"}</Text>
        <Field label="Server" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" keyboardType="url" />
        {!DEFAULT_API_URL ? <Text style={styles.muted}>Release builds need your public API URL here, for example https://api.example.com.</Text> : null}
        {config.mode === "password" ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            {mode === "register" ? <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" /> : null}
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
            <PrimaryButton label={mode === "login" ? "Sign in" : "Register"} onPress={submit} />
            <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")} style={styles.textButton}>
              <Text style={styles.textButtonText}>{mode === "login" ? "Need an account?" : "Already have an account?"}</Text>
            </Pressable>
          </>
        ) : null}
        {config.mode === "dev" ? <PrimaryButton label="Continue in dev mode" onPress={continueDev} /> : null}
        {config.mode === "external" ? <PrimaryButton label={`${mode === "login" ? "Sign in" : "Register"} with ${config.providerName}`} onPress={continueExternal} /> : null}
        {message ? <Text style={styles.note}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_URL);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [screen, setScreen] = useState<ScreenId>("dashboard");
  async function acceptSession(nextSession: Session, baseUrl = apiBaseUrl) {
    setSession(nextSession);
    try {
      const profile = await apiFetch<{ profile: any }>(baseUrl, "/profile", nextSession.token);
      setNeedsOnboarding(!profile.profile);
    } catch {
      setNeedsOnboarding(false);
    }
  }
  useEffect(() => {
    void Promise.all([SecureStore.getItemAsync(SERVER_URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)])
      .then(async ([serverUrl, token]) => {
        const nextUrl = serverUrl ? normalizeStoredServerUrl(serverUrl) : apiBaseUrl;
        setApiBaseUrl(nextUrl);
        if (!token) return;
        const data = await apiFetch<{ user: Session["user"] }>(nextUrl, "/auth/me", token);
        await acceptSession({ token, user: data.user }, nextUrl);
      })
      .catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          return SecureStore.deleteItemAsync(TOKEN_KEY);
        }
      })
      .finally(() => setBooting(false));
  }, []);
  async function logout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setSession(null);
    setNeedsOnboarding(false);
  }
  let content;
  if (booting) {
    content = <SafeAreaView style={styles.safeCenter}><ActivityIndicator color="#f3b34d" /></SafeAreaView>;
  } else if (!session) {
    content = <AuthScreen apiBaseUrl={apiBaseUrl} onApiBaseUrlChange={setApiBaseUrl} onSession={acceptSession} />;
  } else if (needsOnboarding) {
    content = <OnboardingScreen apiBaseUrl={apiBaseUrl} token={session.token} onComplete={() => setNeedsOnboarding(false)} onLogout={logout} />;
  } else {
    content = (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.shellHeader}>
          <View><Text style={styles.brandSmall}>Geostats</Text><Text style={styles.muted}>{session.user.username}</Text></View>
          <Pressable onPress={logout} style={styles.logoutButton}><Text style={styles.logoutText}>Logout</Text></Pressable>
        </View>
        <View style={styles.navWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.nav}>
            {screens.map((item) => (
              <Pressable key={item.id} onPress={() => setScreen(item.id)} style={[styles.navItem, screen === item.id && styles.navItemActive]}>
                <Text style={[styles.navText, screen === item.id && styles.navTextActive]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
          <ScreenSwitch apiBaseUrl={apiBaseUrl} screen={screen} token={session.token} />
        </ScrollView>
      </SafeAreaView>
    );
  }
  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function ScreenSwitch({ apiBaseUrl, screen, token }: { apiBaseUrl: string; screen: ScreenId; token: string }) {
  if (screen === "dashboard") return <DashboardScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "stats") return <StatsScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "map") return <MapScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "scratch") return <ScratchScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "milestones") return <MilestonesScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "ftf") return <FtfScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "hides") return <HidesScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "upload") return <UploadScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "imports") return <ImportsScreen apiBaseUrl={apiBaseUrl} token={token} />;
  return <ProfileScreen apiBaseUrl={apiBaseUrl} token={token} />;
}

function OnboardingScreen({ apiBaseUrl, token, onComplete, onLogout }: { apiBaseUrl: string; token: string; onComplete: () => void; onLogout: () => void }) {
  const [gcUsername, setGcUsername] = useState("");
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<{ profile: any }>(apiBaseUrl, "/profile", token, {
        method: "PUT",
        body: JSON.stringify({
          gcUsername,
          homeLatitude: parseOptionalNumber(homeLatitude),
          homeLongitude: parseOptionalNumber(homeLongitude),
          timeZone
        })
      });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setLoading(false);
    }
  }
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.authPage}>
        <Text style={styles.eyebrow}>Profile setup</Text>
        <Text style={styles.title}>Set up Geostats</Text>
        <Text style={styles.muted}>Add the required profile details before importing and reviewing your cache statistics.</Text>
        <Field label="Geocaching username" value={gcUsername} onChangeText={setGcUsername} autoCapitalize="none" />
        <Field label="Home latitude" value={homeLatitude} onChangeText={setHomeLatitude} keyboardType="numeric" />
        <Field label="Home longitude" value={homeLongitude} onChangeText={setHomeLongitude} keyboardType="numeric" />
        <Field label="Time zone" value={timeZone} onChangeText={setTimeZone} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton label={loading ? "Saving..." : "Save profile"} onPress={save} />
        <Pressable onPress={onLogout} style={styles.textButton}><Text style={styles.textButtonText}>Logout</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function DashboardScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const stats = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const imports = useApi<{ imports: ImportListItem[] }>(apiBaseUrl, token, "/imports", { imports: [] });
  const s = stats.data.stats;
  return (
    <>
      <PageTitle eyebrow="Private profile stats" title="Your cache archive" />
      <StatGrid rows={[["Total finds", s.totalFinds ?? 0], ["Cache types", s.cacheTypes?.length ?? 0], ["Countries", s.countries?.length ?? 0], ["Longest streak", `${s.streaks?.longest ?? 0} days`]]} />
      <Panel title="At a glance" subtitle={`Last import: ${dateText(imports.data.imports[0]?.createdAt)}`}>
        <Bars data={latestTwelveMonths(s.findsByMonth ?? [])} />
        <KeyValue rows={[["Best day", s.summaryNumbers?.bestDay ? `${s.summaryNumbers.bestDay.count} on ${s.summaryNumbers.bestDay.key}` : "-"], ["Best month", s.summaryNumbers?.bestMonth ? `${s.summaryNumbers.bestMonth.count} in ${s.summaryNumbers.bestMonth.key}` : "-"], ["Cache days", s.summaryNumbers?.cachingDays ?? 0], ["Average/day", s.summaryNumbers?.findsPerDay?.toFixed(2) ?? "0.00"], ["Average distance", s.distanceStats?.averageDistanceKm == null ? "-" : `${Math.round(s.distanceStats.averageDistanceKm)} km`]]} />
      </Panel>
      <BadgesPanel apiBaseUrl={apiBaseUrl} stats={s} token={token} />
      <LoadState loading={stats.loading || imports.loading} error={stats.error || imports.error} />
    </>
  );
}

function StatsScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const s = data.stats;
  return (
    <>
      <PageTitle eyebrow="Reusable stats package" title="Statistics" />
      <StatGrid rows={[["Total finds", s.totalFinds ?? 0], ["Longest streak", `${s.streaks?.longest ?? 0} days`], ["Current streak", `${s.streaks?.current ?? 0} days`], ["Milestones", s.milestoneStats?.countMilestones?.length ?? 0]]} />
      <Panel title="Finds by month" subtitle="Rolling latest 12 months"><Bars data={latestTwelveMonths(s.findsByMonth ?? [])} /></Panel>
      <BreakdownPanel title="Core breakdowns" groups={[["Cache types", s.cacheTypes ?? []], ["Sizes", s.sizes ?? []], ["Countries", s.countries ?? []], ["Finds by calendar month", s.findsByCalendarMonth ?? []], ["Finds by weekday", s.findsByWeekday ?? []], ["Top hiders", (s.ownerBuckets ?? []).slice(0, 20)]]} />
      <Panel title="Difficulty / Terrain"><DifficultyGrid data={s.difficultyTerrain ?? []} /></Panel>
      <Panel title="Summary numbers"><KeyValue rows={[["Total days", s.summaryNumbers?.totalDays ?? 0], ["Finds/caching day", s.summaryNumbers?.findsPerCachingDay?.toFixed(2) ?? "0.00"], ["Finds/week", s.summaryNumbers?.findsPerWeek?.toFixed(2) ?? "0.00"], ["Last 365 finds", s.summaryNumbers?.last365Finds ?? 0]]} /></Panel>
      <Panel title="Home distance">{s.distanceStats ? <KeyValue rows={[["Average distance", s.distanceStats.averageDistanceKm == null ? "-" : `${Math.round(s.distanceStats.averageDistanceKm)} km`], ["Distance buckets", s.distanceStats.distanceBuckets?.length ?? 0], ["Bearing degrees", s.distanceStats.bearingBuckets?.filter((x: PercentBucket) => x.count > 0).length ?? 0]]} /> : <Text style={styles.muted}>Set home coordinates in Profile to show distance and bearing stats.</Text>}</Panel>
      <Panel title="Way to 81"><Rows rows={(s.wayTo81 ?? []).map((entry: any) => [String(entry.index), `${entry.gcCode} ${entry.name}`, `${entry.difficulty}/${entry.terrain}`])} /></Panel>
      <Panel title="Finds by found date"><CalendarHeatmap data={s.foundDateMatrix ?? []} /></Panel>
      <Panel title="Finds by hidden date"><CalendarHeatmap data={s.hiddenDateMatrix ?? []} /></Panel>
      <Panel title="Finds by hidden month"><MonthMatrix data={s.hiddenMonthMatrix ?? []} /></Panel>
      <Panel title="Elevation chart"><Bars data={s.elevationBuckets ?? []} /></Panel>
      <LoadState loading={loading} error={error} />
    </>
  );
}

function MapScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const [points, setPoints] = useState<CachePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.allSettled([apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/caches", token), apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/hides", token)]).then(([finds, hides]) => {
      const findPoints = finds.status === "fulfilled" ? finds.value.points : [];
      const hidePoints = hides.status === "fulfilled" ? hides.value.points : [];
      setPoints([...findPoints, ...hidePoints]);
      if (finds.status === "rejected" && hides.status === "rejected") setError("Could not load map points.");
    });
  }, [apiBaseUrl, token]);
  const findCount = points.filter((p) => !p.isOwnHide).length;
  const recent = [...points].sort((a, b) => Date.parse(b.foundAt ?? b.placedAt ?? "") - Date.parse(a.foundAt ?? a.placedAt ?? "")).slice(0, 40);
  return (
    <>
      <PageTitle eyebrow="PostGIS-ready coordinates" title="Map" />
      <Panel title={`${findCount} plotted finds`} subtitle={`${points.length - findCount} own hides`}><NativeMap points={points} /></Panel>
      <Panel title="Recent map points">{recent.map((point) => <CacheRow key={`${point.isOwnHide ? "h" : "f"}-${point.gcCode}-${point.id}`} point={point} />)}</Panel>
      <LoadState loading={points.length === 0 && !error} error={error} />
    </>
  );
}

function ScratchScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ totalFinds?: number; truncated?: boolean; limit?: number; continents?: CountBucket[]; countries?: any[]; maxCountryCount?: number }>(apiBaseUrl, token, "/map/scratch", { countries: [], continents: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState<ScratchLevel>("countries");
  const [boundaryData, setBoundaryData] = useState<BoundaryFeatureCollection | null>(null);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);
  const [swedenCountyBuckets, setSwedenCountyBuckets] = useState<LocationBucket[]>([]);
  const [icelandRegionBuckets, setIcelandRegionBuckets] = useState<LocationBucket[]>([]);
  const [icelandCountyBuckets, setIcelandCountyBuckets] = useState<LocationBucket[]>([]);
  const countries = data.countries ?? [];
  const baseActive = countries.find((c) => c.name === selected) ?? countries[0];
  const active = baseActive?.name === "Sweden"
    ? { ...baseActive, counties: swedenCountyBuckets }
    : baseActive?.name === "Iceland"
      ? { ...baseActive, regions: icelandRegionBuckets, counties: icelandCountyBuckets }
      : baseActive;
  const supportsDetail = active?.name === "Sweden" || active?.name === "Iceland";
  const effectiveLevel = level === "countries" || supportsDetail ? level : "countries";
  const config = boundaryConfig(effectiveLevel, active?.name);
  const levelBuckets = scratchBucketsForLevel(countries, active, effectiveLevel);
  const max = Math.max(1, data.maxCountryCount ?? 1);
  useEffect(() => {
    let mounted = true;
    setBoundaryData(null);
    setBoundaryError(null);
    void fetchJson<BoundaryFeatureCollection>(config.url)
      .then((geoJson) => {
        if (mounted) setBoundaryData(geoJson);
      })
      .catch((err) => {
        if (mounted) setBoundaryError(err instanceof Error ? err.message : "Could not load map boundaries.");
      });
    return () => {
      mounted = false;
    };
  }, [config.url]);
  useEffect(() => {
    let mounted = true;
    setSwedenCountyBuckets([]);
    setIcelandRegionBuckets([]);
    setIcelandCountyBuckets([]);
    void apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/caches", token)
      .then((pointData) =>
        Promise.allSettled([
          deriveBucketsFromBoundaries(pointData.points, SWEDEN_COUNTY_GEOJSON_URL, "kom_namn"),
          deriveBucketsFromBoundaries(pointData.points, ICELAND_REGION_GEOJSON_URL, "shapeName"),
          deriveBucketsFromBoundaries(pointData.points, ICELAND_COUNTY_GEOJSON_URL, "shapeName")
        ])
      )
      .then(([swedenCounties, icelandRegions, icelandCounties]) => {
        if (!mounted) return;
        setSwedenCountyBuckets(swedenCounties.status === "fulfilled" ? swedenCounties.value : []);
        setIcelandRegionBuckets(icelandRegions.status === "fulfilled" ? icelandRegions.value : []);
        setIcelandCountyBuckets(icelandCounties.status === "fulfilled" ? icelandCounties.value : []);
      })
      .catch(() => {
        if (!mounted) return;
        setSwedenCountyBuckets([]);
        setIcelandRegionBuckets([]);
        setIcelandCountyBuckets([]);
      });
    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, token]);
  return (
    <>
      <PageTitle eyebrow="Scratch-off coverage" title="Scratch Map" />
      <StatGrid rows={[["Logged finds", data.truncated ? `${data.limit}+` : data.totalFinds ?? 0], ["Continents", data.continents?.length ?? 0], ["Countries", countries.length], ["Top country", countries[0]?.name ?? "-"]]} />
      <Panel title="Coverage map" subtitle={effectiveLevel === level ? `${effectiveLevel} in view` : "Country map shown until region data is added"}>
        <View style={styles.segmented}>
          {(["countries", "regions", "counties"] as ScratchLevel[]).map((item) => (
            <Pressable key={item} onPress={() => setLevel(item)} style={[styles.segmentButton, level === item && styles.segmentButtonActive]}>
              <Text style={[styles.segmentText, level === item && styles.segmentTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        {Platform.OS === "web" ? (
          <ScratchMapFallback buckets={levelBuckets} max={effectiveLevel === "countries" ? max : Math.max(1, ...levelBuckets.map((bucket: any) => bucket.count ?? 0))} />
        ) : (
          <ScratchNativeMap
            activeCountry={active}
            boundaryData={boundaryData}
            buckets={levelBuckets}
            level={effectiveLevel}
            max={effectiveLevel === "countries" ? max : Math.max(1, ...levelBuckets.map((bucket: any) => bucket.count ?? 0))}
            propertyName={config.propertyName}
            selectedName={effectiveLevel === "countries" ? active?.name : null}
            onSelect={(name) => {
              if (effectiveLevel === "countries") {
                const matched = countries.find((country) => namesForScratchBucket(country, "countries").includes(name));
                if (matched) setSelected(matched.name);
              }
            }}
          />
        )}
        {boundaryError ? <Text style={styles.error}>{boundaryError}</Text> : null}
        {level !== "countries" && !supportsDetail ? <Text style={styles.muted}>Region and county polygons are currently available for Sweden and Iceland.</Text> : null}
      </Panel>
      <Panel title="Continents"><Bars data={data.continents ?? []} /></Panel>
      <Panel title="Countries">{countries.map((country) => <Pressable key={country.name} onPress={() => setSelected(country.name)} style={[styles.countryRow, active?.name === country.name && styles.countryRowActive]}><View style={[styles.countrySwatch, { opacity: 0.3 + Math.min(0.7, country.count / max) }]} /><View style={styles.flex}><Text style={styles.rowTitle}>{country.name}</Text><Text style={styles.muted}>{country.continent} - {country.count} finds</Text></View></Pressable>)}</Panel>
      <Panel title={active?.name ?? "No country yet"} subtitle="Regions and counties"><Text style={styles.sectionLabel}>Regions</Text><Bars data={active?.regions ?? []} nameKey="name" /><Text style={styles.sectionLabel}>Counties</Text><Bars data={active?.counties ?? []} nameKey="name" /></Panel>
      <LoadState loading={loading} error={error} />
    </>
  );
}

function MilestonesScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const m = data.stats.milestoneStats ?? {};
  return (
    <>
      <PageTitle eyebrow="Progress markers" title="Milestones" />
      <StatGrid rows={[["Count marks", m.countMilestones?.length ?? 0], ["Countries", m.firstByCountry?.length ?? 0], ["Types", m.firstByType?.length ?? 0], ["D/T firsts", m.firstByDifficultyTerrain?.length ?? 0]]} />
      <MilestoneList title="Find count milestones" rows={m.countMilestones ?? []} labelKey="count" />
      <MilestoneList title="First cache by country" rows={m.firstByCountry ?? []} />
      <MilestoneList title={m.homeCountry ? `First cache by region in ${m.homeCountry}` : "First cache by region"} rows={m.firstByHomeCountryRegion ?? []} />
      <MilestoneList title="First cache by type" rows={m.firstByType ?? []} />
      <MilestoneList title="First cache by size" rows={m.firstBySize ?? []} />
      <MilestoneList title="First cache by difficulty / terrain" rows={m.firstByDifficultyTerrain ?? []} />
      <LoadState loading={loading} error={error} />
    </>
  );
}

function FtfScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const summary = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const finds = useApi<{ finds: any[]; nextCursor: string | null }>(apiBaseUrl, token, "/stats/ftf/finds?limit=100", { finds: [], nextCursor: null });
  const s = summary.data.stats.ftfStats ?? {};
  async function toggle(find: any) {
    await apiFetch(apiBaseUrl, `/stats/ftf/finds/${find.id}`, token, { method: "PATCH", body: JSON.stringify({ isFtf: !find.isFtf }) });
    await Promise.all([summary.refresh(), finds.refresh()]);
  }
  return (
    <>
      <PageTitle eyebrow="First to find" title="FTF" />
      <StatGrid rows={[["FTF finds", s.total ?? 0], ["Percent", s.percentOfFinds == null ? "-" : `${s.percentOfFinds.toFixed(2)}%`], ["Average interval", s.averageIntervalDays == null ? "-" : `${s.averageIntervalDays.toFixed(1)} days`], ["Archived", s.archivedCount ?? 0]]} />
      <Panel title="Some numbers"><KeyValue rows={[["First", s.first ? `${s.first.gcCode} ${dateText(s.first.dateTime)}` : "-"], ["Latest", s.latest ? `${s.latest.gcCode} ${dateText(s.latest.dateTime)}` : "-"], ["Best day", s.bestDay ? `${s.bestDay.count} on ${s.bestDay.key}` : "-"], ["Best month", s.bestMonth ? `${s.bestMonth.count} in ${s.bestMonth.key}` : "-"], ["Average distance", s.averageDistanceKm == null ? "-" : `${Math.round(s.averageDistanceKm)} km`]]} /></Panel>
      <BreakdownPanel title="FTF breakdowns" groups={[["FTF by year", s.byYear ?? []], ["FTF by month", s.byMonth ?? []], ["FTFs by type", s.byType ?? []], ["FTFs by size", s.bySize ?? []], ["FTFs by difficulty", s.byDifficulty ?? []], ["FTFs by terrain", s.byTerrain ?? []], ["FTFs by country", s.byCountry ?? []], ["FTFs by weekday", s.byWeekday ?? []]]} />
      <Panel title="FTFs by found date"><CalendarHeatmap data={s.foundDateMatrix ?? []} /></Panel>
      <Panel title="FTF D/T chart"><DifficultyGrid data={s.byDifficultyTerrain ?? []} /></Panel>
      <Panel title="Way to 81 (FTF)"><Rows rows={(s.wayTo81 ?? []).map((row: any) => [String(row.index), row.gcCode, `${row.difficulty}/${row.terrain}`])} /></Panel>
      <Panel title="FTF map"><NativeMap points={(s.rows ?? []).map((row: any) => ({ id: `${row.gcCode}-${row.dateTime}`, gcCode: row.gcCode, name: row.name, cacheType: row.cacheType, latitude: row.latitude ?? Number.NaN, longitude: row.longitude ?? Number.NaN, foundAt: row.dateTime }))} /></Panel>
      <Panel title="FTF list">{(s.rows ?? []).map((row: any) => <CacheRow key={`${row.gcCode}-${row.dateTime}`} point={{ id: row.gcCode, gcCode: row.gcCode, name: row.name, cacheType: row.cacheType, latitude: row.latitude ?? 0, longitude: row.longitude ?? 0, foundAt: row.dateTime }} />)}</Panel>
      <Panel title="Mark FTF finds">{finds.data.finds.map((find) => <Pressable key={find.id} onPress={() => toggle(find)} style={[styles.toggleRow, find.isFtf && styles.toggleRowActive]}><Text style={styles.rowTitle}>{find.cache.gcCode} - {find.cache.name}</Text><Text style={styles.muted}>{find.isFtf ? "Marked FTF" : "Tap to mark"} - {dateText(find.foundAt)}</Text></Pressable>)}</Panel>
      <LoadState loading={summary.loading || finds.loading} error={summary.error || finds.error} />
    </>
  );
}

function HidesScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const h = data.stats.hideStats ?? {};
  return (
    <>
      <PageTitle eyebrow="Owner statistics" title="Hides" />
      <StatGrid rows={[["Owned", h.totalHides ?? 0], ["Active", h.activeHides ?? 0], ["Received logs", h.totalReceivedLogs ?? 0], ["Finders", h.totalUniqueFinders ?? 0]]} />
      <BreakdownPanel title="Owner charts" groups={[["Cumulative finds of my caches", h.cumulativeReceivedLogsByMonth ?? []], ["Caching karma", h.receivedLogsByYear ?? []], ["Finds on hides by month", h.receivedLogsByMonth ?? []], ["Finders by country", h.hidesByCountry ?? []], ["Top finders of my caches", h.finderBuckets ?? []], ["Placed by type", h.hidesByType ?? []], ["Placed by size", h.hidesBySize ?? []], ["Placed by found month", h.receivedLogsByCalendarMonth ?? []], ["Placed by found weekday", h.receivedLogsByWeekday ?? []]]} />
      <Panel title="Owned cache statistics"><KeyValue rows={(h.hideSummaryRows ?? []).map((row: any) => [row.label, row.value])} /></Panel>
      <Panel title="Placed D/T chart"><DifficultyGrid data={h.hidesByDifficultyTerrain ?? []} /></Panel>
      <Panel title="Placed by hidden date"><CalendarHeatmap data={h.placedHiddenDateMatrix ?? []} /></Panel>
      <Panel title="Placed by found date"><CalendarHeatmap data={h.receivedFoundDateMatrix ?? []} /></Panel>
      <Panel title="Logs received"><Rows rows={(h.logsReceived ?? []).map((row: any) => [row.gcCode, row.name, `${row.finds} finds`])} /></Panel>
      <LoadState loading={loading} error={error} />
    </>
  );
}

function UploadScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const imports = useApi<{ imports: ImportListItem[] }>(apiBaseUrl, token, "/imports", { imports: [] });
  useEffect(() => {
    if (!hasActiveImports(imports.data.imports)) return;
    const interval = setInterval(() => {
      void imports.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [imports.data.imports]);
  async function pickAndUpload(kind: "cache" | "csv") {
    const result = await DocumentPicker.getDocumentAsync({ type: kind === "cache" ? ["application/gpx+xml", "application/zip", "text/xml", "*/*"] : ["text/csv", "text/plain", "*/*"], copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    const form = new FormData();
    const fileObj = new File(asset.uri);
    const uploadFile = fileObj.type ? fileObj : fileObj.slice(0, fileObj.size, asset.mimeType ?? "application/octet-stream");
    form.append("file", uploadFile, asset.name);
    setMessage(kind === "cache" ? "Uploading import..." : "Uploading owner logs...");
    try {
      await apiFetch(apiBaseUrl, kind === "cache" ? "/imports/upload" : "/collector/received-logs/csv", token, { method: "POST", body: form });
      setMessage(kind === "cache" ? "Import queued." : "Owner logs imported.");
      await imports.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    }
  }
  return (
    <>
      <PageTitle eyebrow="Import pipeline" title="Upload cache data" />
      <Panel title="GPX or ZIP"><PrimaryButton label="Choose GPX or ZIP" onPress={() => pickAndUpload("cache")} /></Panel>
      <Panel title="Owner log CSV"><PrimaryButton label="Choose CSV" onPress={() => pickAndUpload("csv")} /><Text style={styles.muted}>Use the CSV command from Profile after importing My Hides data.</Text></Panel>
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <Panel title="Latest imports"><ImportRows imports={imports.data.imports.slice(0, 8)} /></Panel>
      <LoadState loading={imports.loading} error={imports.error} />
    </>
  );
}

function ImportsScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error, refresh } = useApi<{ imports: ImportListItem[] }>(apiBaseUrl, token, "/imports", { imports: [] });
  useEffect(() => {
    if (!hasActiveImports(data.imports)) return;
    const interval = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [data.imports]);
  return <><PageTitle eyebrow="Background jobs" title="Import history" /><PrimaryButton label="Refresh" onPress={refresh} /><Panel title="Imports"><ImportRows imports={data.imports} /></Panel><LoadState loading={loading} error={error} /></>;
}

function ProfileScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const profile = useApi<{ profile: any }>(apiBaseUrl, token, "/profile", { profile: null });
  const tokens = useApi<{ tokens: any[] }>(apiBaseUrl, token, "/collector/tokens", { tokens: [] });
  const [gcUsername, setGcUsername] = useState("");
  const [homeLatitude, setHomeLatitude] = useState("");
  const [homeLongitude, setHomeLongitude] = useState("");
  const [timeZone, setTimeZone] = useState(defaultTimeZone);
  const [ftfTerms, setFtfTerms] = useState(defaultFtfTerms.join("\n"));
  const [message, setMessage] = useState<string | null>(null);
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  useEffect(() => {
    const p = profile.data.profile;
    if (!p) return;
    setGcUsername(p.gcUsername ?? "");
    setHomeLatitude(p.homeLatitude == null ? "" : String(p.homeLatitude));
    setHomeLongitude(p.homeLongitude == null ? "" : String(p.homeLongitude));
    setTimeZone(p.timeZone ?? defaultTimeZone);
    setFtfTerms(Array.isArray(p.ftfDetectionTerms) ? p.ftfDetectionTerms.join("\n") : defaultFtfTerms.join("\n"));
  }, [profile.data.profile]);
  async function save() {
    try {
      await apiFetch<{ profile: any }>(apiBaseUrl, "/profile", token, { method: "PUT", body: JSON.stringify({ gcUsername, homeLatitude: parseOptionalNumber(homeLatitude), homeLongitude: parseOptionalNumber(homeLongitude), timeZone, ftfDetectionTerms: ftfTerms.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean) }) });
      setMessage("Profile saved.");
      await profile.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save profile");
    }
  }
  async function createToken() {
    await apiFetch(apiBaseUrl, "/collector/tokens", token, { method: "POST", body: JSON.stringify({ name: "Owner logs collector" }) });
    await tokens.refresh();
  }
  async function deleteToken(id: string) {
    await apiFetch(apiBaseUrl, `/collector/tokens/${id}`, token, { method: "DELETE" });
    await tokens.refresh();
  }
  async function copyCollectorCommand(item: any, mode: "direct" | "csv") {
    if (!item.token) {
      setMessage("Command unavailable for this older token. Delete it and create a new token once.");
      return;
    }
    await Clipboard.setStringAsync(hidesCommand(apiBaseUrl, item.token, mode === "csv"));
    setCopiedCommandId(`${item.id}:${mode}`);
    setMessage(null);
  }
  return (
    <>
      <PageTitle eyebrow="Per-user ownership" title="Geocaching profile" />
      <Panel title="Profile"><Field label="Geocaching username" value={gcUsername} onChangeText={setGcUsername} /><Field label="Home latitude" value={homeLatitude} onChangeText={setHomeLatitude} keyboardType="numeric" /><Field label="Home longitude" value={homeLongitude} onChangeText={setHomeLongitude} keyboardType="numeric" /><Field label="Time zone" value={timeZone} onChangeText={setTimeZone} /><Field label="FTF auto-detect phrases" value={ftfTerms} onChangeText={setFtfTerms} multiline /><PrimaryButton label="Save profile" onPress={save} /></Panel>
      <Panel title="Owner log collector">
        <Text style={styles.muted}>The direct command uploads owner logs automatically. The CSV command saves geostats-received-logs.csv in Downloads so it can be imported later from Upload.</Text>
        <PrimaryButton label="Create collector token" onPress={createToken} />
        {tokens.data.tokens.map((item) => (
          <View key={item.id} style={styles.tokenCard}>
            <View style={styles.tokenRow}>
              <View style={styles.flex}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.muted}>{item.tokenPrefix}...</Text></View>
              <Pressable onPress={() => deleteToken(item.id)}><Text style={styles.danger}>Delete</Text></Pressable>
            </View>
            {item.token ? (
              <>
                <CommandCard
                  label="Direct upload command"
                  copied={copiedCommandId === `${item.id}:direct`}
                  command={hidesCommand(apiBaseUrl, item.token)}
                  onCopy={() => copyCollectorCommand(item, "direct")}
                />
                <CommandCard
                  label="CSV to Downloads command"
                  copied={copiedCommandId === `${item.id}:csv`}
                  command={hidesCommand(apiBaseUrl, item.token, true)}
                  onCopy={() => copyCollectorCommand(item, "csv")}
                />
              </>
            ) : (
              <Text style={styles.muted}>Command unavailable for this older token. Delete it and create a new token once.</Text>
            )}
          </View>
        ))}
      </Panel>
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <LoadState loading={profile.loading || tokens.loading} error={profile.error || tokens.error} />
    </>
  );
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.pageTitle}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#76827c" style={[styles.input, rest.multiline && styles.textArea, style]} {...rest} /></View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function CommandCard({ label, command, copied, onCopy }: { label: string; command: string; copied: boolean; onCopy: () => void }) {
  return (
    <View style={styles.commandCard}>
      <View style={styles.commandHeader}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Pressable onPress={onCopy} style={styles.copyButton}>
          <Text style={styles.copyButtonText}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
      <Text selectable style={styles.commandText}>{command}</Text>
    </View>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <View style={styles.panel}><View style={styles.panelHeading}><Text style={styles.panelTitle}>{title}</Text>{subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}</View>{children}</View>;
}

function StatGrid({ rows }: { rows: Array<[string, unknown]> }) {
  return <View style={styles.statGrid}>{rows.map(([label, value]) => <View key={label} style={styles.statCard}><Text style={styles.statValue}>{text(value)}</Text><Text style={styles.muted}>{label}</Text></View>)}</View>;
}

function Bars({ data, nameKey = "key" }: { data: any[]; nameKey?: "key" | "name" }) {
  const visible = data;
  const max = Math.max(1, ...visible.map((row) => Number(row.count ?? row.average ?? 0)));
  if (visible.length === 0) return <Text style={styles.muted}>No data yet.</Text>;
  return <View style={styles.bars}>{visible.map((row) => { const value = Number(row.count ?? row.average ?? 0); return <View key={`${row[nameKey] ?? row.year}-${value}`} style={styles.barRow}><Text style={styles.barLabel} numberOfLines={1}>{row[nameKey] ?? row.year}</Text><View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.max(3, (value / max) * 100)}%` }]} /></View><Text style={styles.barValue}>{text(value)}</Text></View>; })}</View>;
}

function KeyValue({ rows }: { rows: Array<[string, unknown]> }) {
  return <View>{rows.map(([key, value]) => <View key={key} style={styles.keyValue}><Text style={styles.muted}>{key}</Text><Text style={styles.keyValueText}>{text(value, "-")}</Text></View>)}</View>;
}

function Rows({ rows }: { rows: Array<Array<unknown>> }) {
  if (rows.length === 0) return <Text style={styles.muted}>No rows yet.</Text>;
  return <View>{rows.map((row, index) => <View key={index} style={styles.rowLine}>{row.map((cell, cellIndex) => <Text key={cellIndex} style={cellIndex === 0 ? styles.rowTitle : styles.muted} numberOfLines={2}>{text(cell, "-")}</Text>)}</View>)}</View>;
}

function BreakdownPanel({ title, groups }: { title: string; groups: Array<[string, any[]]> }) {
  return <Panel title={title}>{groups.map(([label, data]) => <View key={label} style={styles.breakdownGroup}><Text style={styles.sectionLabel}>{label}</Text><Bars data={data} /></View>)}</Panel>;
}

function DifficultyGrid({ data }: { data: Array<{ difficulty: number; terrain: number; count: number }> }) {
  const byKey = new Map(data.map((cell) => [`${cell.difficulty}/${cell.terrain}`, cell.count]));
  const ratings = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const max = Math.max(1, ...data.map((cell) => cell.count));
  return <View style={styles.dtGrid}>{ratings.flatMap((difficulty) => ratings.map((terrain) => { const count = byKey.get(`${difficulty}/${terrain}`) ?? 0; return <View key={`${difficulty}-${terrain}`} style={[styles.dtCell, { opacity: count ? 0.45 + (count / max) * 0.55 : 0.18 }]}><Text style={styles.dtText}>{count || ""}</Text></View>; }))}</View>;
}

function CalendarHeatmap({ data }: { data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  const filled = data.filter((bucket) => bucket.count > 0).length;
  return (
    <View style={styles.calendarWrap}>
      <View style={styles.calendarGrid}>
        {monthLabels.map((month, monthIndex) => (
          <View key={month} style={styles.calendarMonth}>
            <Text style={styles.calendarMonthLabel}>{month}</Text>
            <View style={styles.calendarDays}>
              {Array.from({ length: 31 }, (_, dayIndex) => {
                const key = `${String(monthIndex + 1).padStart(2, "0")}-${String(dayIndex + 1).padStart(2, "0")}`;
                const count = counts.get(key) ?? 0;
                return <View key={key} style={[styles.calendarCell, count > 0 && styles.calendarCellFilled, { opacity: count > 0 ? 0.35 + (count / max) * 0.65 : 0.2 }]} />;
              })}
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.muted}>Filled dates: {filled}/366 ({((filled / 366) * 100).toFixed(1)}%)</Text>
    </View>
  );
}

function MonthMatrix({ data }: { data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const years = [...new Set(data.map((bucket) => bucket.key.slice(0, 4)))].sort();
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  if (years.length === 0) return <Text style={styles.muted}>No data yet.</Text>;
  return (
    <View style={styles.monthMatrix}>
      {years.map((year) => (
        <View key={year} style={styles.monthMatrixRow}>
          <Text style={styles.monthMatrixYear}>{year}</Text>
          <View style={styles.monthMatrixCells}>
            {monthLabels.map((_, index) => {
              const key = `${year}-${String(index + 1).padStart(2, "0")}`;
              const count = counts.get(key) ?? 0;
              return <View key={key} style={[styles.monthMatrixCell, count > 0 && styles.calendarCellFilled, { opacity: count > 0 ? 0.35 + (count / max) * 0.65 : 0.2 }]} />;
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function NativeMap({ points }: { points: CachePoint[] }) {
  const visible = validMapPoints(points).slice(0, 1500);
  if (visible.length === 0) return <Text style={styles.muted}>No coordinates yet.</Text>;
  return (
    <View style={styles.nativeMapFrame}>
      <MapView style={styles.nativeMap} initialRegion={regionForPoints(visible)} provider={ANDROID_MAP_PROVIDER} showsCompass showsScale>
        {visible.map((point) => (
          <Marker
            key={`${point.isOwnHide ? "hide" : "find"}-${point.gcCode}-${point.id}-${point.foundAt ?? point.placedAt ?? ""}`}
            coordinate={{ latitude: point.latitude, longitude: point.longitude }}
            pinColor={getCacheTypeColor(point.cacheType, point.isOwnHide)}
          >
            <Callout onPress={() => Linking.openURL(`https://coord.info/${point.gcCode}`)}>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{point.gcCode}</Text>
                <Text style={styles.calloutBody}>{point.name}</Text>
                <Text style={styles.calloutMeta}>{point.isOwnHide ? "Own hide" : point.cacheType ?? "Unknown"}</Text>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

function ScratchMapFallback({ buckets, max }: { buckets: any[]; max: number }) {
  const visible = [...buckets].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 16);
  if (visible.length === 0) {
    return <View style={styles.scratchMapFallback}><Text style={styles.muted}>No scratch coverage yet.</Text></View>;
  }
  return (
    <View style={styles.scratchMapFallback}>
      {visible.map((bucket) => {
        const count = bucket.count ?? 0;
        return (
          <View key={bucket.name} style={styles.scratchFallbackRow}>
            <Text style={styles.scratchFallbackLabel} numberOfLines={1}>{bucket.name}</Text>
            <View style={styles.scratchFallbackTrack}>
              <View style={[styles.scratchFallbackFill, { width: `${Math.max(4, (count / Math.max(1, max)) * 100)}%`, backgroundColor: scratchColor(count, max) }]} />
            </View>
            <Text style={styles.scratchFallbackValue}>{count}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ScratchNativeMap({
  activeCountry,
  boundaryData,
  buckets,
  level,
  max,
  propertyName,
  selectedName,
  onSelect
}: {
  activeCountry: any;
  boundaryData: BoundaryFeatureCollection | null;
  buckets: any[];
  level: ScratchLevel;
  max: number;
  propertyName: string;
  selectedName?: string | null;
  onSelect: (name: string) => void;
}) {
  if (!boundaryData) {
    return <View style={styles.scratchMapLoading}><ActivityIndicator color="#f3b34d" /></View>;
  }
  const byName = new Map<string, any>();
  for (const bucket of buckets) {
    for (const name of namesForScratchBucket(bucket, level)) {
      byName.set(name, bucket);
    }
  }
  const features = boundaryData.features
    .map((feature) => {
      const featureName = String(feature.properties?.[propertyName] ?? "").trim();
      const bucket = byName.get(featureName);
      return { feature, featureName, bucket };
    })
    .filter((item) => item.bucket);
  const region = regionForScratch(level, activeCountry?.name);
  return (
    <View style={styles.nativeMapFrame}>
      <MapView style={styles.nativeMap} initialRegion={region} provider={ANDROID_MAP_PROVIDER} showsCompass showsScale>
        {features.flatMap(({ feature, featureName, bucket }, featureIndex) =>
          polygonOuterRings(feature).map((coordinates, ringIndex) => (
            <Polygon
              key={`${featureName}-${featureIndex}-${ringIndex}`}
              coordinates={coordinates}
              fillColor={`${scratchColor(bucket.count ?? 0, max)}aa`}
              strokeColor={selectedName && namesForScratchBucket(bucket, level).includes(selectedName) ? "#f3b34d" : "#dce8df"}
              strokeWidth={selectedName && namesForScratchBucket(bucket, level).includes(selectedName) ? 2 : 0.7}
              tappable
              onPress={() => onSelect(featureName)}
            />
          ))
        )}
      </MapView>
    </View>
  );
}

function CacheRow({ point }: { point: CachePoint }) {
  return (
    <Pressable onPress={() => Linking.openURL(`https://coord.info/${point.gcCode}`)} style={styles.cacheRow}>
      <Text style={[styles.rowTitle, { color: getCacheTypeColor(point.cacheType, point.isOwnHide) }]}>{point.gcCode} - {point.name}</Text>
      <Text style={styles.muted}>{point.isOwnHide ? "Own hide - " : ""}{point.cacheType ?? "Unknown"} - {point.latitude}, {point.longitude}</Text>
    </Pressable>
  );
}

function ImportRows({ imports }: { imports: ImportListItem[] }) {
  if (imports.length === 0) return <Text style={styles.muted}>No import history yet.</Text>;
  return <View>{imports.map((item) => <View key={item.id} style={styles.importRow}><View style={styles.flex}><Text style={styles.rowTitle}>{item.fileName}</Text><Text style={styles.muted}>{dateText(item.createdAt)} - {item.source}</Text>{item.errorMessage ? <Text style={styles.error}>{item.errorMessage}</Text> : null}</View><Text style={styles.statusPill}>{item.status}</Text></View>)}</View>;
}

function MilestoneList({ title, rows, labelKey = "label" }: { title: string; rows: any[]; labelKey?: string }) {
  return <Panel title={title}><Rows rows={rows.map((row) => [row[labelKey], row.gcCode, row.name, dateText(row.date)])} /></Panel>;
}

function BadgesPanel({ apiBaseUrl, stats, token }: { apiBaseUrl: string; stats: any; token: string }) {
  const scratch = useApi<{ countries: any[] }>(apiBaseUrl, token, "/map/scratch", { countries: [] });
  const countryBadges = scratch.data.countries
    .map((country) => {
      const regions = country.regions?.filter((region: any) => region.name !== "Unknown") ?? [];
      const completed = regions.filter((region: any) => region.count > 0).length;
      const total = Math.max(1, regions.length);
      return {
        name: country.name,
        current: total > 0 ? (completed / total) * 100 : 0,
        completed,
        total,
        count: country.count
      };
    })
    .filter((country) => country.completed > 0)
    .sort((a, b) => b.current - a.current || b.count - a.count || a.name.localeCompare(b.name));
  const badges = mobileBadges(stats)
    .map((badge) => ({ ...badge, level: achievedIndex(badge) }))
    .sort((a, b) => b.level - a.level || (b.current ?? -1) - (a.current ?? -1) || a.name.localeCompare(b.name));
  const achieved = badges.filter((badge) => badge.level >= 0).length;
  return (
    <Panel title="Achievement badges" subtitle={`${achieved}/${badges.length} badges started`}>
      {countryBadges.length > 0 ? (
        <View style={styles.countryBadgeBlock}>
          <Text style={styles.sectionLabel}>Country badges</Text>
          {countryBadges.slice(0, 30).map((country) => (
            <View key={country.name} style={styles.countryBadgeRow}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{country.name}</Text>
                <Text style={styles.muted}>{country.completed}/{country.total} regions - {country.count} finds</Text>
              </View>
              <Text style={styles.badgeNumber}>{Math.round(country.current)}%</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.sectionLabel}>Achievement badges</Text>
      {badges.map((badge) => {
        const tier = badge.level >= 0 ? badgeTiers[badge.level] : "Locked";
        return (
          <View key={badge.id} style={styles.badgeRow}>
            <View style={styles.badgeHeader}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{badge.name}</Text>
                <Text style={styles.muted}>{tier} - {badge.metric}</Text>
              </View>
              <View style={styles.badgeNumbers}>
                <Text style={styles.badgeNumber}>{text(badge.current ?? "--")}</Text>
                <Text style={styles.muted}>-{remainingForBadge(badge)}</Text>
              </View>
            </View>
            <View style={styles.badgeCells}>
              {badge.thresholds.map((threshold, index) => (
                <View key={`${badge.id}-${threshold}`} style={[styles.badgeCell, index <= badge.level && styles.badgeCellEarned, index === badge.level && styles.badgeCellCurrent]} />
              ))}
            </View>
          </View>
        );
      })}
    </Panel>
  );
}

function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <ActivityIndicator color="#f3b34d" style={styles.loader} />;
  if (error) return <Text style={styles.error}>{error}</Text>;
  return null;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#07110d" },
  safeCenter: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#07110d" },
  authPage: { flexGrow: 1, justifyContent: "center", padding: 22, gap: 14 },
  brand: { color: "#f3b34d", fontSize: 42, fontWeight: "900" },
  brandSmall: { color: "#f3b34d", fontSize: 22, fontWeight: "900" },
  shellHeader: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  logoutButton: { borderColor: "#365346", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: "#dce8df", fontWeight: "700" },
  navWrap: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#173326" },
  nav: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  navItem: { borderRadius: 8, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: "#10251b" },
  navItemActive: { backgroundColor: "#f3b34d" },
  navText: { color: "#b9c8bf", fontWeight: "800" },
  navTextActive: { color: "#162016" },
  content: { flex: 1 },
  contentInner: { padding: 16, paddingBottom: 32, gap: 14 },
  pageTitle: { marginBottom: 2 },
  eyebrow: { color: "#85a696", fontSize: 12, textTransform: "uppercase", letterSpacing: 0, fontWeight: "800" },
  title: { color: "#edf7ef", fontSize: 34, fontWeight: "900" },
  muted: { color: "#91a79c", fontSize: 13 },
  note: { color: "#dce8df", backgroundColor: "#10251b", borderRadius: 8, padding: 12 },
  error: { color: "#ffb4a8", backgroundColor: "#421c17", borderRadius: 8, padding: 12 },
  field: { gap: 6 },
  fieldLabel: { color: "#c9d8cf", fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#294839", borderRadius: 8, color: "#eef8f0", backgroundColor: "#0c1b14", paddingHorizontal: 12, paddingVertical: 11 },
  textArea: { minHeight: 110, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#f3b34d", borderRadius: 8, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  primaryButtonText: { color: "#172016", fontWeight: "900" },
  textButton: { padding: 8, alignItems: "center" },
  textButtonText: { color: "#f3b34d", fontWeight: "800" },
  panel: { backgroundColor: "#0d1f17", borderColor: "#1d3a2c", borderWidth: 1, borderRadius: 8, padding: 14, gap: 12 },
  panelHeading: { gap: 2 },
  panelTitle: { color: "#edf7ef", fontSize: 19, fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "48%", backgroundColor: "#10251b", borderColor: "#234536", borderWidth: 1, borderRadius: 8, padding: 13 },
  statValue: { color: "#f3b34d", fontSize: 24, fontWeight: "900" },
  bars: { gap: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { color: "#c9d8cf", width: 88, fontSize: 12, fontWeight: "700" },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: "#1a3327", overflow: "hidden" },
  barFill: { height: "100%", backgroundColor: "#f3b34d" },
  barValue: { color: "#dce8df", width: 48, textAlign: "right", fontWeight: "800" },
  keyValue: { borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10, gap: 4 },
  keyValueText: { color: "#edf7ef", fontWeight: "800" },
  rowLine: { borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10, gap: 3 },
  rowTitle: { color: "#edf7ef", fontWeight: "800" },
  breakdownGroup: { gap: 8, marginTop: 4 },
  sectionLabel: { color: "#dce8df", fontWeight: "900", marginTop: 6 },
  segmented: { flexDirection: "row", gap: 6, backgroundColor: "#10251b", borderRadius: 8, padding: 4 },
  segmentButton: { flex: 1, borderRadius: 6, paddingVertical: 9, alignItems: "center" },
  segmentButtonActive: { backgroundColor: "#f3b34d" },
  segmentText: { color: "#b9c8bf", fontWeight: "800", textTransform: "capitalize" },
  segmentTextActive: { color: "#172016" },
  dtGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  dtCell: { width: "10.5%", aspectRatio: 1, borderRadius: 4, backgroundColor: "#f3b34d", alignItems: "center", justifyContent: "center" },
  dtText: { color: "#162016", fontSize: 10, fontWeight: "900" },
  calendarWrap: { gap: 10 },
  calendarGrid: { gap: 8 },
  calendarMonth: { flexDirection: "row", alignItems: "center", gap: 8 },
  calendarMonthLabel: { width: 30, color: "#c9d8cf", fontSize: 11, fontWeight: "800" },
  calendarDays: { flex: 1, flexDirection: "row", gap: 2 },
  calendarCell: { flex: 1, aspectRatio: 0.8, borderRadius: 2, backgroundColor: "#244535" },
  calendarCellFilled: { backgroundColor: "#f3b34d" },
  monthMatrix: { gap: 8 },
  monthMatrixRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthMatrixYear: { width: 42, color: "#c9d8cf", fontWeight: "800" },
  monthMatrixCells: { flex: 1, flexDirection: "row", gap: 4 },
  monthMatrixCell: { flex: 1, aspectRatio: 1, borderRadius: 3, backgroundColor: "#244535" },
  nativeMapFrame: { height: 320, borderRadius: 8, overflow: "hidden", backgroundColor: "#14271d" },
  nativeMap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  scratchMapLoading: { height: 320, borderRadius: 8, backgroundColor: "#14271d", alignItems: "center", justifyContent: "center" },
  scratchMapFallback: { minHeight: 320, borderRadius: 8, backgroundColor: "#14271d", padding: 12, gap: 9, justifyContent: "center" },
  scratchFallbackRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  scratchFallbackLabel: { width: 92, color: "#dce8df", fontWeight: "800", fontSize: 12 },
  scratchFallbackTrack: { flex: 1, height: 10, borderRadius: 999, overflow: "hidden", backgroundColor: "#244535" },
  scratchFallbackFill: { height: "100%", borderRadius: 999 },
  scratchFallbackValue: { width: 34, color: "#9fb0a6", textAlign: "right", fontWeight: "800", fontSize: 12 },
  callout: { width: 190, gap: 3 },
  calloutTitle: { color: "#172016", fontWeight: "900", fontSize: 15 },
  calloutBody: { color: "#172016", fontWeight: "700" },
  calloutMeta: { color: "#476052", fontSize: 12 },
  cacheRow: { borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10, gap: 3 },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: 1, borderColor: "#1b3729" },
  countryRowActive: { backgroundColor: "#132c20" },
  countrySwatch: { width: 18, height: 32, borderRadius: 4, backgroundColor: "#f3b34d" },
  importRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10 },
  statusPill: { color: "#162016", backgroundColor: "#f3b34d", borderRadius: 8, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, fontWeight: "900" },
  toggleRow: { borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10 },
  toggleRowActive: { backgroundColor: "#172f23" },
  tokenCard: { borderTopWidth: 1, borderColor: "#1b3729", paddingTop: 10, gap: 10 },
  tokenRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  commandCard: { backgroundColor: "#10251b", borderColor: "#234536", borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  commandHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  copyButton: { backgroundColor: "#1a3327", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 7 },
  copyButtonText: { color: "#f3b34d", fontWeight: "900" },
  commandText: { color: "#dce8df", fontSize: 12, lineHeight: 17 },
  countryBadgeBlock: { gap: 8 },
  countryBadgeRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: "#1b3729", paddingTop: 10 },
  badgeRow: { borderTopWidth: 1, borderColor: "#1b3729", paddingTop: 11, gap: 8 },
  badgeHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  badgeNumbers: { alignItems: "flex-end" },
  badgeNumber: { color: "#f3b34d", fontWeight: "900" },
  badgeCells: { flexDirection: "row", gap: 5 },
  badgeCell: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#1a3327" },
  badgeCellEarned: { backgroundColor: "#c88935" },
  badgeCellCurrent: { backgroundColor: "#f3b34d" },
  danger: { color: "#ffb4a8", fontWeight: "900" },
  loader: { padding: 14 },
  flex: { flex: 1 }
});
