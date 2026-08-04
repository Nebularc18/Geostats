import type { ScratchMapLevel } from "../components/scratch-map";

export const COUNTRY_GEOJSON_URL =
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
export const SWEDEN_REGION_GEOJSON_URL =
  "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_regions.geojson";
export const SWEDEN_COUNTY_GEOJSON_URL =
  "https://raw.githubusercontent.com/okfse/sweden-geojson/master/swedish_municipalities.geojson";
export const GEOBOUNDARIES_BASE_URL =
  "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen";

export type ScratchBoundaryConfig = {
  url: string;
  propertyName: string;
  center: [number, number];
  zoom: number;
  isDetail: boolean;
};

type CountryFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    properties?: Record<string, unknown> | null;
  }>;
};

const UNKNOWN_LOCATION_NAMES = new Set(["", "none", "unknown", "not chosen"]);
const countryGeoJsonCache = new Map<string, Promise<CountryFeatureCollection>>();
const countryCodeCache = new Map<string, Promise<string | null>>();
const countryFlagCodeCache = new Map<string, Promise<string | null>>();
const boundarySupportCache = new Map<string, Promise<boolean>>();

const countryConfig: ScratchBoundaryConfig = {
  url: COUNTRY_GEOJSON_URL,
  propertyName: "name",
  center: [11, 24],
  zoom: 1.22,
  isDetail: false
};

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

// The Natural Earth-derived country file uses "-99" when an ISO code is
// missing, including for these countries with geoBoundaries coverage.
const COUNTRY_CODE_OVERRIDES: Record<string, string> = {
  France: "FRA",
  Kosovo: "XKX",
  Norway: "NOR"
};

export function countryNamesForBoundary(countryName: string) {
  return [countryName, ...(COUNTRY_NAME_ALIASES[countryName] ?? [])];
}

export function isUnknownLocationName(name: string | null | undefined) {
  return UNKNOWN_LOCATION_NAMES.has((name ?? "").trim().toLowerCase());
}

export function filterKnownLocationBuckets<T extends { name: string }>(buckets: T[]) {
  return buckets.filter((bucket) => !isUnknownLocationName(bucket.name));
}

function geoBoundariesUrl(countryCode: string, level: Extract<ScratchMapLevel, "regions" | "counties">) {
  const boundaryLevel = level === "regions" ? "ADM1" : "ADM2";
  return `${GEOBOUNDARIES_BASE_URL}/${countryCode}/${boundaryLevel}/geoBoundaries-${countryCode}-${boundaryLevel}_simplified.geojson`;
}

function boundaryFileExists(url: string) {
  const existing = boundarySupportCache.get(url);
  if (existing) {
    return existing;
  }

  const request = fetch(url, { method: "HEAD" })
    .then((response) => response.ok)
    .catch(() => false);
  boundarySupportCache.set(url, request);
  return request;
}

function loadCountryGeoJson(url: string) {
  const existing = countryGeoJsonCache.get(url);
  if (existing) {
    return existing;
  }

  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("Could not load country boundary data");
      }
      return (await response.json()) as CountryFeatureCollection;
    })
    .catch((error: unknown) => {
      countryGeoJsonCache.delete(url);
      throw error;
    });
  countryGeoJsonCache.set(url, request);
  return request;
}

async function loadCountryCode(countryName: string) {
  const key = countryName.trim().toLowerCase();
  const existing = countryCodeCache.get(key);
  if (existing) {
    return existing;
  }

  const request = loadCountryGeoJson(COUNTRY_GEOJSON_URL)
    .then((geoJson) => {
      const override = COUNTRY_CODE_OVERRIDES[countryName];
      if (override) {
        return override;
      }

      const names = new Set(countryNamesForBoundary(countryName).map((name) => name.toLowerCase()));
      const feature = geoJson.features.find((candidate) =>
        names.has(String(candidate.properties?.name ?? "").trim().toLowerCase())
      );
      const countryCode = String(feature?.properties?.["ISO3166-1-Alpha-3"] ?? "").trim();
      return /^[A-Z]{3}$/.test(countryCode) ? countryCode : null;
    })
    .catch(() => null);

  countryCodeCache.set(key, request);
  return request;
}

export async function loadCountryFlagCode(countryName: string) {
  const key = countryName.trim().toLowerCase();
  const existing = countryFlagCodeCache.get(key);
  if (existing) {
    return existing;
  }

  const request = loadCountryGeoJson(COUNTRY_GEOJSON_URL)
    .then((geoJson) => {
      const names = new Set(countryNamesForBoundary(countryName).map((name) => name.toLowerCase()));
      const feature = geoJson.features.find((candidate) =>
        names.has(String(candidate.properties?.name ?? "").trim().toLowerCase())
      );
      return String(feature?.properties?.["ISO3166-1-Alpha-2"] ?? "").trim().toLowerCase() || null;
    })
    .catch(() => null);

  countryFlagCodeCache.set(key, request);
  return request;
}

export async function boundaryConfigForLevel(level: ScratchMapLevel, selectedCountry: string | null | undefined) {
  if (level === "countries" || !selectedCountry || isUnknownLocationName(selectedCountry)) {
    return countryConfig;
  }

  if (selectedCountry === "Sweden" && level === "regions") {
    return {
      url: SWEDEN_REGION_GEOJSON_URL,
      propertyName: "name",
      center: [15.2, 62.1] as [number, number],
      zoom: 3.65,
      isDetail: true
    };
  }

  if (selectedCountry === "Sweden" && level === "counties") {
    return {
      url: SWEDEN_COUNTY_GEOJSON_URL,
      propertyName: "kom_namn",
      center: [15.2, 62.1] as [number, number],
      zoom: 3.65,
      isDetail: true
    };
  }

  const countryCode = await loadCountryCode(selectedCountry);
  if (!countryCode) {
    return countryConfig;
  }

  const url = geoBoundariesUrl(countryCode, level);
  if (!(await boundaryFileExists(url))) {
    return countryConfig;
  }

  return {
    url,
    propertyName: "shapeName",
    center: countryConfig.center,
    zoom: countryConfig.zoom,
    isDetail: true
  };
}
