import { canonicalCacheTypeName } from "@geostats/shared";

export type PersonalCacheMetadata = {
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  county: string | null;
  hiddenDate: Date | null;
  ownerName: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  const candidate = typeof value === "object" ? record(value).text : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function number(value: unknown, minimum: number, maximum: number): number | null {
  const candidate = typeof value === "object" ? record(value).text : value;
  if (typeof candidate !== "number" && typeof candidate !== "string") return null;
  if (typeof candidate === "string" && !candidate.trim()) return null;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function validatedMetadata(value: Record<string, unknown>): Partial<PersonalCacheMetadata> {
  const result: Partial<PersonalCacheMetadata> = {};
  const name = text(value.name);
  if (name) result.name = name;
  for (const key of ["size", "country", "region", "county", "ownerName"] as const) {
    if (key in value) result[key] = text(value[key]);
  }
  if ("cacheType" in value) result.cacheType = canonicalCacheTypeName(text(value.cacheType));
  for (const key of ["difficulty", "terrain"] as const) {
    if (key in value) result[key] = number(value[key], 1, 5);
  }
  const latitude = number(value.latitude, -90, 90);
  const longitude = number(value.longitude, -180, 180);
  if (latitude !== null && longitude !== null) {
    result.latitude = latitude;
    result.longitude = longitude;
  }
  if ("hiddenDate" in value) {
    const candidate = value.hiddenDate instanceof Date ? value.hiddenDate : text(value.hiddenDate);
    const date = candidate instanceof Date ? new Date(candidate.getTime()) : candidate ? new Date(candidate) : null;
    result.hiddenDate = date && Number.isFinite(date.getTime()) ? date : null;
  }
  return result;
}

/** Call only with raw loaded through the requesting user's UserCacheData relation. */
export function personalCacheMetadata(cache: { metadataTrusted?: boolean }, scopedRaw: unknown): Partial<PersonalCacheMetadata> {
  if (cache.metadataTrusted !== false) return {};
  const raw = record(scopedRaw);
  if (!Object.keys(raw).length) return {};
  const extensions = record(raw.extensions);
  const extension = record(raw["groundspeak:cache"] ?? raw.cache ?? extensions["groundspeak:cache"] ?? extensions.cache);
  const field = (name: string) => extension[`groundspeak:${name}`] ?? extension[name];
  const legacy = validatedMetadata({
    name: text(field("name")) ?? text(raw.desc),
    cacheType: text(field("type")) ?? text(raw.type),
    difficulty: field("difficulty"), terrain: field("terrain"),
    size: field("container"), latitude: raw.lat, longitude: raw.lon,
    country: field("country"), region: field("state"), county: field("county"),
    hiddenDate: raw.time ?? field("date_hidden"),
    ownerName: text(field("owner")) ?? text(field("placed_by"))
  });
  return { ...legacy, ...validatedMetadata(record(raw.geostatsMetadata)) };
}

/** Store only normalized private metadata; raw cannot grant catalog authority. */
export function privateCacheRaw(raw: unknown, metadata: Partial<PersonalCacheMetadata>): Record<string, unknown> {
  const normalized = validatedMetadata(record(metadata));
  return {
    ...record(raw),
    geostatsMetadata: {
      ...normalized,
      hiddenDate: normalized.hiddenDate?.toISOString() ?? null,
      ownerNameNormalized: normalized.ownerName?.trim().toLowerCase() ?? null
    }
  };
}
