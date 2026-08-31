import { BadRequestException } from "@nestjs/common";
import { cacheTypeIdentity, cacheTypeLabel } from "./cache-type-catalog";
import type { ProjectGcFindFilter, ProjectGcNumberRule } from "./challenge-checker.evaluator";

const MAX_SCRIPT_LENGTH = 250_000;
const MAX_CONFIG_LENGTH = 25_000;
const FILTER_KEYS = new Set([
  "country", "region", "county", "minVisitDate", "maxVisitDate", "minHiddenDate", "maxHiddenDate",
  "excludeTypes", "types", "sizes", "difficulties", "terrains", "minlatitude", "maxlatitude",
  "minlongitude", "maxlongitude"
]);
const META_KEYS = new Set(["limit", "brief", "filters"]);
const TYPE_GROUPS: Record<string, string[]> = {
  Physical: ["Traditional Cache", "Mystery Cache", "Multi-Cache", "Letterbox Hybrid", "Wherigo Cache", "Project A.P.E. Cache", "Geocaching HQ Cache"],
  Events: ["Event Cache", "Cache In Trash Out Event", "Community Celebration Event", "Mega-Event Cache", "Geocaching HQ Block Party", "Giga-Event Cache", "Geocaching HQ Celebration"]
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const values = Array.isArray(value) ? value : [value];
  if (!values.length || values.some((item) => typeof item !== "string" || !item.trim())) {
    throw new BadRequestException(`${label} must be a string or an array of strings`);
  }
  return values.map((item) => String(item).trim());
}

function numbers(value: unknown, label: string, minimum: number, maximum: number): number[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const values = Array.isArray(value) ? value : [value];
  const parsed = values.map(Number);
  if (!parsed.length || parsed.some((item) => !Number.isFinite(item) || item < minimum || item > maximum)) {
    throw new BadRequestException(`${label} must contain numbers from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function date(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BadRequestException(`${label} must use YYYY-MM-DD`);
  }
  return value;
}

function coordinate(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new BadRequestException(`${label} is outside its valid range`);
  return parsed;
}

function typeIds(value: unknown, label: string): string[] | undefined {
  const values = strings(value, label);
  if (!values) return undefined;
  return [...new Set(values.flatMap((item) => TYPE_GROUPS[item] ?? [item]).map((item) => cacheTypeIdentity(item).id))];
}

function parseFilter(value: Record<string, unknown>): ProjectGcFindFilter {
  for (const key of Object.keys(value)) {
    if (!FILTER_KEYS.has(key)) throw new BadRequestException(`Project-GC filter '${key}' is not supported`);
  }
  return {
    countries: strings(value.country, "country"),
    regions: strings(value.region, "region"),
    counties: strings(value.county, "county"),
    cacheTypeIds: typeIds(value.types, "types"),
    excludedCacheTypeIds: typeIds(value.excludeTypes, "excludeTypes"),
    sizes: strings(value.sizes, "sizes"),
    difficulties: numbers(value.difficulties, "difficulties", 1, 5),
    terrains: numbers(value.terrains, "terrains", 1, 5),
    minVisitDate: date(value.minVisitDate, "minVisitDate"),
    maxVisitDate: date(value.maxVisitDate, "maxVisitDate"),
    minHiddenDate: date(value.minHiddenDate, "minHiddenDate"),
    maxHiddenDate: date(value.maxHiddenDate, "maxHiddenDate"),
    minLatitude: coordinate(value.minlatitude, "minlatitude", -90, 90),
    maxLatitude: coordinate(value.maxlatitude, "maxlatitude", -90, 90),
    minLongitude: coordinate(value.minlongitude, "minlongitude", -180, 180),
    maxLongitude: coordinate(value.maxlongitude, "maxlongitude", -180, 180)
  };
}

function compactFilter(filter: ProjectGcFindFilter): ProjectGcFindFilter {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined)) as ProjectGcFindFilter;
}

export function projectGcFilterLabel(filters: ProjectGcFindFilter[]): string {
  const one = (filter: ProjectGcFindFilter) => {
    const labels: string[] = [];
    if (filter.countries) labels.push(`country ${filter.countries.join(" or ")}`);
    if (filter.regions) labels.push(`region ${filter.regions.join(" or ")}`);
    if (filter.counties) labels.push(`county ${filter.counties.join(" or ")}`);
    if (filter.cacheTypeIds) labels.push(filter.cacheTypeIds.map((id) => cacheTypeLabel(id)).join(" or "));
    if (filter.excludedCacheTypeIds) labels.push(`excluding ${filter.excludedCacheTypeIds.map((id) => cacheTypeLabel(id)).join(" or ")}`);
    if (filter.sizes) labels.push(`size ${filter.sizes.join(" or ")}`);
    if (filter.difficulties) labels.push(`difficulty ${filter.difficulties.join(" or ")}`);
    if (filter.terrains) labels.push(`terrain ${filter.terrains.join(" or ")}`);
    if (filter.minVisitDate || filter.maxVisitDate) labels.push(`visit dates ${filter.minVisitDate ?? "any"} to ${filter.maxVisitDate ?? "any"}`);
    if (filter.minHiddenDate || filter.maxHiddenDate) labels.push(`hidden dates ${filter.minHiddenDate ?? "any"} to ${filter.maxHiddenDate ?? "any"}`);
    if ([filter.minLatitude, filter.maxLatitude, filter.minLongitude, filter.maxLongitude].some((item) => item !== undefined)) labels.push("coordinate bounds");
    return labels.length ? labels.join(", ") : "all finds";
  };
  return filters.length === 1 ? one(filters[0]!) : filters.map((filter) => one(filter)).join("; or ");
}

export function importProjectGcNumberScript(scriptValue: unknown, configTextValue: unknown): { rules: ProjectGcNumberRule[]; summary: string } {
  if (typeof scriptValue !== "string" || !scriptValue.trim()) throw new BadRequestException("Paste a Project-GC Lua script");
  if (scriptValue.length > MAX_SCRIPT_LENGTH) throw new BadRequestException("Lua script is too large");
  const script = scriptValue.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\r\n]*/g, "");
  if (!/\bPGC\s*\.\s*GetFinds\s*\(/.test(script) || !/#\s*finds\s*>=\s*conf\s*\.\s*limit\b/.test(script) || !/\bc_number\s*\(/.test(script)) {
    throw new BadRequestException("This importer currently supports Project-GC c_number scripts that call PGC.GetFinds and use conf.limit");
  }
  if (typeof configTextValue !== "string" || !configTextValue.trim()) throw new BadRequestException("Paste the Project-GC tag config as JSON");
  if (configTextValue.length > MAX_CONFIG_LENGTH) throw new BadRequestException("Project-GC config is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(configTextValue); } catch { throw new BadRequestException("Project-GC tag config must be valid JSON"); }
  const config = objectValue(parsed, "Project-GC tag config");
  for (const key of Object.keys(config)) {
    if (!FILTER_KEYS.has(key) && !META_KEYS.has(key)) {
      throw new BadRequestException(`Project-GC config option '${key}' is not supported`);
    }
  }
  const minimum = Number(config.limit);
  if (!Number.isInteger(minimum) || minimum < 1 || minimum > 1_000_000) throw new BadRequestException("Project-GC config limit must be a positive integer");
  const base = Object.fromEntries(Object.entries(config).filter(([key]) => FILTER_KEYS.has(key)));
  const alternatives = config.filters === undefined ? [{}] : config.filters;
  if (!Array.isArray(alternatives) || alternatives.length < 1 || alternatives.length > 50) {
    throw new BadRequestException("Project-GC filters must contain between 1 and 50 filter objects");
  }
  const filters = alternatives.map((value, index) => compactFilter(parseFilter({ ...base, ...objectValue(value, `filters[${index}]`) })));
  const summary = projectGcFilterLabel(filters);
  return { rules: [{ type: "PROJECT_GC_NUMBER", minimum, filters, filterLabel: summary }], summary: `${minimum.toLocaleString()} finds, ${summary}` };
}
