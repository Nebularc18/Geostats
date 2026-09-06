import { Injectable } from "@nestjs/common";

type Position = [number, number];
export type BoundaryGeometry = { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
type BoundaryFeature = { properties?: Record<string, unknown> | null; geometry: BoundaryGeometry };
type FeatureCollection = { features: BoundaryFeature[] };

const COUNTRY_URL = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson";
const BOUNDARY_BASE = "https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09592ced973a3448cf66b6100b741b64c0d/releaseData/gbOpen";
const NORWAY_API = "https://api.kartverket.no/kommuneinfo/v1";
type NorwayRegion = { fylkesnavn: string; fylkesnummer: string };
type NorwayCounty = { kommunenavn: string; kommunenummer: string };
const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states": ["United States of America"],
  russia: ["Russian Federation"],
  "south korea": ["Republic of Korea"],
  "north korea": ["Democratic People's Republic of Korea"],
  "czech republic": ["Czechia"],
  "united kingdom": ["United Kingdom of Great Britain and Northern Ireland"],
  vietnam: ["Viet Nam"],
  iran: ["Iran (Islamic Republic of)"],
  moldova: ["Republic of Moldova"],
  tanzania: ["United Republic of Tanzania"],
  syria: ["Syrian Arab Republic"],
  bolivia: ["Bolivia (Plurinational State of)"],
  venezuela: ["Venezuela (Bolivarian Republic of)"]
};
const CODE_OVERRIDES: Record<string, string> = { france: "FRA", kosovo: "XKX", norway: "NOR", taiwan: "TWN" };

function normalizeLocationName(value: string) {
  let name = value.trim().toLocaleLowerCase();
  if (name.endsWith("s län")) name = name.slice(0, -"s län".length);
  else if (name.endsWith(" län")) name = name.slice(0, -" län".length);
  for (const suffix of [" kommun", " municipality", " county", " kommune", " kunta"]) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  return name.trim();
}

function sameName(left: unknown, right: string) {
  const leftText = String(left ?? "").trim();
  if (leftText.localeCompare(right.trim(), undefined, { sensitivity: "base" }) === 0) return true;
  return normalizeLocationName(leftText).localeCompare(normalizeLocationName(right), undefined, { sensitivity: "base" }) === 0;
}

function pointInRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index]!;
    const [xj, yj] = ring[previous]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, polygon: Position[][]) {
  return Boolean(polygon[0]?.length) && pointInRing(point, polygon[0]!) && !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInBoundary(point: Position, geometry: BoundaryGeometry) {
  return geometry.type === "Polygon"
    ? pointInPolygon(point, geometry.coordinates)
    : geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
}

function exteriorRings(geometry: BoundaryGeometry) {
  return geometry.type === "Polygon" ? [geometry.coordinates[0] ?? []] : geometry.coordinates.map((polygon) => polygon[0] ?? []);
}

function representativePoint(geometry: BoundaryGeometry): Position | null {
  const points = exteriorRings(geometry).flat();
  if (!points.length) return null;
  const average: Position = [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const center: Position = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const first = points[0]!;
  const candidates: Position[] = [center, average, [first[0] * 0.99 + average[0] * 0.01, first[1] * 0.99 + average[1] * 0.01], first];
  return candidates.find((point) => pointInBoundary(point, geometry)) ?? first;
}

@Injectable()
export class GeographicBoundariesService {
  private readonly requests = new Map<string, Promise<unknown>>();
  private countryData?: Promise<FeatureCollection>;
  private norwayRegionData?: Promise<NorwayRegion[]>;
  private norwayCountyData?: Promise<NorwayCounty[]>;

  async regions(country: string) {
    if (sameName(country, "Norway")) {
      return (await this.norwayRegions()).map((region) => region.fylkesnavn).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    const features = await this.features(country, "ADM1");
    return features.map((feature) => this.name(feature)).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  async counties(country: string, region: string) {
    if (sameName(country, "Norway")) {
      const parent = (await this.norwayRegions()).find((candidate) => sameName(candidate.fylkesnavn, region));
      if (!parent) return [];
      return (await this.norwayCounties())
        .filter((county) => county.kommunenummer.startsWith(parent.fylkesnummer))
        .map((county) => county.kommunenavn)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    const [regions, counties] = await Promise.all([this.features(country, "ADM1"), this.features(country, "ADM2")]);
    const parent = regions.find((feature) => sameName(this.name(feature), region));
    if (!parent) return [];
    return counties
      .filter((feature) => {
        const point = representativePoint(feature.geometry);
        return point ? pointInBoundary(point, parent.geometry) : false;
      })
      .map((feature) => this.name(feature))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  async geometry(country: string, level: "region" | "county", name: string, parentRegion?: string) {
    if (sameName(country, "Norway")) return this.norwayGeometry(level, name, parentRegion);
    const features = await this.features(country, level === "region" ? "ADM1" : "ADM2");
    const matches = features.filter((feature) => sameName(this.name(feature), name));
    if (level === "county" && parentRegion && matches.length > 1) {
      const parents = await this.features(country, "ADM1");
      const parent = parents.find((feature) => sameName(this.name(feature), parentRegion));
      if (parent) return matches.find((feature) => {
        const point = representativePoint(feature.geometry);
        return point ? pointInBoundary(point, parent.geometry) : false;
      })?.geometry ?? null;
    }
    return matches[0]?.geometry ?? null;
  }

  private name(feature: BoundaryFeature) {
    let name = String(feature.properties?.shapeName ?? "").trim();
    const group = String(feature.properties?.shapeGroup ?? "").trim();
    if (group && name.toLocaleLowerCase().endsWith(` ${group.toLocaleLowerCase()}`)) {
      name = name.slice(0, -(group.length + 1)).trim();
    }
    if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
      name = name.slice(1, -1).trim();
    }
    return name;
  }

  private norwayRegions() {
    return this.norwayRegionData ??= this.fetchJson<NorwayRegion[]>(`${NORWAY_API}/fylker`);
  }

  private norwayCounties() {
    return this.norwayCountyData ??= this.fetchJson<NorwayCounty[]>(`${NORWAY_API}/kommuner`);
  }

  private async norwayGeometry(level: "region" | "county", name: string, parentRegion?: string) {
    let number: string | undefined;
    if (level === "region") {
      number = (await this.norwayRegions()).find((candidate) => sameName(candidate.fylkesnavn, name))?.fylkesnummer;
    } else {
      const parentNumber = parentRegion
        ? (await this.norwayRegions()).find((candidate) => sameName(candidate.fylkesnavn, parentRegion))?.fylkesnummer
        : undefined;
      number = (await this.norwayCounties()).find((candidate) => sameName(candidate.kommunenavn, name) && (!parentNumber || candidate.kommunenummer.startsWith(parentNumber)))?.kommunenummer;
    }
    if (!number) return null;
    const path = level === "region" ? "fylker" : "kommuner";
    const response = await this.fetchJson<{ omrade?: BoundaryGeometry }>(`${NORWAY_API}/${path}/${encodeURIComponent(number)}/omrade`);
    return response.omrade ?? null;
  }

  private async countryCode(country: string) {
    const override = CODE_OVERRIDES[country.trim().toLowerCase()];
    if (override) return override;
    if (!this.countryData) this.countryData = this.fetchJson<FeatureCollection>(COUNTRY_URL);
    const collection = await this.countryData;
    const names = [country, ...(COUNTRY_ALIASES[country.trim().toLowerCase()] ?? [])];
    const feature = collection.features.find((candidate) => names.some((name) => sameName(candidate.properties?.name, name)));
    const code = String(feature?.properties?.["ISO3166-1-Alpha-3"] ?? "").trim();
    return /^[A-Z]{3}$/.test(code) ? code : null;
  }

  private async features(country: string, level: "ADM1" | "ADM2"): Promise<BoundaryFeature[]> {
    const code = await this.countryCode(country);
    if (!code) return [];
    const url = `${BOUNDARY_BASE}/${code}/${level}/geoBoundaries-${code}-${level}_simplified.geojson`;
    try { return (await this.fetchJson<FeatureCollection>(url)).features ?? []; } catch { return []; }
  }

  private fetchJson<T>(url: string): Promise<T> {
    const existing = this.requests.get(url);
    if (existing) return existing as Promise<T>;
    const request = fetch(url, { signal: AbortSignal.timeout(20_000) }).then(async (response) => {
      if (!response.ok) throw new Error(`Boundary request failed with ${response.status}`);
      return await response.json() as T;
    }).catch((error) => { this.requests.delete(url); throw error; });
    this.requests.set(url, request);
    return request;
  }
}
