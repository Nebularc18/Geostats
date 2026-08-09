import { StatusBar } from "expo-status-bar";
import { fetch as expoFetch } from "expo/fetch";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import * as Updates from "expo-updates";
import MapView, { Callout, Marker, Polygon, PROVIDER_GOOGLE, type Region } from "react-native-maps";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { parseCoordinate } from "@geostats/shared";
import { pickAndUploadDocument, type UploadKind } from "./upload";

WebBrowser.maybeCompleteAuthSession();

type CountBucket = { key: string; count: number };
type LocationBucket = { name: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type CachePoint = { id: string; gcCode: string; name: string; cacheType: string | null; latitude: number; longitude: number; foundAt?: string; placedAt?: string; isOwnHide?: boolean };
type ImportListItem = { id: string; fileName: string; source: string; status: string; createdAt: string; errorMessage: string | null };
type AuthConfig = { mode: "dev" | "external" | "password"; providerName: string };
type ServerProbeState = {
  url: string | null;
  status: "checking" | "connected" | "unreachable";
  config: AuthConfig;
};
type ScratchLevel = "countries" | "regions" | "counties";
type ScreenId = "dashboard" | "explore" | "upload" | "imports" | "stats" | "ftf" | "hides" | "milestones" | "profileHtml" | "map" | "mysteries" | "travel" | "scratch" | "profile";
type Session = { token: string; user: { id: string; email: string; username: string } };
type CheckState = "correct" | "wrong" | "unchecked";
type MysteryStatus = "solving" | "solved" | "planned";
type AttemptKind = "coordinate" | "keyword";
type AppUser = { id: string; username: string };
type CoordinateAttempt = {
  id: string;
  kind?: AttemptKind;
  latitude?: number;
  longitude?: number;
  answer?: string;
  finalLatitude?: number;
  finalLongitude?: number;
  state: CheckState;
  createdAt: string;
  geocachingSyncedAt?: string;
};
type MysteryCache = {
  id: string;
  gcCode: string;
  name: string;
  area: string;
  county?: string;
  country: string;
  region?: string;
  locality?: string;
  trip?: string;
  status: MysteryStatus;
  publishedLatitude: number;
  publishedLongitude: number;
  notes: string;
  clues: string[];
  image?: string;
  sharedWith: AppUser[];
  attempts: CoordinateAttempt[];
  sharedBy?: AppUser;
  sharedWorkspaceId?: string;
};
type SharedMysteryGrant = {
  workspaceId: string;
  mystery: MysteryCache;
  owner: AppUser;
  sharedWith: AppUser[];
};
type OwnedMysterySnapshot = {
  clientId: string;
  mystery: MysteryCache;
  revision: number;
  sharedWith: AppUser[];
};
type MysterySyncMetadata = { revision: number; fingerprint: string };
type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];
type BoundaryFeature = {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: PolygonCoordinates | MultiPolygonCoordinates };
};
type BoundaryFeatureCollection = { type: "FeatureCollection"; features: BoundaryFeature[] };

const HOSTED_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://geostats-api.hampusek.com";
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? "http://10.0.2.2:3001" : HOSTED_API_URL);
const ANDROID_MAP_PROVIDER = Platform.OS === "android" ? PROVIDER_GOOGLE : undefined;
const TOKEN_KEY = "geostats_session";
const SERVER_URL_KEY = "geostats_server_url";
const DEFAULT_AUTH_CONFIG: AuthConfig = __DEV__
  ? { mode: "password", providerName: "Home Auth" }
  : { mode: "external", providerName: "Shoo" };
const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const defaultTimeZone = "Europe/Stockholm";
const defaultFtfTerms = ["FTF", "first to find"];
const badgeTiers = ["Bronze", "Silver", "Gold", "Platinum", "Ruby", "Sapphire", "Emerald", "Diamond"];
const ACTIVE_IMPORT_STATUSES = new Set(["UPLOADED", "QUEUED", "PROCESSING"]);
const MAX_NATIVE_MAP_MARKERS = Platform.OS === "android" ? 500 : 1_000;
// Each Polygon is a native Google Maps view on Android. Large country and ADM2
// datasets can otherwise enqueue hundreds of views and more than 100k points in
// one render, which is enough to terminate the app on memory-constrained phones.
const MAX_SCRATCH_MAP_POLYGONS = Platform.OS === "android" ? 80 : 160;
const MAX_SCRATCH_MAP_VERTICES = Platform.OS === "android" ? 12_000 : 24_000;
const MAX_SCRATCH_RING_POINTS = Platform.OS === "android" ? 150 : 250;
const COUNTRY_GEOJSON_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
const SWEDEN_REGION_GEOJSON_URL = "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_regions.geojson";
const SWEDEN_COUNTY_GEOJSON_URL = "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_municipalities.geojson";
const GEOBOUNDARIES_BASE_URL =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen";
const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  "United States": ["United States of America"],
  "Russia": ["Russian Federation"],
  "South Korea": ["Republic of Korea"],
  "North Korea": ["Democratic People's Republic of Korea"],
  "Serbia": ["Republic of Serbia"],
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
// The country GeoJSON reports these ISO codes as the missing-value marker
// "-99", so use the codes expected by geoBoundaries for detail boundaries.
const COUNTRY_CODE_OVERRIDES: Record<string, string> = {
  France: "FRA",
  Kosovo: "XKX",
  Norway: "NOR"
};
type ScratchBoundaryConfig = { url: string; propertyName: string; isDetail: boolean };
const countryCodeCache = new Map<string, Promise<string | null>>();
const boundarySupportCache = new Map<string, Promise<boolean>>();
const scratchGeoJsonCache = new Map<string, Promise<BoundaryFeatureCollection>>();

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const screenDetails: Record<ScreenId, { label: string; eyebrow: string; icon: string }> = {
  dashboard: { label: "Home", eyebrow: "Your geocaching overview", icon: "⌂" },
  stats: { label: "Stats", eyebrow: "Patterns and progress", icon: "▥" },
  map: { label: "Map", eyebrow: "Every find in context", icon: "⌖" },
  explore: { label: "Explore", eyebrow: "All Geostats tools", icon: "✦" },
  profile: { label: "Profile", eyebrow: "Account and collectors", icon: "●" },
  scratch: { label: "Scratch Map", eyebrow: "Coverage around the world", icon: "◎" },
  milestones: { label: "Milestones", eyebrow: "Memorable firsts", icon: "◇" },
  ftf: { label: "First to Find", eyebrow: "Track your FTF history", icon: "⚑" },
  hides: { label: "Owned Caches", eyebrow: "Your hides and finders", icon: "△" },
  mysteries: { label: "Mysteries", eyebrow: "Solve and collaborate", icon: "?" },
  travel: { label: "Trip Planner", eyebrow: "Build a caching route", icon: "↗" },
  upload: { label: "Import Data", eyebrow: "Add caches to your archive", icon: "+" },
  imports: { label: "Import History", eyebrow: "Processing and recent files", icon: "↻" },
  profileHtml: { label: "Profile HTML", eyebrow: "Publish your statistics", icon: "</>" }
};

const primaryScreens: ScreenId[] = ["dashboard", "stats", "map", "explore", "profile"];
const exploreGroups: Array<{ title: string; subtitle: string; screens: ScreenId[] }> = [
  { title: "Maps & progress", subtitle: "See where you have cached and what comes next.", screens: ["scratch", "milestones", "ftf"] },
  { title: "Caching tools", subtitle: "Manage hides, puzzles, and upcoming trips.", screens: ["hides", "mysteries", "travel"] },
  { title: "Data & publishing", subtitle: "Keep your archive current and share your stats.", screens: ["upload", "imports", "profileHtml"] }
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

function displayServerHost(value: string) {
  try {
    return new URL(normalizeStoredServerUrl(value)).host || "Not configured";
  } catch {
    return value.trim() || "Not configured";
  }
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

function randomBase64Url(length: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = Crypto.getRandomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function mobileCodeVerifier() {
  return randomBase64Url(86);
}

async function apiFetch<T>(baseUrl: string, path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await expoFetch(`${baseUrl}${path}`, { ...options, headers });
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

function newId(prefix = "item") {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function mysteryFile(userId: string) {
  return new File(Paths.document, `geostats-mysteries-${userId.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function mysterySyncFile(userId: string) {
  return new File(Paths.document, `geostats-mystery-sync-${userId.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function snapshotFingerprint(value: string) {
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${value.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`;
}

async function readMysteries(userId: string) {
  try {
    const file = mysteryFile(userId);
    if (!file.exists) return [];
    const value = JSON.parse(await file.text());
    if (!Array.isArray(value)) return [];
    return value.map((cache: MysteryCache) => ({
      ...cache,
      area: cache.area ?? "",
      country: cache.country ?? "",
      clues: Array.isArray(cache.clues) ? cache.clues : [],
      attempts: Array.isArray(cache.attempts) ? cache.attempts : [],
      sharedWith: Array.isArray(cache.sharedWith) ? cache.sharedWith : []
    })) as MysteryCache[];
  } catch {
    return [];
  }
}

async function writeMysteries(userId: string, caches: MysteryCache[]) {
  mysteryFile(userId).write(JSON.stringify(caches));
}

async function readMysterySyncMetadata(userId: string) {
  try {
    const file = mysterySyncFile(userId);
    if (!file.exists) return new Map<string, MysterySyncMetadata>();
    const value = JSON.parse(await file.text()) as Record<string, MysterySyncMetadata>;
    return new Map(Object.entries(value).filter((entry): entry is [string, MysterySyncMetadata] => {
      const [cacheId, metadata] = entry;
      return Boolean(cacheId) && Number.isSafeInteger(metadata?.revision) && metadata.revision >= 0 && typeof metadata.fingerprint === "string";
    }));
  } catch {
    return new Map<string, MysterySyncMetadata>();
  }
}

async function writeMysterySyncMetadata(userId: string, metadata: Map<string, MysterySyncMetadata>) {
  mysterySyncFile(userId).write(JSON.stringify(Object.fromEntries(metadata)));
}

function mysteryLocation(cache: MysteryCache) {
  return [cache.locality, cache.area, cache.county, cache.region, cache.country]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
}

function inputCoordinate(attempt: CoordinateAttempt) {
  return Number.isFinite(attempt.latitude) && Number.isFinite(attempt.longitude)
    ? { latitude: attempt.latitude!, longitude: attempt.longitude! }
    : null;
}

function revealedCoordinate(attempt: CoordinateAttempt) {
  return Number.isFinite(attempt.finalLatitude) && Number.isFinite(attempt.finalLongitude)
    ? { latitude: attempt.finalLatitude!, longitude: attempt.finalLongitude! }
    : null;
}

function finalCoordinate(cache: MysteryCache) {
  for (const attempt of cache.attempts) {
    if (attempt.state !== "correct") continue;
    const coordinate = revealedCoordinate(attempt) ?? (attempt.kind !== "keyword" ? inputCoordinate(attempt) : null);
    if (coordinate) return coordinate;
  }
  return null;
}

function attemptLabel(attempt: CoordinateAttempt) {
  if (attempt.kind === "keyword") return attempt.answer?.trim() || "Keyword";
  const coordinate = inputCoordinate(attempt);
  return coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : "Invalid coordinate attempt";
}

function shareableMystery(cache: MysteryCache) {
  const { sharedBy: _sharedBy, sharedWorkspaceId: _workspace, ...mystery } = cache;
  return mystery;
}

function escapeMarkup(value: unknown) {
  return String(value ?? "").replace(/[<>&"']/g, (character) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[character] ?? character
  ));
}

function profileStatRows(rows: Array<[string, unknown]>) {
  return `<table border="0" cellpadding="6" cellspacing="1" style="width:740px;max-width:100%;margin:0 auto 14px;background:#c8d6cc;font-size:12px">${rows.map(([label, value]) => `<tr><td style="width:42%;background:#eef4ef;font-weight:bold">${escapeMarkup(label)}</td><td style="background:#fff">${value}</td></tr>`).join("")}</table>`;
}

function profileSection(title: string, body: string) {
  return `<div style="margin:18px auto 8px;max-width:740px;background:#426052;color:#fff;border:1px solid #23362d;font-weight:bold;line-height:24px;text-align:center">${escapeMarkup(title)}</div>${body}`;
}

function profileBucketSection(title: string, buckets: any[] = [], limit = 16) {
  if (!buckets.length) return "";
  return profileSection(title, profileStatRows(buckets.slice(0, limit).map((row) => [row.key ?? row.name, Number(row.count ?? 0).toLocaleString()])));
}

function profileMonthSection(buckets: CountBucket[] = []) {
  if (!buckets.length) return "";
  const counts = new Map(buckets.map((bucket) => [bucket.key, bucket.count]));
  const years = [...new Set(buckets.map((bucket) => bucket.key.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const header = `<tr><td style="background:#eef4ef;font-weight:bold">Year</td>${monthLabels.map((month) => `<td style="background:#eef4ef;font-weight:bold">${month}</td>`).join("")}<td style="background:#eef4ef;font-weight:bold">Total</td></tr>`;
  const rows = years.map((year) => {
    const values = monthLabels.map((_, index) => counts.get(`${year}-${String(index + 1).padStart(2, "0")}`) ?? 0);
    return `<tr><td style="background:#eef4ef;font-weight:bold">${year}</td>${values.map((value) => `<td style="background:#fff">${value || ""}</td>`).join("")}<td style="background:#eef4ef;font-weight:bold">${values.reduce((sum, value) => sum + value, 0)}</td></tr>`;
  }).join("");
  return profileSection("Finds by Month", `<table border="0" cellpadding="5" cellspacing="1" style="width:740px;max-width:100%;margin:0 auto 14px;background:#c8d6cc;font-size:11px;text-align:center">${header}${rows}</table>`);
}

function profileDifficultyTerrainSection(data: Array<{ difficulty: number; terrain: number; count: number }> = []) {
  if (!data.length) return "";
  const values = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];
  const counts = new Map(data.map((cell) => [`${cell.difficulty}/${cell.terrain}`, cell.count]));
  const header = `<tr><td style="background:#eef4ef;font-weight:bold">D/T</td>${values.map((value) => `<td style="background:#eef4ef;font-weight:bold">${value}</td>`).join("")}</tr>`;
  const rows = values.map((difficulty) => `<tr><td style="background:#eef4ef;font-weight:bold">${difficulty}</td>${values.map((terrain) => { const count = counts.get(`${Number(difficulty)}/${Number(terrain)}`) ?? 0; return `<td style="background:${count ? "#dff0e4" : "#fff"}">${count || ""}</td>`; }).join("")}</tr>`).join("");
  return profileSection("Difficulty / Terrain", `<table border="0" cellpadding="4" cellspacing="1" style="width:540px;max-width:100%;margin:0 auto 14px;background:#c8d6cc;font-size:11px;text-align:center">${header}${rows}</table>`);
}

function buildMobileProfileHtml(stats: any, profile: any, options: { ftf: boolean; hides: boolean; milestones: boolean }) {
  const summary = stats?.summaryNumbers ?? {};
  const ftf = stats?.ftfStats;
  const hides = stats?.hideStats;
  const milestoneRows = stats?.milestoneStats?.countMilestones ?? stats?.milestones ?? [];
  const optional = [
    options.milestones && milestoneRows.length
      ? profileSection("Milestones", profileStatRows(milestoneRows.slice(-12).map((row: any) => [row.count, `${escapeMarkup(row.gcCode)} ${escapeMarkup(row.name)} · ${escapeMarkup(dateText(row.date))}`])))
      : "",
    options.ftf && ftf
      ? profileSection("FTF Statistics", profileStatRows([["FTF finds", Number(ftf.total ?? 0).toLocaleString()], ["Percent of finds", `${Number(ftf.percentOfFinds ?? 0).toFixed(1)}%`], ["Average interval", ftf.averageIntervalDays == null ? "-" : `${Number(ftf.averageIntervalDays).toFixed(1)} days`]]))
      : "",
    options.hides && hides?.totalHides
      ? profileSection("Owned Caches", profileStatRows([["Owned caches", hides.totalHides], ["Active / archived", `${hides.activeHides ?? 0} / ${hides.archivedHides ?? 0}`], ["Received logs", hides.totalReceivedLogs ?? 0], ["Unique finders", hides.totalUniqueFinders ?? 0]]))
      : ""
  ].join("");
  return `<div id="geostats-profile" align="center" style="background:#e4ece6;font-family:Verdana,Arial,sans-serif;font-size:12px;color:#111;margin:1px;padding:12px;border:1px solid #8fa398"><div style="font-size:18px;font-weight:bold;color:#1f3329">${escapeMarkup(profile?.gcUsername || "Geocacher")} has ${Number(stats?.totalFinds ?? 0).toLocaleString()} finds</div><div style="margin:6px 0 18px;color:#42534a"><i>Statistics generated by Geostats on ${new Date().toLocaleDateString()}</i></div>${profileSection("Overview", profileStatRows([["Total finds", `<strong>${Number(stats?.totalFinds ?? 0).toLocaleString()}</strong>`], ["Countries cached in", stats?.countries?.length ?? 0], ["Caching days", summary.cachingDays ?? 0], ["Finds per caching day", Number(summary.findsPerCachingDay ?? 0).toFixed(2)], ["Best day", summary.bestDay ? `${summary.bestDay.count} on ${escapeMarkup(summary.bestDay.key)}` : "-"], ["Longest streak", `${stats?.streaks?.longest ?? 0} days`]]))}${profileMonthSection(stats?.findsByMonth)}${profileBucketSection("Countries", stats?.countries)}${profileBucketSection("Cache Types", stats?.cacheTypes, 12)}${profileBucketSection("Regions", stats?.regions)}${profileBucketSection("Counties / Municipalities", stats?.counties)}${profileDifficultyTerrainSection(stats?.difficultyTerrain)}${optional}<div style="max-width:740px;margin:18px auto 0;padding-top:10px;border-top:1px solid #b9c9bf;color:#42534a;font-size:11px">Generated with Geostats</div></div>`;
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

function regionForScratch(level: ScratchLevel, boundaryData: BoundaryFeatureCollection | null): Region {
  if (level === "countries" || !boundaryData) {
    return { latitude: 24, longitude: 11, latitudeDelta: 140, longitudeDelta: 170 };
  }

  const positions = boundaryData.features.flatMap((feature) => {
    const polygons = feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as PolygonCoordinates]
      : feature.geometry.coordinates as MultiPolygonCoordinates;
    return polygons.flatMap((polygon) => polygon[0] ?? []);
  });
  if (positions.length === 0) {
    return { latitude: 24, longitude: 11, latitudeDelta: 140, longitudeDelta: 170 };
  }

  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  positions.forEach(([longitude, latitude]) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
  });
  if (![minLatitude, maxLatitude, minLongitude, maxLongitude].every(Number.isFinite)) {
    return { latitude: 24, longitude: 11, latitudeDelta: 140, longitudeDelta: 170 };
  }
  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.2, (maxLatitude - minLatitude) * 1.2),
    longitudeDelta: Math.max(0.2, (maxLongitude - minLongitude) * 1.2)
  };
}

function geoBoundariesUrl(countryCode: string, level: Exclude<ScratchLevel, "countries">) {
  const boundaryLevel = level === "regions" ? "ADM1" : "ADM2";
  return `${GEOBOUNDARIES_BASE_URL}/${countryCode}/${boundaryLevel}/geoBoundaries-${countryCode}-${boundaryLevel}_simplified.geojson`;
}

function boundaryFileExists(url: string) {
  const cached = boundarySupportCache.get(url);
  if (cached) return cached;

  const request = fetch(url, { method: "HEAD" })
    .then((response) => {
      if (response.ok) return true;
      if (response.status !== 404 && response.status !== 410) boundarySupportCache.delete(url);
      return false;
    })
    .catch(() => {
      boundarySupportCache.delete(url);
      return false;
    });
  boundarySupportCache.set(url, request);
  return request;
}

function loadScratchGeoJson(url: string) {
  const cached = scratchGeoJsonCache.get(url);
  if (cached) return cached;

  const request = fetchJson<BoundaryFeatureCollection>(url).catch((error: unknown) => {
    scratchGeoJsonCache.delete(url);
    throw error;
  });
  scratchGeoJsonCache.set(url, request);
  return request;
}

async function countryCodeForScratch(countryName: string) {
  const key = countryName.trim().toLowerCase();
  const cached = countryCodeCache.get(key);
  if (cached) return cached;

  const request = loadScratchGeoJson(COUNTRY_GEOJSON_URL)
    .then((geoJson) => {
      const override = COUNTRY_CODE_OVERRIDES[countryName];
      if (override) return override;

      const names = new Set([countryName, ...(COUNTRY_NAME_ALIASES[countryName] ?? [])].map((name) => name.toLowerCase()));
      const feature = geoJson.features.find((candidate) =>
        names.has(String(candidate.properties?.name ?? "").trim().toLowerCase())
      );
      const countryCode = String(feature?.properties?.["ISO3166-1-Alpha-3"] ?? "").trim();
      return /^[A-Z]{3}$/.test(countryCode) ? countryCode : null;
    })
    .catch(() => {
      countryCodeCache.delete(key);
      return null;
    });
  countryCodeCache.set(key, request);
  return request;
}

async function boundaryConfigForLevel(level: ScratchLevel, selectedCountry?: string | null): Promise<ScratchBoundaryConfig> {
  if (level === "countries" || !selectedCountry) {
    return { url: COUNTRY_GEOJSON_URL, propertyName: "name", isDetail: false };
  }
  if (selectedCountry === "Sweden" && level === "regions") {
    return { url: SWEDEN_REGION_GEOJSON_URL, propertyName: "name", isDetail: true };
  }
  if (selectedCountry === "Sweden" && level === "counties") {
    return { url: SWEDEN_COUNTY_GEOJSON_URL, propertyName: "kom_namn", isDetail: true };
  }

  const countryCode = await countryCodeForScratch(selectedCountry);
  if (!countryCode) {
    return { url: COUNTRY_GEOJSON_URL, propertyName: "name", isDetail: false };
  }
  const url = geoBoundariesUrl(countryCode, level);
  return (await boundaryFileExists(url))
    ? { url, propertyName: "shapeName", isDetail: true }
    : { url: COUNTRY_GEOJSON_URL, propertyName: "name", isDetail: false };
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

function scratchRingArea(coordinates: Array<{ latitude: number; longitude: number }>) {
  if (coordinates.length === 0) return 0;
  let minLatitude = Infinity;
  let maxLatitude = -Infinity;
  let minLongitude = Infinity;
  let maxLongitude = -Infinity;
  for (const coordinate of coordinates) {
    minLatitude = Math.min(minLatitude, coordinate.latitude);
    maxLatitude = Math.max(maxLatitude, coordinate.latitude);
    minLongitude = Math.min(minLongitude, coordinate.longitude);
    maxLongitude = Math.max(maxLongitude, coordinate.longitude);
  }
  return (maxLatitude - minLatitude) * (maxLongitude - minLongitude);
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
  const geoJson = await loadScratchGeoJson(url);
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
  const [message, setMessage] = useState<string | null>(null);
  const [editingServer, setEditingServer] = useState(!apiBaseUrl);
  const [serverProbe, setServerProbe] = useState<ServerProbeState>({ url: null, status: "checking", config: DEFAULT_AUTH_CONFIG });
  const serverProbeId = useRef(0);
  const normalizedServerUrl = useMemo(() => {
    try {
      return normalizeServerUrl(serverUrl);
    } catch {
      return null;
    }
  }, [serverUrl]);
  const serverProbeMatches = serverProbe.url === normalizedServerUrl;
  const serverStatus = serverProbeMatches ? serverProbe.status : normalizedServerUrl ? "checking" : "unreachable";
  const config = serverProbeMatches && serverProbe.status === "connected" ? serverProbe.config : DEFAULT_AUTH_CONFIG;
  useEffect(() => {
    const probeId = ++serverProbeId.current;
    const controller = new AbortController();
    if (!normalizedServerUrl) {
      setServerProbe({ url: null, status: "unreachable", config: DEFAULT_AUTH_CONFIG });
      return () => {
        if (serverProbeId.current === probeId) serverProbeId.current += 1;
      };
    }
    setServerProbe({ url: normalizedServerUrl, status: "checking", config: DEFAULT_AUTH_CONFIG });
    const timeout = setTimeout(() => {
      void apiFetch<AuthConfig>(normalizedServerUrl, "/auth/config", null, { signal: controller.signal })
        .then((nextConfig) => {
          if (serverProbeId.current !== probeId || controller.signal.aborted) return;
          setServerProbe({ url: normalizedServerUrl, status: "connected", config: nextConfig });
        })
        .catch(() => {
          if (serverProbeId.current !== probeId || controller.signal.aborted) return;
          setServerProbe({ url: normalizedServerUrl, status: "unreachable", config: DEFAULT_AUTH_CONFIG });
        });
    }, 350);
    return () => {
      clearTimeout(timeout);
      controller.abort();
      if (serverProbeId.current === probeId) serverProbeId.current += 1;
    };
  }, [normalizedServerUrl]);
  async function saveServerUrl(): Promise<string | null> {
    let nextUrl: string;
    try {
      nextUrl = requireServerUrl(serverUrl);
    } catch (error) {
      setMessage(null);
      Alert.alert("Server URL required", error instanceof Error ? error.message : String(error));
      return null;
    }
    if (serverProbe.url !== nextUrl || serverProbe.status !== "connected") {
      Alert.alert("Server not connected", "Check the address and wait for a successful connection before saving it.");
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
    setEditingServer(false);
    return nextUrl;
  }
  async function pasteServerUrl() {
    const clipboardValue = (await Clipboard.getStringAsync()).trim();
    if (!clipboardValue) {
      setMessage("Copy a server address first, then tap Paste address.");
      return;
    }
    setMessage(null);
    setServerUrl(clipboardValue);
  }
  function useHostedServer() {
    setMessage(null);
    setServerUrl(HOSTED_API_URL);
  }
  async function toggleServerEditor() {
    if (!editingServer) {
      setEditingServer(true);
      return;
    }
    await saveServerUrl();
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
      const codeVerifier = mobileCodeVerifier();
      const authUrl = `${baseUrl}/auth/mobile/external?redirectUri=${encodeURIComponent(redirectUri)}&codeChallenge=${encodeURIComponent(codeVerifier)}`;
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
      if (result.type !== "success") {
        setMessage("Sign in was cancelled.");
        return;
      }
      const parsed = new URL(result.url);
      const params = new URLSearchParams(parsed.hash.replace(/^#/, "") || parsed.search.replace(/^\?/, ""));
      const authError = params.get("authError");
      const code = params.get("code");
      if (authError) {
        setMessage("External sign in failed.");
        return;
      }
      if (!code) {
        setMessage("External sign in did not return a session.");
        return;
      }
      const data = await apiFetch<Session>(baseUrl, "/auth/mobile/exchange", null, {
        method: "POST",
        body: JSON.stringify({ code, codeVerifier })
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.token);
      onSession(data, baseUrl);
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
        <View style={styles.serverCard}>
          <View style={styles.serverSummary}>
            <View style={styles.flex}>
              <Text style={styles.serverLabel}>Geostats server</Text>
              <Text style={styles.serverHost} numberOfLines={1}>{displayServerHost(serverUrl)}</Text>
            </View>
            <View style={[styles.connectionBadge, serverStatus === "connected" && styles.connectionBadgeConnected, serverStatus === "unreachable" && styles.connectionBadgeError]}>
              <Text style={styles.connectionBadgeText}>{serverStatus === "checking" ? "Checking" : serverStatus === "connected" ? "Connected" : "Not found"}</Text>
            </View>
          </View>
          <Pressable onPress={() => void toggleServerEditor()} style={styles.serverChangeButton}>
            <Text style={styles.textButtonText}>{editingServer ? "Done" : "Change server"}</Text>
          </Pressable>
          {editingServer ? (
            <View style={styles.serverEditor}>
              <Text style={styles.muted}>Use the hosted Geostats service, or enter the address supplied by your server administrator.</Text>
              <Pressable onPress={useHostedServer} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Use hosted Geostats</Text>
              </Pressable>
              <Field label="Self-hosted server address" value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" keyboardType="url" />
              <Pressable onPress={pasteServerUrl} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Paste address</Text>
              </Pressable>
              <Text style={styles.muted}>You can paste api.example.com; Geostats adds https:// automatically.</Text>
            </View>
          ) : null}
        </View>
        {config.mode === "external" ? (
          <>
            <PrimaryButton label={`${mode === "login" ? "Sign in" : "Register"} with ${config.providerName}`} onPress={continueExternal} />
            <Text style={styles.authAlternative}>or use a password</Text>
          </>
        ) : null}
        {config.mode !== "dev" ? (
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
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    let active = true;
    void Updates.checkForUpdateAsync()
      .then(async (result) => {
        if (!active || !result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (!active) return;
        Alert.alert("Geostats updated", "A new revision is ready.", [
          { text: "Later", style: "cancel" },
          { text: "Restart now", onPress: () => void Updates.reloadAsync() }
        ]);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
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
    const activePrimaryScreen = primaryScreens.includes(screen) ? screen : "explore";
    content = (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <View style={styles.shellHeader}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>G</Text></View>
            <View><Text style={styles.brandSmall}>Geostats</Text><Text style={styles.shellContext}>{screenDetails[screen].label}</Text></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => setScreen("profile")} style={styles.avatarButton}>
            <Text style={styles.avatarText}>{session.user.username.slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
        <ScrollView key={screen} style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
          <ScreenSwitch apiBaseUrl={apiBaseUrl} screen={screen} token={session.token} userId={session.user.id} username={session.user.username} onNavigate={setScreen} onLogout={logout} />
        </ScrollView>
        <View style={styles.bottomNav}>
          {primaryScreens.map((item) => {
            const detail = screenDetails[item];
            const active = activePrimaryScreen === item;
            return (
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} key={item} onPress={() => setScreen(item)} style={styles.bottomNavItem}>
                <View style={[styles.bottomNavIcon, active && styles.bottomNavIconActive]}><Text style={[styles.bottomNavGlyph, active && styles.bottomNavGlyphActive]}>{detail.icon}</Text></View>
                <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{detail.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    );
  }
  return <SafeAreaProvider>{content}</SafeAreaProvider>;
}

function ScreenSwitch({ apiBaseUrl, screen, token, userId, username, onNavigate, onLogout }: { apiBaseUrl: string; screen: ScreenId; token: string; userId: string; username: string; onNavigate: (screen: ScreenId) => void; onLogout: () => void }) {
  if (screen === "dashboard") return <DashboardScreen apiBaseUrl={apiBaseUrl} token={token} username={username} onNavigate={onNavigate} />;
  if (screen === "explore") return <ExploreScreen username={username} onNavigate={onNavigate} />;
  if (screen === "stats") return <StatsScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "map") return <MapScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "scratch") return <ScratchScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "milestones") return <MilestonesScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "ftf") return <FtfScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "hides") return <HidesScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "profileHtml") return <ProfileHtmlScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "mysteries") return <MysteriesScreen apiBaseUrl={apiBaseUrl} token={token} userId={userId} />;
  if (screen === "travel") return <TravelScreen userId={userId} />;
  if (screen === "upload") return <UploadScreen apiBaseUrl={apiBaseUrl} token={token} />;
  if (screen === "imports") return <ImportsScreen apiBaseUrl={apiBaseUrl} token={token} />;
  return <ProfileScreen apiBaseUrl={apiBaseUrl} token={token} onLogout={onLogout} />;
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

function ExploreScreen({ username, onNavigate }: { username: string; onNavigate: (screen: ScreenId) => void }) {
  return (
    <>
      <PageTitle eyebrow="Everything in one place" title="Explore Geostats" />
      <View style={styles.exploreIntro}>
        <Text style={styles.exploreIntroTitle}>Where to next, {username}?</Text>
        <Text style={styles.exploreIntroText}>Your maps, cache management, imports, puzzles, and publishing tools are organized below.</Text>
      </View>
      {exploreGroups.map((group) => (
        <View key={group.title} style={styles.exploreGroup}>
          <View style={styles.exploreGroupHeading}>
            <Text style={styles.exploreGroupTitle}>{group.title}</Text>
            <Text style={styles.muted}>{group.subtitle}</Text>
          </View>
          <View style={styles.featureGrid}>
            {group.screens.map((item) => <FeatureCard key={item} screen={item} onPress={() => onNavigate(item)} />)}
          </View>
        </View>
      ))}
    </>
  );
}

function DashboardScreen({ apiBaseUrl, token, username, onNavigate }: { apiBaseUrl: string; token: string; username: string; onNavigate: (screen: ScreenId) => void }) {
  const stats = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const imports = useApi<{ imports: ImportListItem[] }>(apiBaseUrl, token, "/imports", { imports: [] });
  const s = stats.data.stats;
  const latestImport = imports.data.imports[0];
  const importActive = latestImport && ACTIVE_IMPORT_STATUSES.has(latestImport.status);
  return (
    <>
      <PageTitle eyebrow={`Welcome back, ${username}`} title="Your cache archive" />
      <View style={styles.heroCard}>
        <View style={styles.heroGlow} />
        <Text style={styles.heroKicker}>{importActive ? "IMPORT IN PROGRESS" : "ARCHIVE AT A GLANCE"}</Text>
        <Text style={styles.heroValue}>{Number(s.totalFinds ?? 0).toLocaleString()}</Text>
        <Text style={styles.heroLabel}>lifetime finds across {s.countries?.length ?? 0} countries</Text>
        <View style={styles.heroActions}>
          <Pressable onPress={() => onNavigate("upload")} style={styles.heroPrimaryAction}><Text style={styles.heroPrimaryActionText}>＋ Import finds</Text></Pressable>
          <Pressable onPress={() => onNavigate("map")} style={styles.heroSecondaryAction}><Text style={styles.heroSecondaryActionText}>Open map  ›</Text></Pressable>
        </View>
      </View>
      <StatGrid rows={[["Total finds", s.totalFinds ?? 0], ["Cache types", s.cacheTypes?.length ?? 0], ["Countries", s.countries?.length ?? 0], ["Longest streak", `${s.streaks?.longest ?? 0} days`]]} />
      <View style={styles.quickActions}>
        {(["scratch", "milestones", "mysteries", "travel"] as ScreenId[]).map((item) => <QuickAction key={item} screen={item} onPress={() => onNavigate(item)} />)}
      </View>
      <Panel title="At a glance" subtitle={`Last import: ${dateText(imports.data.imports[0]?.createdAt)}`}>
        <Bars data={latestTwelveMonths(s.findsByMonth ?? [])} />
        <KeyValue rows={[["Best day", s.summaryNumbers?.bestDay ? `${s.summaryNumbers.bestDay.count} on ${s.summaryNumbers.bestDay.key}` : "-"], ["Best month", s.summaryNumbers?.bestMonth ? `${s.summaryNumbers.bestMonth.count} in ${s.summaryNumbers.bestMonth.key}` : "-"], ["Cache days", s.summaryNumbers?.cachingDays ?? 0], ["Average/day", s.summaryNumbers?.findsPerDay?.toFixed(2) ?? "0.00"], ["Average distance", s.distanceStats?.averageDistanceKm == null ? "-" : `${Math.round(s.distanceStats.averageDistanceKm)} km`]]} />
      </Panel>
      <Panel title="Keep your archive moving" subtitle="Pick up where you left off.">
        <WorkflowStep number="1" title="Import cache data" detail="Choose a My Finds GPX, My Hides GPX, or Pocket Query ZIP." done={imports.data.imports.length > 0} onPress={() => onNavigate("upload")} />
        <WorkflowStep number="2" title="Watch processing" detail="Imports refresh automatically while the server parses and recalculates." done={imports.data.imports.some((item) => item.status === "COMPLETED")} onPress={() => onNavigate("imports")} />
        <WorkflowStep number="3" title="Explore your archive" detail="Review statistics, maps, milestones, FTFs, and hides." done={(s.totalFinds ?? 0) > 0} onPress={() => onNavigate("stats")} />
        <WorkflowStep number="4" title="Plan the next trip" detail="Solve mystery caches, group them into trips, and open directions." done={false} onPress={() => onNavigate("mysteries")} />
      </Panel>
      <BadgesPanel apiBaseUrl={apiBaseUrl} stats={s} token={token} />
      <LoadState loading={stats.loading || imports.loading} error={stats.error || imports.error} />
    </>
  );
}

function StatsScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const [section, setSection] = useState("Overview");
  const s = data.stats;
  return (
    <>
      <PageTitle eyebrow="Your caching story" title="Statistics" />
      <StatGrid rows={[["Total finds", s.totalFinds ?? 0], ["Longest streak", `${s.streaks?.longest ?? 0} days`], ["Current streak", `${s.streaks?.current ?? 0} days`], ["Milestones", s.milestoneStats?.countMilestones?.length ?? 0]]} />
      <Segmented values={["Overview", "Patterns", "History"]} active={section} onPress={setSection} />
      {section === "Overview" ? <>
        <Panel title="Finds by month" subtitle="Rolling latest 12 months"><Bars data={latestTwelveMonths(s.findsByMonth ?? [])} /></Panel>
        <Panel title="Summary numbers"><KeyValue rows={[["Total days", s.summaryNumbers?.totalDays ?? 0], ["Finds/caching day", s.summaryNumbers?.findsPerCachingDay?.toFixed(2) ?? "0.00"], ["Finds/week", s.summaryNumbers?.findsPerWeek?.toFixed(2) ?? "0.00"], ["Last 365 finds", s.summaryNumbers?.last365Finds ?? 0]]} /></Panel>
        <Panel title="Difficulty / Terrain"><DifficultyGrid data={s.difficultyTerrain ?? []} /></Panel>
        <Panel title="Home distance">{s.distanceStats ? <><KeyValue rows={[["Average distance", s.distanceStats.averageDistanceKm == null ? "-" : `${Math.round(s.distanceStats.averageDistanceKm)} km`], ["Maximum distance", s.distanceStats.maxDistanceKm == null ? "-" : `${Math.round(s.distanceStats.maxDistanceKm)} km`], ["Bearing degrees", s.distanceStats.bearingBuckets?.filter((x: PercentBucket) => x.count > 0).length ?? 0]]} /><Text style={styles.sectionLabel}>Distance buckets</Text><Bars data={s.distanceStats.distanceBuckets ?? []} /><Text style={styles.sectionLabel}>Bearings from home</Text><Bars data={s.distanceStats.bearingBuckets ?? []} /></> : <Text style={styles.muted}>Set home coordinates in Profile to show distance and bearing stats.</Text>}</Panel>
      </> : null}
      {section === "Patterns" ? <>
        <BreakdownPanel title="Cache breakdowns" groups={[["Cache types", s.cacheTypes ?? []], ["Sizes", s.sizes ?? []], ["Countries", s.countries ?? []], ["Regions", s.regions ?? []], ["Counties / municipalities", s.counties ?? []], ["Finds by difficulty", s.findsByDifficulty ?? []], ["Finds by terrain", s.findsByTerrain ?? []], ["Finds by calendar month", s.findsByCalendarMonth ?? []], ["Finds by weekday", s.findsByWeekday ?? []], ["Finds by year placed", s.findsByPlacedYear ?? []], ["Finds to today for each year", s.findsToTodayByYear ?? []], ["Average difficulty per year", s.averageDifficultyPerYear ?? s.averageDifficultyByYear ?? []], ["Average terrain per year", s.averageTerrainPerYear ?? s.averageTerrainByYear ?? []], ["Top hiders", (s.ownerBuckets ?? []).slice(0, 20)]]} />
        <Panel title="Elevation"><Bars data={s.elevationBuckets ?? []} /></Panel>
      </> : null}
      {section === "History" ? <>
        <Panel title="Way to 81"><Rows rows={(s.wayTo81 ?? []).map((entry: any) => [String(entry.index), `${entry.gcCode} ${entry.name}`, `${entry.difficulty}/${entry.terrain}`])} /></Panel>
        <Panel title="Finds by found date"><CalendarHeatmap data={s.foundDateMatrix ?? []} /></Panel>
        <Panel title="Finds by hidden date"><CalendarHeatmap data={s.hiddenDateMatrix ?? []} /></Panel>
        <Panel title="Finds by hidden month"><MonthMatrix data={s.hiddenMonthMatrix ?? []} /></Panel>
        <Panel title="Finds per month and year"><MonthMatrix data={s.findsByMonth ?? []} /></Panel>
      </> : null}
      <LoadState loading={loading} error={error} />
    </>
  );
}

function MapScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const [points, setPoints] = useState<CachePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState("All");
  useEffect(() => {
    void Promise.allSettled([apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/caches", token), apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/hides", token)]).then(([finds, hides]) => {
      const findPoints = finds.status === "fulfilled" ? finds.value.points : [];
      const hidePoints = hides.status === "fulfilled" ? hides.value.points : [];
      setPoints([...findPoints, ...hidePoints]);
      if (finds.status === "rejected" && hides.status === "rejected") setError("Could not load map points.");
    });
  }, [apiBaseUrl, token]);
  const findCount = points.filter((p) => !p.isOwnHide).length;
  const visiblePoints = mapFilter === "Finds" ? points.filter((point) => !point.isOwnHide) : mapFilter === "Hides" ? points.filter((point) => point.isOwnHide) : points;
  const recent = [...visiblePoints].sort((a, b) => Date.parse(b.foundAt ?? b.placedAt ?? "") - Date.parse(a.foundAt ?? a.placedAt ?? "")).slice(0, 24);
  return (
    <>
      <PageTitle eyebrow="Your caching footprint" title="Map" />
      <StatGrid rows={[["Finds", findCount], ["Own hides", points.length - findCount]]} />
      <Segmented values={["All", "Finds", "Hides"]} active={mapFilter} onPress={setMapFilter} />
      <Panel title={`${visiblePoints.length.toLocaleString()} points in view`} subtitle="Tap a marker for cache details">
        <NativeMap key={mapFilter} points={visiblePoints} />
        <View style={styles.mapLegend}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: "#4ec878" }]} /><Text style={styles.muted}>Finds</Text></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: "#64d2a4" }]} /><Text style={styles.muted}>Own hides</Text></View>
          <Text style={styles.mapHint}>Showing up to {MAX_NATIVE_MAP_MARKERS.toLocaleString()} markers</Text>
        </View>
      </Panel>
      <Panel title="Recent locations" subtitle={`Latest ${mapFilter.toLowerCase()} in your archive`}>{recent.map((point) => <CacheRow key={`${point.isOwnHide ? "h" : "f"}-${point.gcCode}-${point.id}`} point={point} />)}</Panel>
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
  const [points, setPoints] = useState<CachePoint[]>([]);
  const [detailBuckets, setDetailBuckets] = useState<Record<string, LocationBucket[]>>({});
  const [resolvedConfig, setResolvedConfig] = useState<{
    level: ScratchLevel;
    country: string | null;
    config: ScratchBoundaryConfig;
  }>({
    level: "countries",
    country: null,
    config: { url: COUNTRY_GEOJSON_URL, propertyName: "name", isDetail: false }
  });
  const countries = data.countries ?? [];
  const baseActive = countries.find((c) => c.name === selected) ?? countries[0];
  const active = baseActive
    ? {
        ...baseActive,
        regions: detailBuckets[`${baseActive.name}:regions`] ?? baseActive.regions ?? [],
        counties: detailBuckets[`${baseActive.name}:counties`] ?? baseActive.counties ?? []
      }
    : baseActive;
  const configIsCurrent = resolvedConfig.level === level && resolvedConfig.country === (active?.name ?? null);
  const supportsDetail = level === "countries" || (configIsCurrent && resolvedConfig.config.isDetail);
  const effectiveLevel = supportsDetail ? level : "countries";
  const config = configIsCurrent
    ? resolvedConfig.config
    : { url: COUNTRY_GEOJSON_URL, propertyName: "name", isDetail: false };
  const levelBuckets = scratchBucketsForLevel(countries, active, effectiveLevel);
  const max = Math.max(1, data.maxCountryCount ?? 1);

  useEffect(() => {
    let mounted = true;
    void apiFetch<{ points: CachePoint[] }>(apiBaseUrl, "/map/caches", token)
      .then((pointData) => {
        if (mounted) setPoints(pointData.points);
      })
      .catch(() => {
        if (mounted) setPoints([]);
      });
    return () => {
      mounted = false;
    };
  }, [apiBaseUrl, token]);

  useEffect(() => {
    let mounted = true;
    const country = active?.name ?? null;
    void boundaryConfigForLevel(level, country).then((nextConfig) => {
      if (mounted) setResolvedConfig({ level, country, config: nextConfig });
    });
    return () => {
      mounted = false;
    };
  }, [active?.name, level]);

  useEffect(() => {
    if (!configIsCurrent) return;
    let mounted = true;
    setBoundaryData(null);
    setBoundaryError(null);
    void loadScratchGeoJson(config.url)
      .then((geoJson) => {
        if (mounted) setBoundaryData(geoJson);
      })
      .catch((err) => {
        if (mounted) setBoundaryError(err instanceof Error ? err.message : "Could not load map boundaries.");
      });
    return () => {
      mounted = false;
    };
  }, [config.url, configIsCurrent]);

  useEffect(() => {
    if (!configIsCurrent || !config.isDetail || level === "countries" || points.length === 0 || !active?.name) return;
    let mounted = true;
    const bucketKey = `${active.name}:${level}`;
    void deriveBucketsFromBoundaries(points, config.url, config.propertyName)
      .then((buckets) => {
        if (mounted) setDetailBuckets((current) => ({ ...current, [bucketKey]: buckets }));
      })
      .catch(() => {
        if (mounted) setDetailBuckets((current) => ({ ...current, [bucketKey]: [] }));
      });
    return () => {
      mounted = false;
    };
  }, [active?.name, config.isDetail, config.propertyName, config.url, configIsCurrent, level, points]);
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
            boundaryData={configIsCurrent ? boundaryData : null}
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
        {configIsCurrent && boundaryError ? <Text style={styles.error}>{boundaryError}</Text> : null}
        {level !== "countries" && configIsCurrent && !supportsDetail ? <Text style={styles.muted}>Region and county polygons are not available for this country.</Text> : null}
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
  const [extraFinds, setExtraFinds] = useState<any[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const s = summary.data.stats.ftfStats ?? {};
  const allFinds = [...finds.data.finds, ...extraFinds].filter((find, index, rows) => rows.findIndex((row) => row.id === find.id) === index);
  const visibleFinds = allFinds.filter((find) => !query.trim() || `${find.cache.gcCode} ${find.cache.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    setNextCursor(finds.data.nextCursor);
    setExtraFinds([]);
  }, [finds.data.finds]);
  async function toggle(find: any) {
    await apiFetch(apiBaseUrl, `/stats/ftf/finds/${find.id}`, token, { method: "PATCH", body: JSON.stringify({ isFtf: !find.isFtf }) });
    await Promise.all([summary.refresh(), finds.refresh()]);
  }
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<{ finds: any[]; nextCursor: string | null }>(apiBaseUrl, `/stats/ftf/finds?limit=100&cursor=${encodeURIComponent(nextCursor)}`, token);
      setExtraFinds((current) => [...current, ...page.finds]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="First to find" title="FTF" />
      <StatGrid rows={[["FTF finds", s.total ?? 0], ["Percent", s.percentOfFinds == null ? "-" : `${s.percentOfFinds.toFixed(2)}%`], ["Average interval", s.averageIntervalDays == null ? "-" : `${s.averageIntervalDays.toFixed(1)} days`], ["Archived", s.archivedCount ?? 0]]} />
      <Panel title="Some numbers"><KeyValue rows={[["First", s.first ? `${s.first.gcCode} ${dateText(s.first.dateTime)}` : "-"], ["Latest", s.latest ? `${s.latest.gcCode} ${dateText(s.latest.dateTime)}` : "-"], ["Best day", s.bestDay ? `${s.bestDay.count} on ${s.bestDay.key}` : "-"], ["Best month", s.bestMonth ? `${s.bestMonth.count} in ${s.bestMonth.key}` : "-"], ["Average distance", s.averageDistanceKm == null ? "-" : `${Math.round(s.averageDistanceKm)} km`]]} /></Panel>
      <BreakdownPanel title="FTF breakdowns" groups={[["FTF by year", s.byYear ?? []], ["FTF by month", s.byMonth ?? []], ["FTFs by calendar month", s.byCalendarMonth ?? []], ["FTFs by type", s.byType ?? []], ["FTFs by size", s.bySize ?? []], ["FTFs by difficulty", s.byDifficulty ?? []], ["FTFs by terrain", s.byTerrain ?? []], ["FTFs by country", s.byCountry ?? []], ["FTFs by region", s.byRegion ?? []], ["FTFs by weekday", s.byWeekday ?? []]]} />
      <Panel title="First FTF by location"><Rows rows={(s.firstByLocation ?? []).map((row: any) => [row.label, row.gcCode, row.name, dateText(row.date)])} /></Panel>
      <Panel title="First FTF by type"><Rows rows={(s.firstByType ?? []).map((row: any) => [row.label, row.gcCode, row.name, dateText(row.date)])} /></Panel>
      <Panel title="FTFs by found date"><CalendarHeatmap data={s.foundDateMatrix ?? []} /></Panel>
      <Panel title="FTF D/T chart"><DifficultyGrid data={s.byDifficultyTerrain ?? []} /></Panel>
      <Panel title="Way to 81 (FTF)"><Rows rows={(s.wayTo81 ?? []).map((row: any) => [String(row.index), row.gcCode, `${row.difficulty}/${row.terrain}`])} /></Panel>
      <Panel title="FTF map"><NativeMap points={(s.rows ?? []).map((row: any) => ({ id: `${row.gcCode}-${row.dateTime}`, gcCode: row.gcCode, name: row.name, cacheType: row.cacheType, latitude: row.latitude ?? Number.NaN, longitude: row.longitude ?? Number.NaN, foundAt: row.dateTime }))} /></Panel>
      <Panel title="FTF list">{(s.rows ?? []).map((row: any) => <CacheRow key={`${row.gcCode}-${row.dateTime}`} point={{ id: row.gcCode, gcCode: row.gcCode, name: row.name, cacheType: row.cacheType, latitude: row.latitude ?? 0, longitude: row.longitude ?? 0, foundAt: row.dateTime }} />)}</Panel>
      <Panel title="Mark FTF finds" subtitle={`${allFinds.length} loaded`}>
        <Field label="Search loaded finds" value={query} onChangeText={setQuery} autoCapitalize="none" />
        {visibleFinds.map((find) => <Pressable key={find.id} onPress={() => toggle(find)} style={[styles.toggleRow, find.isFtf && styles.toggleRowActive]}><Text style={styles.rowTitle}>{find.cache.gcCode} - {find.cache.name}</Text><Text style={styles.muted}>{find.isFtf ? "Marked FTF" : "Tap to mark"} - {dateText(find.foundAt)}</Text></Pressable>)}
        {nextCursor ? <SecondaryButton label={loadingMore ? "Loading..." : "Load 100 more"} onPress={loadMore} /> : null}
      </Panel>
      <LoadState loading={summary.loading || finds.loading} error={summary.error || finds.error} />
    </>
  );
}

function HidesScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const { data, loading, error } = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const h = data.stats.hideStats ?? {};
  const ownerGroups: Array<[string, any[]]> = [
    ["Cumulative logs on my caches", h.cumulativeReceivedLogsByMonth ?? []],
    ["Caching karma", h.receivedLogsByYear ?? []],
    ["Logs on hides by month", h.receivedLogsByMonth ?? []]
  ];
  if ((h.finderCountryBuckets ?? []).some((row: any) => row.key !== "Unknown" && row.count > 0)) {
    ownerGroups.push(["Finders by country", h.finderCountryBuckets ?? []]);
  }
  ownerGroups.push(
    ["Placed by year", h.hidesByYear ?? []],
    ["Placed by month", h.hidesByMonth ?? []],
    ["Placed by country", h.hidesByCountry ?? []],
    ["Placed by region", h.hidesByRegion ?? []],
    ["Top finders of my caches", h.finderBuckets ?? []],
    ["Received log types", h.receivedLogsByType ?? []],
    ["Placed by type", h.hidesByType ?? []],
    ["Placed by size", h.hidesBySize ?? []],
    ["Placed by difficulty", h.hidesByDifficulty ?? []],
    ["Placed by terrain", h.hidesByTerrain ?? []],
    ["Logs by calendar month", h.receivedLogsByCalendarMonth ?? []],
    ["Logs by weekday", h.receivedLogsByWeekday ?? []]
  );
  return (
    <>
      <PageTitle eyebrow="Owner statistics" title="Hides" />
      <StatGrid rows={[["Owned", h.totalHides ?? 0], ["Active", h.activeHides ?? 0], ["Received logs", h.totalReceivedLogs ?? 0], ["Finders", h.totalUniqueFinders ?? 0]]} />
      <BreakdownPanel title="Owner charts" groups={ownerGroups} />
      <Panel title="Owned cache statistics"><KeyValue rows={(h.hideSummaryRows ?? []).map((row: any) => [row.label, row.value])} /></Panel>
      <Panel title="Placed D/T chart"><DifficultyGrid data={h.hidesByDifficultyTerrain ?? []} /></Panel>
      <Panel title="Placed by hidden date"><CalendarHeatmap data={h.placedHiddenDateMatrix ?? []} /></Panel>
      <Panel title="Received by log date"><CalendarHeatmap data={h.receivedFoundDateMatrix ?? []} /></Panel>
      <Panel title="Logs received"><Rows rows={(h.logsReceived ?? []).map((row: any) => [row.gcCode, row.name, `${row.finds} logs`])} /></Panel>
      <Panel title="Recent imported logs"><Rows rows={(h.recentReceivedLogs ?? []).map((row: any) => [row.date, `${row.type} · ${row.finder}`, row.gcCode])} /></Panel>
      <LoadState loading={loading} error={error} />
    </>
  );
}

function UploadScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const imports = useApi<{ imports: ImportListItem[] }>(apiBaseUrl, token, "/imports", { imports: [] });
  useEffect(() => {
    if (!hasActiveImports(imports.data.imports)) return;
    const interval = setInterval(() => {
      void imports.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [imports.data.imports]);
  async function pickAndUpload(kind: UploadKind) {
    if (uploading) return;
    setUploading(true);
    try {
      await pickAndUploadDocument(kind, {
        pick: (options) => DocumentPicker.getDocumentAsync(options),
        createFile: (uri) => new File(uri),
        request: (path, body) => apiFetch(apiBaseUrl, path, token, { method: "POST", body }),
        refresh: imports.refresh,
        onMessage: setMessage
      });
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="Import pipeline" title="Upload cache data" />
      <Panel title="GPX or ZIP"><PrimaryButton label={uploading ? "Uploading..." : "Choose GPX or ZIP"} onPress={() => pickAndUpload("cache")} /></Panel>
      <Panel title="Owner log CSV"><PrimaryButton label={uploading ? "Uploading..." : "Choose CSV"} onPress={() => pickAndUpload("csv")} /><Text style={styles.muted}>Use the CSV command from Profile after importing My Hides data.</Text></Panel>
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

function ProfileScreen({ apiBaseUrl, token, onLogout }: { apiBaseUrl: string; token: string; onLogout: () => void }) {
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
      <Panel title="Account" subtitle="Your imported data remains on the selected Geostats server.">
        <SecondaryButton label="Sign out of Geostats" onPress={onLogout} danger />
      </Panel>
      <LoadState loading={profile.loading || tokens.loading} error={profile.error || tokens.error} />
    </>
  );
}

function ProfileHtmlScreen({ apiBaseUrl, token }: { apiBaseUrl: string; token: string }) {
  const stats = useApi<{ stats: any }>(apiBaseUrl, token, "/stats/summary", { stats: {} });
  const profile = useApi<{ profile: any }>(apiBaseUrl, token, "/profile", { profile: null });
  const [includeFtf, setIncludeFtf] = useState(true);
  const [includeHides, setIncludeHides] = useState(true);
  const [includeMilestones, setIncludeMilestones] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const html = useMemo(
    () => buildMobileProfileHtml(stats.data.stats, profile.data.profile, { ftf: includeFtf, hides: includeHides, milestones: includeMilestones }),
    [includeFtf, includeHides, includeMilestones, profile.data.profile, stats.data.stats]
  );
  const username = profile.data.profile?.gcUsername;
  const publicUrl = username ? `${apiBaseUrl}/public/profile-stats/${encodeURIComponent(username)}` : "";
  const embed = username
    ? `<a href="${publicUrl}" target="_top"><img src="${apiBaseUrl}/public/profile-stats-image/${encodeURIComponent(username)}" width="750"><br><img src="${apiBaseUrl}/public/profile-scratch-map-image/${encodeURIComponent(username)}" width="750"></a>`
    : "";
  async function copy(value: string, label: string) {
    await Clipboard.setStringAsync(value);
    setMessage(`${label} copied.`);
  }
  async function shareHtml() {
    const file = new File(Paths.cache, "geostats-profile.html");
    file.write(`<!doctype html><html><head><meta charset="utf-8"><title>Geostats profile</title></head><body>${html}</body></html>`);
    await Sharing.shareAsync(file.uri, { dialogTitle: "Share Geostats profile HTML", mimeType: "text/html", UTI: "public.html" });
  }
  return (
    <>
      <PageTitle eyebrow="Geocaching profile export" title="Profile HTML" />
      <Panel title="Include sections">
        <ToggleOption label="Milestones" active={includeMilestones} onPress={() => setIncludeMilestones((value) => !value)} />
        <ToggleOption label="FTF summary" active={includeFtf} onPress={() => setIncludeFtf((value) => !value)} />
        <ToggleOption label="Owned cache summary" active={includeHides} onPress={() => setIncludeHides((value) => !value)} />
      </Panel>
      <Panel title="Dynamic profile snippet" subtitle="Updates whenever Geostats recalculates your statistics.">
        <Text style={styles.codeText} selectable>{embed || "Set your geocaching username in Profile first."}</Text>
        <PrimaryButton label="Copy dynamic snippet" onPress={() => copy(embed, "Dynamic snippet")} />
        {publicUrl ? <Pressable onPress={() => Linking.openURL(publicUrl)}><Text style={styles.linkText}>Open public profile</Text></Pressable> : null}
      </Panel>
      <Panel title="Copyable HTML" subtitle={`${html.length.toLocaleString()} characters`}>
        <Text style={styles.codePreview} selectable numberOfLines={12}>{html}</Text>
        <PrimaryButton label="Copy HTML" onPress={() => copy(html, "Profile HTML")} />
        <SecondaryButton label="Share HTML file" onPress={shareHtml} />
      </Panel>
      {message ? <Text style={styles.note}>{message}</Text> : null}
      <LoadState loading={stats.loading || profile.loading} error={stats.error || profile.error} />
    </>
  );
}

function MysteriesScreen({ apiBaseUrl, token, userId }: { apiBaseUrl: string; token: string; userId: string }) {
  const [caches, setCaches] = useState<MysteryCache[]>([]);
  const [ready, setReady] = useState(false);
  const latestMysteries = useRef({ caches, ready });
  const serverSnapshots = useRef(new Map<string, string>());
  const snapshotRevisions = useRef(new Map<string, number>());
  const syncMetadata = useRef(new Map<string, MysterySyncMetadata>());
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [ownedLoadAttempt, setOwnedLoadAttempt] = useState(0);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"all" | MysteryStatus>("all");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [gcCode, setGcCode] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [published, setPublished] = useState("");
  const [attemptText, setAttemptText] = useState("");
  const [attemptState, setAttemptState] = useState<CheckState>("unchecked");
  const [clue, setClue] = useState("");
  const [shareQuery, setShareQuery] = useState("");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  latestMysteries.current = { caches, ready };

  function rememberSnapshotRevision(cacheId: string, revision: number) {
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    snapshotRevisions.current.set(cacheId, Math.max(snapshotRevisions.current.get(cacheId) ?? 0, revision));
  }

  function nextSnapshotRevision(cacheId: string) {
    const revision = (snapshotRevisions.current.get(cacheId) ?? 0) + 1;
    snapshotRevisions.current.set(cacheId, revision);
    return revision;
  }

  function rememberServerSnapshot(cacheId: string, revision: number, serialized: string) {
    rememberSnapshotRevision(cacheId, revision);
    serverSnapshots.current.set(cacheId, serialized);
    syncMetadata.current.set(cacheId, { revision, fingerprint: snapshotFingerprint(serialized) });
    void writeMysterySyncMetadata(userId, syncMetadata.current);
  }

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const [local, storedMetadata] = await Promise.all([
        readMysteries(userId),
        readMysterySyncMetadata(userId)
      ]);
      if (!active) return;
      if (!syncMetadata.current.size) {
        syncMetadata.current = storedMetadata;
        storedMetadata.forEach(({ revision }, cacheId) => rememberSnapshotRevision(cacheId, revision));
      }
      if (!latestMysteries.current.ready) {
        setCaches(local);
        setSelectedId(local[0]?.id ?? "");
        setReady(true);
      }
      const startingCaches = latestMysteries.current.ready ? latestMysteries.current.caches : local;
      const ownedAtRequest = new Map(startingCaches.filter((cache) => !cache.sharedBy).map((cache) => [
        cache.id,
        JSON.stringify(shareableMystery(cache))
      ]));
      const knownSyncMetadata = new Map(syncMetadata.current);

      try {
        const [owned, shared] = await Promise.all([
          apiFetch<{ mysteries: OwnedMysterySnapshot[]; deletedClientIds: string[] }>(apiBaseUrl, "/mysteries/owned", token),
          apiFetch<{ mysteries: SharedMysteryGrant[] }>(apiBaseUrl, "/mysteries/shared", token).catch(() => null)
        ]);
        if (!active) return;
        const deletedIds = new Set(owned.deletedClientIds);
        const ownedEntries = owned.mysteries
          .filter(({ clientId, mystery }) => mystery?.id === clientId && !deletedIds.has(clientId))
          .map(({ clientId, mystery, revision, sharedWith }) => {
            const cache = {
              ...mystery,
              id: clientId,
              sharedWith: Array.isArray(sharedWith) ? sharedWith : []
            };
            return { cache, revision, serialized: JSON.stringify(shareableMystery(cache)) };
          });
        const serverIds = new Set(ownedEntries.map(({ cache }) => cache.id));
        const available = latestMysteries.current.caches;
        const availableById = new Map(available.filter((cache) => !cache.sharedBy).map((cache) => [cache.id, cache]));
        const conflictCopies: MysteryCache[] = [];
        const reconciledOwned = ownedEntries.map(({ cache: serverCache, revision, serialized: serverSerialized }) => {
          const currentCache = availableById.get(serverCache.id);
          if (!currentCache) return serverCache;
          const currentSerialized = JSON.stringify(shareableMystery(currentCache));
          const requestSerialized = ownedAtRequest.get(serverCache.id);
          const metadata = knownSyncMetadata.get(serverCache.id);
          const localChanged = metadata
            ? snapshotFingerprint(currentSerialized) !== metadata.fingerprint
            : currentSerialized !== serverSerialized;
          const serverChanged = metadata
            ? revision !== metadata.revision
            : requestSerialized !== undefined && requestSerialized !== serverSerialized;
          const changedDuringRequest = requestSerialized !== undefined && currentSerialized !== requestSerialized;
          if ((localChanged || changedDuringRequest) && !serverChanged) return currentCache;
          if (localChanged || changedDuringRequest) {
            conflictCopies.push({
              ...shareableMystery(currentCache),
              id: newId("mystery"),
              name: `${currentCache.name} (device edits)`,
              sharedWith: []
            });
          }
          return serverCache;
        });
        ownedEntries.forEach(({ cache, revision, serialized }) => rememberServerSnapshot(cache.id, revision, serialized));
        const localOnly = available.filter((cache) =>
          !cache.sharedBy && !serverIds.has(cache.id) && !deletedIds.has(cache.id)
        );
        const sharedCaches = shared
          ? shared.mysteries.map((grant) => ({
              ...grant.mystery,
              sharedBy: grant.owner,
              sharedWith: grant.sharedWith,
              sharedWorkspaceId: grant.workspaceId
            }))
          : available.filter((cache) => cache.sharedBy);
        const next = [...reconciledOwned, ...conflictCopies, ...localOnly, ...sharedCaches];
        setCaches(next);
        setSelectedId((selected) => next.some((cache) => cache.id === selected) ? selected : (next[0]?.id ?? ""));
        if (conflictCopies.length) {
          setNotice(`${conflictCopies.length} local ${conflictCopies.length === 1 ? "edit was" : "edits were"} preserved as a separate device copy because the server also changed.`);
        }
        setAccountLoaded(true);
        setReady(true);
      } catch {
        if (!active) return;
        setAccountLoaded(false);
        setNotice("Could not load account mysteries. Showing device data and retrying…");
        retryTimer = setTimeout(() => setOwnedLoadAttempt((attempt) => attempt + 1), 3000);
      }
    })();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [apiBaseUrl, ownedLoadAttempt, token, userId]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void writeMysteries(userId, caches.filter((cache) => !cache.sharedBy));
    }, 150);
    return () => clearTimeout(timer);
  }, [caches, ready, userId]);

  useEffect(() => {
    if (!ready || !accountLoaded) return;
    const pending = caches.flatMap((cache) => {
      if (cache.sharedBy) return [];
      const serialized = JSON.stringify(shareableMystery(cache));
      return serverSnapshots.current.get(cache.id) === serialized ? [] : [{ cache, serialized }];
    });
    if (!pending.length) return;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      void Promise.all(pending.map(({ cache, serialized }) => {
        const requestedRevision = nextSnapshotRevision(cache.id);
        return apiFetch<{ revision: number; mystery: MysteryCache }>(
          apiBaseUrl,
          `/mysteries/${encodeURIComponent(cache.id)}`,
          token,
          {
            method: "PUT",
            body: JSON.stringify({ mystery: shareableMystery(cache), revision: requestedRevision })
          }
        ).then(({ revision, mystery }) => {
          const storedSerialized = JSON.stringify(mystery);
          rememberServerSnapshot(cache.id, revision, storedSerialized);
          if (storedSerialized !== serialized) {
            const authoritative = { ...mystery, sharedWith: cache.sharedWith };
            setCaches((current) => current.flatMap((item) => item.id === cache.id
              ? [
                  authoritative,
                  { ...shareableMystery(item), id: newId("mystery"), name: `${item.name} (device edits)`, sharedWith: [] }
                ]
              : [item]));
            setNotice(`A newer ${cache.gcCode} was already on the server. Your device edits were preserved as a separate copy.`);
          }
        });
      })).catch(() => {
        setNotice("Saved on this device; account sync will retry.");
        retryTimer = setTimeout(() => setSyncAttempt((attempt) => attempt + 1), 3000);
      });
    }, 500);
    return () => {
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [accountLoaded, apiBaseUrl, caches, ready, syncAttempt, token]);

  useEffect(() => () => {
    const latest = latestMysteries.current;
    if (!latest.ready) return;

    const owned = latest.caches.filter((cache) => !cache.sharedBy);
    void writeMysteries(userId, owned);
  }, [userId]);

  useEffect(() => {
    if (shareQuery.trim().length < 2) {
      setUsers([]);
      return;
    }
    const timer = setTimeout(() => {
      void apiFetch<{ users: AppUser[] }>(apiBaseUrl, `/auth/users?query=${encodeURIComponent(shareQuery.trim())}`, token)
        .then((result) => setUsers(result.users))
        .catch(() => setUsers([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [apiBaseUrl, shareQuery, token]);

  const visible = caches.filter((cache) => {
    const matchesFilter = filter === "all" || cache.status === filter;
    const normalized = query.trim().toLowerCase();
    return matchesFilter && (!normalized || `${cache.gcCode} ${cache.name} ${mysteryLocation(cache)} ${cache.trip ?? ""}`.toLowerCase().includes(normalized));
  });
  const selected = caches.find((cache) => cache.id === selectedId) ?? visible[0];

  function updateSelected(patch: Partial<MysteryCache>) {
    if (!selected || selected.sharedBy) return;
    const next = { ...selected, ...patch };
    setCaches((current) => current.map((cache) => cache.id === selected.id ? next : cache));
  }

  function addCache() {
    const coordinate = parseCoordinate(published);
    if (!/^GC[A-Z0-9]+$/i.test(gcCode.trim()) || !name.trim() || !coordinate) {
      setNotice("Enter a GC code, name, and valid decimal or geocaching coordinate.");
      return;
    }
    const cache: MysteryCache = {
      id: newId("mystery"),
      gcCode: gcCode.trim().toUpperCase(),
      name: name.trim(),
      area: location.trim(),
      country: country.trim(),
      status: "solving",
      publishedLatitude: coordinate.latitude,
      publishedLongitude: coordinate.longitude,
      notes: "",
      clues: [],
      sharedWith: [],
      attempts: []
    };
    setCaches((current) => [cache, ...current]);
    setSelectedId(cache.id);
    setGcCode(""); setName(""); setLocation(""); setCountry(""); setPublished(""); setShowAdd(false);
    setNotice("Mystery cache added.");
  }

  function addAttempt() {
    if (!selected || selected.sharedBy) return;
    const coordinate = parseCoordinate(attemptText);
    if (!coordinate) {
      setNotice("Use decimal coordinates or N 59° 20.123' E 018° 04.321'.");
      return;
    }
    if (selected.attempts.some((item) => {
      const previous = inputCoordinate(item);
      return item.kind !== "keyword" && item.state === attemptState && previous &&
        Math.abs(previous.latitude - coordinate.latitude) < 0.000001 &&
        Math.abs(previous.longitude - coordinate.longitude) < 0.000001;
    })) {
      setNotice("Those coordinates are already in the attempt history.");
      return;
    }
    updateSelected({
      attempts: [{ id: newId("attempt"), kind: "coordinate", ...coordinate, state: attemptState, createdAt: new Date().toISOString() }, ...selected.attempts],
      status: attemptState === "correct" ? "solved" : selected.status
    });
    setAttemptText("");
    setNotice("Coordinate saved.");
  }

  async function shareWith(user: AppUser) {
    if (!selected || selected.sharedBy || selected.sharedWith.some((person) => person.id === user.id)) return;
    try {
      const result = await apiFetch<{ recipient: AppUser; revision: number }>(apiBaseUrl, `/mysteries/${encodeURIComponent(selected.id)}/shares`, token, {
        method: "POST",
        body: JSON.stringify({
          recipientId: user.id,
          mystery: shareableMystery(selected),
          revision: nextSnapshotRevision(selected.id)
        })
      });
      rememberSnapshotRevision(selected.id, result.revision);
      updateSelected({ sharedWith: [...selected.sharedWith, result.recipient] });
      setShareQuery(""); setUsers([]); setNotice(`Shared with ${result.recipient.username}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not share this mystery.");
    }
  }

  async function removeShare(user: AppUser) {
    if (!selected || selected.sharedBy) return;
    try {
      await apiFetch(apiBaseUrl, `/mysteries/${encodeURIComponent(selected.id)}/shares/${encodeURIComponent(user.id)}`, token, { method: "DELETE" });
      updateSelected({ sharedWith: selected.sharedWith.filter((person) => person.id !== user.id) });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not stop sharing.");
    }
  }

  async function attachImage() {
    if (!selected || selected.sharedBy) return;
    const result = await DocumentPicker.getDocumentAsync({ type: "image/*", copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    if ((asset.size ?? 0) > 1_500_000) {
      setNotice("Choose an image smaller than 1.5 MB.");
      return;
    }
    const base64 = await new File(asset.uri).base64();
    updateSelected({ image: `data:${asset.mimeType ?? "image/jpeg"};base64,${base64}` });
    setNotice("Reference image attached.");
  }

  function deleteSelected() {
    if (!selected || selected.sharedBy) return;
    Alert.alert(`Delete ${selected.gcCode}?`, "Notes, clues, and coordinate attempts will be removed from your account and synced devices.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await apiFetch(apiBaseUrl, `/mysteries/${encodeURIComponent(selected.id)}`, token, { method: "DELETE" });
            serverSnapshots.current.delete(selected.id);
            snapshotRevisions.current.delete(selected.id);
            syncMetadata.current.delete(selected.id);
            void writeMysterySyncMetadata(userId, syncMetadata.current);
            const remaining = latestMysteries.current.caches.filter((cache) => cache.id !== selected.id);
            setCaches(remaining);
            setSelectedId(remaining[0]?.id ?? "");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not delete this mystery.");
          }
        }
      }
    ]);
  }

  async function exportSolved() {
    const solved = caches.flatMap((cache) => {
      const coordinate = finalCoordinate(cache);
      return coordinate ? [{ cache, coordinate }] : [];
    });
    const points = solved.map(({ cache, coordinate }) => `  <wpt lat="${coordinate.latitude}" lon="${coordinate.longitude}"><name>${escapeMarkup(cache.gcCode)}</name><desc>${escapeMarkup(cache.name)}</desc><type>Geocache|Unknown Cache</type></wpt>`).join("\n");
    const file = new File(Paths.cache, "geostats-solved-mysteries.gpx");
    file.write(`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">\n${points}\n</gpx>`);
    await Sharing.shareAsync(file.uri, { dialogTitle: `Share ${solved.length} solved mysteries`, mimeType: "application/gpx+xml", UTI: "com.topografix.gpx" });
  }

  return (
    <>
      <PageTitle eyebrow="Offline solving workspace" title="Mysteries" />
      <StatGrid rows={[["Caches", caches.length], ["Solved", caches.filter((cache) => cache.status === "solved").length], ["Planned", caches.filter((cache) => cache.status === "planned").length], ["Shared", caches.filter((cache) => cache.sharedBy || cache.sharedWith.length).length]]} />
      <View style={styles.actionRow}>
        <View style={styles.flex}><PrimaryButton label={showAdd ? "Close add form" : "Add mystery"} onPress={() => setShowAdd((value) => !value)} /></View>
        <View style={styles.flex}><SecondaryButton label="Export solved GPX" onPress={exportSolved} /></View>
      </View>
      {showAdd ? <Panel title="Add a mystery cache">
        <Field label="GC code" value={gcCode} onChangeText={setGcCode} autoCapitalize="characters" />
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Area" value={location} onChangeText={setLocation} />
        <Field label="Country" value={country} onChangeText={setCountry} />
        <Field label="Published coordinate" value={published} onChangeText={setPublished} placeholder="59.34312, 18.07341" />
        <PrimaryButton label="Add cache" onPress={addCache} />
      </Panel> : null}
      <Panel title="Mystery list">
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Code, name, trip, or area" />
        <Segmented values={["all", "solving", "solved", "planned"]} active={filter} onPress={(value) => setFilter(value as typeof filter)} />
        {visible.map((cache) => <Pressable key={`${cache.sharedBy?.id ?? "own"}-${cache.id}`} onPress={() => setSelectedId(cache.id)} style={[styles.cacheRow, selected?.id === cache.id && styles.selectedRow]}><Text style={styles.rowTitle}>{cache.gcCode} · {cache.name}</Text><Text style={styles.muted}>{cache.status} · {mysteryLocation(cache) || "No location"}{cache.sharedBy ? ` · from ${cache.sharedBy.username}` : ""}</Text></Pressable>)}
        {!visible.length ? <Text style={styles.muted}>No mysteries match this view.</Text> : null}
      </Panel>
      {selected ? <Panel title={`${selected.gcCode} · ${selected.name}`} subtitle={selected.sharedBy ? `Read-only shared workspace from ${selected.sharedBy.username}` : mysteryLocation(selected)}>
        <Segmented values={["solving", "solved", "planned"]} active={selected.status} disabled={Boolean(selected.sharedBy)} onPress={(value) => updateSelected({ status: value as MysteryStatus })} />
        <Field label="Trip / route" value={selected.trip ?? ""} editable={!selected.sharedBy} onChangeText={(value) => updateSelected({ trip: value })} />
        <Field label="Notes" value={selected.notes} editable={!selected.sharedBy} multiline style={styles.textArea} onChangeText={(value) => updateSelected({ notes: value })} />
        <Text style={styles.sectionLabel}>Reference image</Text>
        {selected.image ? <Image source={{ uri: selected.image }} resizeMode="cover" style={styles.mysteryImage} /> : <Text style={styles.muted}>No image attached.</Text>}
        {!selected.sharedBy ? <View style={styles.actionRow}><View style={styles.flex}><SecondaryButton label="Choose image" onPress={attachImage} /></View>{selected.image ? <View style={styles.flex}><SecondaryButton label="Remove image" danger onPress={() => updateSelected({ image: undefined })} /></View> : null}</View> : null}
        <Text style={styles.sectionLabel}>Clues</Text>
        {selected.clues.map((item) => <Pressable disabled={Boolean(selected.sharedBy)} key={item} onPress={() => updateSelected({ clues: selected.clues.filter((value) => value !== item) })}><Text style={styles.chip}>× {item}</Text></Pressable>)}
        {!selected.sharedBy ? <View style={styles.inlineForm}><TextInput style={[styles.input, styles.flex]} value={clue} onChangeText={setClue} placeholder="Add a clue" placeholderTextColor="#668074" /><Pressable style={styles.smallButton} onPress={() => { if (clue.trim()) updateSelected({ clues: [...selected.clues, clue.trim()] }); setClue(""); }}><Text style={styles.smallButtonText}>Add</Text></Pressable></View> : null}
        <Text style={styles.sectionLabel}>Coordinate attempts</Text>
        {!selected.sharedBy ? <>
          <Field label="Coordinate" value={attemptText} onChangeText={setAttemptText} placeholder="N 59° 20.123' E 018° 04.321'" />
          <Segmented values={["unchecked", "wrong", "correct"]} active={attemptState} onPress={(value) => setAttemptState(value as CheckState)} />
          <PrimaryButton label="Save coordinate" onPress={addAttempt} />
        </> : null}
        {selected.attempts.map((attempt) => {
          const revealed = revealedCoordinate(attempt);
          return <View key={attempt.id} style={styles.attemptRow}><View style={styles.flex}><Text style={styles.rowTitle}>{attemptLabel(attempt)}</Text>{revealed ? <Text style={styles.linkText}>Final: {revealed.latitude.toFixed(5)}, {revealed.longitude.toFixed(5)}</Text> : null}<Text style={styles.muted}>{attempt.kind === "keyword" ? "keyword" : "coordinate"} · {attempt.state} · {dateText(attempt.createdAt)}</Text></View>{!selected.sharedBy ? <Pressable onPress={() => updateSelected({ attempts: selected.attempts.filter((item) => item.id !== attempt.id) })}><Text style={styles.danger}>Remove</Text></Pressable> : null}</View>;
        })}
        {!selected.sharedBy ? <>
          <Text style={styles.sectionLabel}>Share with a Geostats user</Text>
          {selected.sharedWith.map((person) => <View key={person.id} style={styles.attemptRow}><Text style={styles.rowTitle}>{person.username}</Text><Pressable onPress={() => removeShare(person)}><Text style={styles.danger}>Remove</Text></Pressable></View>)}
          <Field label="Find user" value={shareQuery} onChangeText={setShareQuery} autoCapitalize="none" />
          {users.filter((user) => !selected.sharedWith.some((person) => person.id === user.id)).map((user) => <Pressable key={user.id} onPress={() => shareWith(user)} style={styles.cacheRow}><Text style={styles.linkText}>Share with {user.username}</Text></Pressable>)}
          <SecondaryButton label="Delete mystery" danger onPress={deleteSelected} />
        </> : null}
      </Panel> : null}
      {notice ? <Text style={styles.note}>{notice}</Text> : null}
      <LoadState loading={!ready} error={null} />
    </>
  );
}

function TravelScreen({ userId }: { userId: string }) {
  const [caches, setCaches] = useState<MysteryCache[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "unsolved">("all");
  useEffect(() => { void readMysteries(userId).then(setCaches); }, [userId]);
  const visible = caches.filter((cache) => {
    const isReady = Boolean(finalCoordinate(cache));
    const matchesFilter = filter === "all" || (filter === "ready" ? isReady : !isReady);
    const normalized = query.trim().toLowerCase();
    return matchesFilter && (!normalized || `${cache.gcCode} ${cache.name} ${cache.trip ?? ""} ${mysteryLocation(cache)}`.toLowerCase().includes(normalized));
  });
  const groups = visible.reduce<Record<string, MysteryCache[]>>((result, cache) => {
    const key = cache.trip?.trim() || cache.area.trim() || cache.county?.trim() || "Unassigned";
    (result[key] ??= []).push(cache);
    return result;
  }, {});
  const readyCount = caches.filter(finalCoordinate).length;
  const tripCount = new Set(caches.map((cache) => cache.trip?.trim()).filter(Boolean)).size;
  return (
    <>
      <PageTitle eyebrow="Routes and areas" title="Travel" />
      <Text style={styles.muted}>Collect solved coordinates into trips before you head out. Assign trips from Mysteries.</Text>
      <StatGrid rows={[["Trips", tripCount], ["Ready to find", readyCount], ["Still solving", Math.max(0, caches.length - readyCount)], ["Total caches", caches.length]]} />
      <Panel title="Travel plan">
        <Field label="Search" value={query} onChangeText={setQuery} placeholder="Trip, area, or cache" />
        <Segmented values={["all", "ready", "unsolved"]} active={filter} onPress={(value) => setFilter(value as typeof filter)} />
        {Object.entries(groups).map(([group, groupCaches]) => <View key={group} style={styles.routeGroup}><Text style={styles.panelTitle}>{group}</Text><Text style={styles.muted}>{groupCaches.filter(finalCoordinate).length}/{groupCaches.length} ready</Text>{groupCaches.map((cache) => {
          const coordinate = finalCoordinate(cache);
          return <Pressable key={cache.id} onPress={() => coordinate ? Linking.openURL(`https://maps.google.com/?q=${coordinate.latitude},${coordinate.longitude}`) : Linking.openURL(`https://coord.info/${cache.gcCode}`)} style={styles.cacheRow}><Text style={styles.rowTitle}>{coordinate ? "✓" : "○"} {cache.gcCode} · {cache.name}</Text><Text style={styles.muted}>{coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)} · tap for directions` : "Needs solution"} · {mysteryLocation(cache) || "No location"}</Text></Pressable>;
        })}</View>)}
        {!Object.keys(groups).length ? <Text style={styles.muted}>No caches for this view.</Text> : null}
      </Panel>
    </>
  );
}

function PageTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.pageTitle}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>;
}

function FeatureCard({ screen, onPress }: { screen: ScreenId; onPress: () => void }) {
  const detail = screenDetails[screen];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.featureCard, pressed && styles.pressed]}>
      <View style={styles.featureCardTop}>
        <View style={styles.featureIcon}><Text style={styles.featureIconText}>{detail.icon}</Text></View>
        <Text style={styles.featureArrow}>↗</Text>
      </View>
      <Text style={styles.featureTitle}>{detail.label}</Text>
      <Text style={styles.featureSubtitle} numberOfLines={2}>{detail.eyebrow}</Text>
    </Pressable>
  );
}

function QuickAction({ screen, onPress }: { screen: ScreenId; onPress: () => void }) {
  const detail = screenDetails[screen];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}>
      <Text style={styles.quickActionIcon}>{detail.icon}</Text>
      <Text style={styles.quickActionLabel}>{detail.label}</Text>
    </Pressable>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput placeholderTextColor="#76827c" style={[styles.input, rest.multiline && styles.textArea, style]} {...rest} /></View>;
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable onPress={onPress} style={[styles.secondaryButton, danger && styles.secondaryButtonDanger]}><Text style={[styles.secondaryButtonText, danger && styles.danger]}>{label}</Text></Pressable>;
}

function ToggleOption({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.optionRow}><Text style={[styles.optionMark, active && styles.optionMarkActive]}>{active ? "✓" : ""}</Text><Text style={styles.rowTitle}>{label}</Text></Pressable>;
}

function Segmented({ values, active, onPress, disabled = false }: { values: readonly string[]; active: string; onPress: (value: string) => void; disabled?: boolean }) {
  return <View style={styles.segmented}>{values.map((value) => <Pressable disabled={disabled} key={value} onPress={() => onPress(value)} style={[styles.segmentButton, active === value && styles.segmentButtonActive]}><Text style={[styles.segmentText, active === value && styles.segmentTextActive]}>{value}</Text></Pressable>)}</View>;
}

function WorkflowStep({ number, title, detail, done, onPress }: { number: string; title: string; detail: string; done: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.workflowStep}><Text style={[styles.workflowNumber, done && styles.workflowNumberDone]}>{done ? "✓" : number}</Text><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Text style={styles.linkText}>Open</Text></Pressable>;
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
  return <Panel title={title} subtitle="Tap a category to expand it">{groups.map(([label, data]) => <BreakdownGroup key={label} label={label} data={data} />)}</Panel>;
}

function BreakdownGroup({ label, data }: { label: string; data: any[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.breakdownGroup}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.breakdownToggle}>
        <View style={styles.flex}><Text style={styles.sectionLabel}>{label}</Text><Text style={styles.muted}>{data.length} categories</Text></View>
        <Text style={styles.breakdownChevron}>{expanded ? "−" : "+"}</Text>
      </Pressable>
      {expanded ? <View style={styles.breakdownContent}><Bars data={data} /></View> : null}
    </View>
  );
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
  const visible = validMapPoints(points).slice(0, MAX_NATIVE_MAP_MARKERS);
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
    .filter((item) => item.featureName && (level !== "countries" || item.bucket))
    .sort((left, right) => Number(Boolean(right.bucket)) - Number(Boolean(left.bucket)));
  const polygonCandidates: Array<{
    coordinates: Array<{ latitude: number; longitude: number }>;
    featureName: string;
    locationBucket: LocationBucket;
    key: string;
    priority: number;
  }> = [];
  for (const { feature, featureName, bucket } of features) {
    const locationBucket = bucket ?? { name: featureName, count: 0 };
    const rings = polygonOuterRings(feature, MAX_SCRATCH_RING_POINTS);
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const coordinates = rings[ringIndex]!;
      polygonCandidates.push({
        coordinates,
        featureName,
        locationBucket,
        key: `${featureName}-${ringIndex}`,
        // Keep covered/selected locations first, then retain mainlands and the
        // largest islands if the native geometry budget is reached.
        priority: (bucket ? 1_000_000 : 0) + (selectedName === featureName ? 1_000_000 : 0) + scratchRingArea(coordinates)
      });
    }
  }
  polygonCandidates.sort((left, right) => right.priority - left.priority);
  const polygons: typeof polygonCandidates = [];
  let vertexCount = 0;
  for (const candidate of polygonCandidates) {
    if (polygons.length >= MAX_SCRATCH_MAP_POLYGONS) break;
    if (vertexCount + candidate.coordinates.length > MAX_SCRATCH_MAP_VERTICES) continue;
    polygons.push(candidate);
    vertexCount += candidate.coordinates.length;
  }
  const region = regionForScratch(level, boundaryData);
  return (
    <View style={styles.nativeMapFrame}>
      <MapView key={`${activeCountry?.name ?? "world"}:${level}`} style={styles.nativeMap} initialRegion={region} provider={ANDROID_MAP_PROVIDER} showsCompass showsScale>
        {polygons.map(({ coordinates, featureName, key, locationBucket }) => (
          <Polygon
            key={key}
            coordinates={coordinates}
            fillColor={`${scratchColor(locationBucket.count, max)}aa`}
            strokeColor={selectedName && namesForScratchBucket(locationBucket, level).includes(selectedName) ? "#f3b34d" : "#dce8df"}
            strokeWidth={selectedName && namesForScratchBucket(locationBucket, level).includes(selectedName) ? 2 : 0.7}
            tappable
            onPress={() => onSelect(featureName)}
          />
        ))}
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
  return <View>{imports.map((item) => {
    const completed = item.status === "COMPLETED";
    const failed = item.status === "FAILED";
    return <View key={item.id} style={styles.importRow}><View style={styles.flex}><Text style={styles.rowTitle} numberOfLines={1}>{item.fileName}</Text><Text style={styles.muted}>{dateText(item.createdAt)} · {item.source}</Text>{item.errorMessage ? <Text style={styles.importError}>{item.errorMessage}</Text> : null}</View><Text style={[styles.statusPill, completed && styles.statusPillComplete, failed && styles.statusPillFailed]}>{completed ? "DONE" : item.status}</Text></View>;
  })}</View>;
}

function MilestoneList({ title, rows, labelKey = "label" }: { title: string; rows: any[]; labelKey?: string }) {
  return <Panel title={title}><Rows rows={rows.map((row) => [row[labelKey], row.gcCode, row.name, dateText(row.date)])} /></Panel>;
}

function BadgesPanel({ apiBaseUrl, stats, token }: { apiBaseUrl: string; stats: any; token: string }) {
  const scratch = useApi<{ countries: any[] }>(apiBaseUrl, token, "/map/scratch", { countries: [] });
  const [showAll, setShowAll] = useState(false);
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
          {countryBadges.slice(0, showAll ? 30 : 3).map((country) => (
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
      {badges.slice(0, showAll ? badges.length : 6).map((badge) => {
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
      {badges.length > 6 || countryBadges.length > 3 ? <SecondaryButton label={showAll ? "Show highlights only" : `View all ${badges.length} badges`} onPress={() => setShowAll((current) => !current)} /> : null}
    </Panel>
  );
}

function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <ActivityIndicator color="#f3b34d" style={styles.loader} />;
  if (error) return <Text style={styles.error}>{error}</Text>;
  return null;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#08120e" },
  safeCenter: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#08120e" },
  authPage: { flexGrow: 1, justifyContent: "center", padding: 22, gap: 14 },
  brand: { color: "#f3b34d", fontSize: 42, fontWeight: "900" },
  brandSmall: { color: "#f2f8f4", fontSize: 19, fontWeight: "900", letterSpacing: -0.5 },
  shellHeader: { minHeight: 62, paddingHorizontal: 18, paddingVertical: 9, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#193126" },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandMark: { width: 35, height: 35, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#f3b34d" },
  brandMarkText: { color: "#122018", fontSize: 19, fontWeight: "900" },
  shellContext: { color: "#799387", fontSize: 11, fontWeight: "700", marginTop: 1 },
  avatarButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: "#173126", borderWidth: 1, borderColor: "#345444" },
  avatarText: { color: "#f3b34d", fontSize: 15, fontWeight: "900" },
  bottomNav: { minHeight: 68, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 6, paddingTop: 6, paddingBottom: 4, backgroundColor: "#0b1812", borderTopWidth: 1, borderColor: "#1b3629" },
  bottomNavItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  bottomNavIcon: { minWidth: 38, height: 27, paddingHorizontal: 10, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  bottomNavIconActive: { backgroundColor: "#f3b34d" },
  bottomNavGlyph: { color: "#8fa69a", fontSize: 18, lineHeight: 21, fontWeight: "900" },
  bottomNavGlyphActive: { color: "#142018" },
  bottomNavLabel: { color: "#778e82", fontSize: 10, fontWeight: "700" },
  bottomNavLabelActive: { color: "#e9f2ec" },
  content: { flex: 1 },
  contentInner: { paddingHorizontal: 17, paddingTop: 20, paddingBottom: 30, gap: 15 },
  pageTitle: { marginBottom: 3, gap: 3 },
  eyebrow: { color: "#83a393", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.1, fontWeight: "900" },
  title: { color: "#f1f8f3", fontSize: 32, lineHeight: 37, letterSpacing: -1, fontWeight: "900" },
  muted: { color: "#91a79c", fontSize: 13 },
  heroCard: { minHeight: 238, overflow: "hidden", borderRadius: 24, padding: 20, justifyContent: "flex-end", backgroundColor: "#1d5534", borderWidth: 1, borderColor: "#34714d" },
  heroGlow: { position: "absolute", width: 210, height: 210, borderRadius: 105, right: -60, top: -85, backgroundColor: "#377a4e", opacity: 0.72 },
  heroKicker: { color: "#c9e2d3", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  heroValue: { color: "#fff8e9", fontSize: 62, lineHeight: 68, letterSpacing: -2.5, fontWeight: "900" },
  heroLabel: { color: "#d2e4d8", fontSize: 14, fontWeight: "700" },
  heroActions: { flexDirection: "row", gap: 9, marginTop: 19 },
  heroPrimaryAction: { backgroundColor: "#f3b34d", borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 },
  heroPrimaryActionText: { color: "#172016", fontWeight: "900" },
  heroSecondaryAction: { backgroundColor: "#143b25", borderRadius: 13, paddingHorizontal: 15, paddingVertical: 12 },
  heroSecondaryActionText: { color: "#ecf7ef", fontWeight: "900" },
  quickActions: { flexDirection: "row", gap: 8 },
  quickAction: { flex: 1, minWidth: 0, minHeight: 72, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 15, backgroundColor: "#0f2119", borderWidth: 1, borderColor: "#203c2f" },
  quickActionIcon: { color: "#f3b34d", fontSize: 19, fontWeight: "900" },
  quickActionLabel: { color: "#c8d7ce", fontSize: 10, fontWeight: "800", textAlign: "center" },
  exploreIntro: { borderRadius: 18, backgroundColor: "#163525", borderWidth: 1, borderColor: "#28543b", padding: 17, gap: 4 },
  exploreIntroTitle: { color: "#f1f8f3", fontSize: 19, fontWeight: "900" },
  exploreIntroText: { color: "#a8bdb1", fontSize: 13, lineHeight: 19 },
  exploreGroup: { gap: 11, marginTop: 4 },
  exploreGroupHeading: { gap: 2, paddingHorizontal: 2 },
  exploreGroupTitle: { color: "#e8f2eb", fontSize: 17, fontWeight: "900" },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  featureCard: { width: "48%", minHeight: 145, borderRadius: 18, padding: 15, justifyContent: "flex-end", backgroundColor: "#0e2118", borderWidth: 1, borderColor: "#234234" },
  featureCardTop: { position: "absolute", left: 14, right: 14, top: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  featureIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#1b422d", alignItems: "center", justifyContent: "center" },
  featureIconText: { color: "#f3b34d", fontSize: 17, fontWeight: "900" },
  featureArrow: { color: "#6f8d7d", fontSize: 17, fontWeight: "900" },
  featureTitle: { color: "#edf6f0", fontSize: 15, fontWeight: "900" },
  featureSubtitle: { color: "#839b8f", fontSize: 11, lineHeight: 15, marginTop: 3 },
  pressed: { opacity: 0.68, transform: [{ scale: 0.98 }] },
  authAlternative: { color: "#91a79c", fontSize: 13, textAlign: "center" },
  note: { color: "#dce8df", backgroundColor: "#10251b", borderRadius: 8, padding: 12 },
  error: { color: "#ffb4a8", backgroundColor: "#421c17", borderRadius: 8, padding: 12 },
  field: { gap: 6 },
  fieldLabel: { color: "#c9d8cf", fontWeight: "800" },
  input: { borderWidth: 1, borderColor: "#294839", borderRadius: 13, color: "#eef8f0", backgroundColor: "#0c1b14", paddingHorizontal: 14, paddingVertical: 13 },
  serverCard: { backgroundColor: "#0d1f17", borderColor: "#1d3a2c", borderWidth: 1, borderRadius: 18, padding: 16, gap: 11 },
  serverSummary: { flexDirection: "row", alignItems: "center", gap: 12 },
  serverLabel: { color: "#91a79c", fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  serverHost: { color: "#edf7ef", fontSize: 16, fontWeight: "900", marginTop: 2 },
  connectionBadge: { backgroundColor: "#59441b", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  connectionBadgeConnected: { backgroundColor: "#1e5a36" },
  connectionBadgeError: { backgroundColor: "#6b2922" },
  connectionBadgeText: { color: "#f3f7f4", fontSize: 11, fontWeight: "900" },
  serverChangeButton: { alignSelf: "flex-start", paddingVertical: 4 },
  serverEditor: { borderTopWidth: 1, borderColor: "#294839", paddingTop: 12, gap: 10 },
  textArea: { minHeight: 110, textAlignVertical: "top" },
  primaryButton: { backgroundColor: "#f3b34d", borderRadius: 13, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  primaryButtonText: { color: "#172016", fontWeight: "900" },
  secondaryButton: { borderColor: "#365346", borderWidth: 1, borderRadius: 13, paddingVertical: 13, paddingHorizontal: 12, alignItems: "center", marginTop: 4 },
  secondaryButtonDanger: { borderColor: "#8d4339" },
  secondaryButtonText: { color: "#dce8df", fontWeight: "900" },
  textButton: { padding: 8, alignItems: "center" },
  textButtonText: { color: "#f3b34d", fontWeight: "800" },
  panel: { backgroundColor: "#0d1f17", borderColor: "#1d3a2c", borderWidth: 1, borderRadius: 18, padding: 16, gap: 13 },
  panelHeading: { gap: 2 },
  panelTitle: { color: "#edf7ef", fontSize: 18, letterSpacing: -0.3, fontWeight: "900" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "48%", minHeight: 83, justifyContent: "center", backgroundColor: "#10251b", borderColor: "#234536", borderWidth: 1, borderRadius: 16, padding: 14 },
  statValue: { color: "#f3b34d", fontSize: 25, letterSpacing: -0.6, fontWeight: "900" },
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
  breakdownGroup: { borderTopWidth: 1, borderColor: "#1b3729" },
  breakdownToggle: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 9 },
  breakdownChevron: { width: 28, height: 28, borderRadius: 14, overflow: "hidden", color: "#f3b34d", backgroundColor: "#173326", textAlign: "center", lineHeight: 27, fontSize: 19, fontWeight: "700" },
  breakdownContent: { paddingBottom: 14 },
  sectionLabel: { color: "#dce8df", fontWeight: "900", marginTop: 6 },
  segmented: { flexDirection: "row", gap: 5, backgroundColor: "#10251b", borderRadius: 14, padding: 4 },
  segmentButton: { flex: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center" },
  segmentButtonActive: { backgroundColor: "#f3b34d" },
  segmentText: { color: "#b9c8bf", fontWeight: "800", textTransform: "capitalize" },
  segmentTextActive: { color: "#172016" },
  actionRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  workflowStep: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 11 },
  workflowNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#244535", color: "#dce8df", textAlign: "center", lineHeight: 28, fontWeight: "900" },
  workflowNumberDone: { backgroundColor: "#f3b34d", color: "#172016" },
  inlineForm: { flexDirection: "row", gap: 8, alignItems: "center" },
  smallButton: { backgroundColor: "#f3b34d", borderRadius: 8, paddingHorizontal: 15, paddingVertical: 12 },
  smallButtonText: { color: "#172016", fontWeight: "900" },
  selectedRow: { backgroundColor: "#173326", paddingHorizontal: 8, borderRadius: 6 },
  chip: { color: "#dce8df", backgroundColor: "#173326", alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, marginBottom: 4 },
  attemptRow: { flexDirection: "row", gap: 10, alignItems: "center", borderTopWidth: 1, borderColor: "#1b3729", paddingVertical: 10 },
  routeGroup: { borderTopWidth: 1, borderColor: "#294839", paddingTop: 14, marginTop: 6, gap: 3 },
  mysteryImage: { width: "100%", height: 210, borderRadius: 8, backgroundColor: "#14271d" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  optionMark: { width: 22, height: 22, borderWidth: 1, borderColor: "#668074", borderRadius: 5, color: "#172016", textAlign: "center", lineHeight: 20, fontWeight: "900" },
  optionMarkActive: { backgroundColor: "#f3b34d", borderColor: "#f3b34d" },
  codeText: { color: "#dce8df", backgroundColor: "#07110d", padding: 10, borderRadius: 6, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 11, lineHeight: 16 },
  codePreview: { color: "#b9c8bf", backgroundColor: "#07110d", padding: 10, minHeight: 150, borderRadius: 6, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }), fontSize: 10, lineHeight: 14 },
  linkText: { color: "#f3b34d", fontWeight: "800" },
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
  mapLegend: { flexDirection: "row", alignItems: "center", gap: 13, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  mapHint: { flex: 1, color: "#6f8a7c", fontSize: 10, textAlign: "right" },
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
  importError: { color: "#ffb4a8", fontSize: 12, marginTop: 3 },
  statusPill: { color: "#3c2d0c", backgroundColor: "#f3b34d", borderRadius: 999, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, fontSize: 10, fontWeight: "900" },
  statusPillComplete: { color: "#dff8e8", backgroundColor: "#22613b" },
  statusPillFailed: { color: "#ffe4df", backgroundColor: "#7a3128" },
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
