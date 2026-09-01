import { cacheTypeIdentity, cacheTypeLabel } from "./cache-type-catalog";
import { geocacheAttributeLabel } from "./geocache-attribute-catalog";

export type ProjectGcFindFilter = {
  countries?: string[];
  regions?: string[];
  counties?: string[];
  cacheTypeIds?: string[];
  excludedCacheTypeIds?: string[];
  sizes?: string[];
  difficulties?: number[];
  terrains?: number[];
  minVisitDate?: string;
  maxVisitDate?: string;
  minHiddenDate?: string;
  maxHiddenDate?: string;
  minLatitude?: number;
  maxLatitude?: number;
  minLongitude?: number;
  maxLongitude?: number;
};

export type ProjectGcNumberRule = { type: "PROJECT_GC_NUMBER"; minimum: number; filters: ProjectGcFindFilter[]; filterLabel: string };

export type ChallengeRule =
  | { type: "TOTAL_FINDS"; minimum: number }
  | { type: "CACHE_TYPE"; cacheTypeId: string; cacheTypeLabel: string; minimum: number }
  | { type: "LOCATION"; field: "country" | "region" | "county"; value: string; country?: string; region?: string; minimum: number }
  | { type: "CALENDAR_DAYS"; minimum: number }
  | { type: "DIFFICULTY_TERRAIN"; minimum: number }
  | { type: "CACHE_SIZE"; size: string; minimum: number }
  | { type: "FIND_STREAK"; minimum: number }
  | { type: "PLACED_MONTHS"; minimum: number }
  | { type: "MONTH_OF_YEAR"; month: number; minimum: number }
  | { type: "WEEKDAY"; weekday: number; minimum: number }
  | { type: "DIFFICULTY_RATING"; rating: number; minimum: number }
  | { type: "TERRAIN_RATING"; rating: number; minimum: number }
  | { type: "FAVORITE_POINTS"; minimumFavoritePoints: number; minimum: number }
  | { type: "ATTRIBUTE"; attributeId: string; attributeLabel: string; minimum: number }
  | ProjectGcNumberRule;

export type CheckerFind = {
  foundAt: Date;
  foundDate: Date;
  cache: {
    gcCode: string;
    name: string;
    cacheType: string | null;
    difficulty: unknown;
    terrain: unknown;
    size?: string | null;
    hiddenDate?: Date | null;
    raw?: unknown;
    country: string | null;
    region: string | null;
    county: string | null;
    latitude?: unknown;
    longitude?: unknown;
  };
};

export type RuleResult = {
  rule: ChallengeRule;
  passed: boolean;
  current: number;
  required: number;
  label: string;
  detail: string;
  evidence: Array<{ date: string; gcCode: string; name: string }>;
  evidenceLimited: boolean;
};

const MAX_EVIDENCE_ROWS = 500;

function sameText(left: string | null, right: string) {
  return left?.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function loggedCalendarKey(find: CheckerFind) {
  return `${String(find.foundDate.getUTCMonth() + 1).padStart(2, "0")}-${String(find.foundDate.getUTCDate()).padStart(2, "0")}`;
}

function loggedEvidenceDate(find: CheckerFind) {
  return find.foundDate.toISOString().slice(0, 10);
}

function rating(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5 && number * 2 === Math.round(number * 2)
    ? number.toFixed(1)
    : null;
}

function rawCacheExtension(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, any>;
  return root["groundspeak:cache"] ?? root.cache ?? root.extensions?.["groundspeak:cache"] ?? root.extensions?.cache ?? root;
}

function rawText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function favoritePoints(find: CheckerFind) {
  const extension = rawCacheExtension(find.cache.raw);
  const value = rawText(extension["groundspeak:favorite_points"], extension["groundspeak:favorites"], extension.favorite_points, extension.favorites, extension.favpoints);
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function projectGcFilterMatches(filter: ProjectGcFindFilter, find: CheckerFind) {
  const inTextList = (value: string | null | undefined, choices: string[] | undefined) => !choices || choices.some((choice) => sameText(value ?? null, choice));
  const cacheTypeId = find.cache.cacheType ? cacheTypeIdentity(find.cache.cacheType).id : null;
  const visitDate = loggedEvidenceDate(find);
  const hiddenDate = find.cache.hiddenDate?.toISOString().slice(0, 10);
  const latitude = Number(find.cache.latitude);
  const longitude = Number(find.cache.longitude);
  return inTextList(find.cache.country, filter.countries) &&
    inTextList(find.cache.region, filter.regions) &&
    inTextList(find.cache.county, filter.counties) &&
    (!filter.cacheTypeIds || cacheTypeId !== null && filter.cacheTypeIds.includes(cacheTypeId)) &&
    (!filter.excludedCacheTypeIds || cacheTypeId === null || !filter.excludedCacheTypeIds.includes(cacheTypeId)) &&
    inTextList(find.cache.size, filter.sizes) &&
    (!filter.difficulties || filter.difficulties.includes(Number(find.cache.difficulty))) &&
    (!filter.terrains || filter.terrains.includes(Number(find.cache.terrain))) &&
    (!filter.minVisitDate || visitDate >= filter.minVisitDate) &&
    (!filter.maxVisitDate || visitDate <= filter.maxVisitDate) &&
    (!filter.minHiddenDate || hiddenDate !== undefined && hiddenDate >= filter.minHiddenDate) &&
    (!filter.maxHiddenDate || hiddenDate !== undefined && hiddenDate <= filter.maxHiddenDate) &&
    (filter.minLatitude === undefined || Number.isFinite(latitude) && latitude > filter.minLatitude) &&
    (filter.maxLatitude === undefined || Number.isFinite(latitude) && latitude < filter.maxLatitude) &&
    (filter.minLongitude === undefined || Number.isFinite(longitude) && longitude > filter.minLongitude) &&
    (filter.maxLongitude === undefined || Number.isFinite(longitude) && longitude < filter.maxLongitude);
}

export function attributesFromRaw(raw: unknown): Array<{ id: string; label: string }> {
  const extension = rawCacheExtension(raw);
  const rawAttributes = extension["groundspeak:attributes"]?.["groundspeak:attribute"] ?? extension.attributes?.attribute;
  const attributes = rawAttributes == null ? [] : Array.isArray(rawAttributes) ? rawAttributes : [rawAttributes];
  return attributes.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const attribute = value as Record<string, unknown>;
    const included = rawText(attribute.inc, attribute["@_inc"]);
    if (included === "0" || included?.toLocaleLowerCase() === "false") return [];
    const id = rawText(attribute.id, attribute["@_id"]);
    if (!id) return [];
    return [{ id, label: rawText(attribute.text, attribute["#text"]) ?? geocacheAttributeLabel(id) ?? `Attribute ${id}` }];
  });
}

function bestFindStreak(finds: CheckerFind[]) {
  const byDay = new Map(finds.map((find) => [loggedEvidenceDate(find), find]));
  const days = [...byDay.keys()].sort();
  let current: string[] = [];
  let best: string[] = [];
  for (const day of days) {
    const previous = current.at(-1);
    const expected = previous ? new Date(`${previous}T00:00:00Z`) : null;
    if (expected) expected.setUTCDate(expected.getUTCDate() + 1);
    current = expected?.toISOString().slice(0, 10) === day ? [...current, day] : [day];
    if (current.length > best.length) best = current;
  }
  return best.map((day) => byDay.get(day)!);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function evaluateChallenge(rules: ChallengeRule[], finds: CheckerFind[], options: { locationMatch?: (rule: Extract<ChallengeRule, { type: "LOCATION" }>, find: CheckerFind) => boolean } = {}) {
  const results: RuleResult[] = rules.map((rule) => {
    let current = 0;
    let label = "";
    let matchingFinds: CheckerFind[] = [];
    if (rule.type === "TOTAL_FINDS") {
      current = finds.length;
      matchingFinds = finds;
      label = "Total finds";
    } else if (rule.type === "CACHE_TYPE") {
      matchingFinds = finds.filter((find) => find.cache.cacheType && cacheTypeIdentity(find.cache.cacheType).id === rule.cacheTypeId);
      current = matchingFinds.length;
      label = `${cacheTypeLabel(rule.cacheTypeId, rule.cacheTypeLabel)} finds`;
    } else if (rule.type === "LOCATION") {
      matchingFinds = finds.filter((find) => options.locationMatch
        ? options.locationMatch(rule, find)
        : sameText(find.cache[rule.field], rule.value) &&
          (!rule.country || sameText(find.cache.country, rule.country)) &&
          (!rule.region || sameText(find.cache.region, rule.region)));
      current = matchingFinds.length;
      label = `Finds in ${[rule.value, rule.field === "county" ? rule.region : null, rule.field !== "country" ? rule.country : null]
        .filter(Boolean)
        .join(", ")}`;
    } else if (rule.type === "CALENDAR_DAYS") {
      matchingFinds = [...new Map(finds.map((find) => [loggedCalendarKey(find), find])).values()];
      current = matchingFinds.length;
      label = "Calendar days with a find";
    } else if (rule.type === "DIFFICULTY_TERRAIN") {
      const representatives = new Map<string, CheckerFind>();
      for (const find of finds) {
        const difficulty = rating(find.cache.difficulty);
        const terrain = rating(find.cache.terrain);
        if (difficulty && terrain) representatives.set(`${difficulty}/${terrain}`, find);
      }
      matchingFinds = [...representatives.values()];
      current = matchingFinds.length;
      label = "Difficulty/terrain combinations";
    } else if (rule.type === "CACHE_SIZE") {
      matchingFinds = finds.filter((find) => sameText(find.cache.size ?? null, rule.size));
      current = matchingFinds.length;
      label = `${rule.size} caches`;
    } else if (rule.type === "FIND_STREAK") {
      matchingFinds = bestFindStreak(finds);
      current = matchingFinds.length;
      label = "Longest find streak";
    } else if (rule.type === "PLACED_MONTHS") {
      matchingFinds = [...new Map(finds.flatMap((find) => find.cache.hiddenDate
        ? [[find.cache.hiddenDate.toISOString().slice(0, 7), find] as const]
        : [])).values()];
      current = matchingFinds.length;
      label = "Unique cache placement months";
    } else if (rule.type === "MONTH_OF_YEAR") {
      matchingFinds = finds.filter((find) => find.foundDate.getUTCMonth() + 1 === rule.month);
      current = matchingFinds.length;
      label = `Finds in ${MONTHS[rule.month - 1]}`;
    } else if (rule.type === "WEEKDAY") {
      matchingFinds = finds.filter((find) => find.foundDate.getUTCDay() === rule.weekday);
      current = matchingFinds.length;
      label = `Finds on ${WEEKDAYS[rule.weekday]}s`;
    } else if (rule.type === "DIFFICULTY_RATING") {
      matchingFinds = finds.filter((find) => Number(find.cache.difficulty) === rule.rating);
      current = matchingFinds.length;
      label = `Difficulty ${rule.rating.toFixed(1)} finds`;
    } else if (rule.type === "TERRAIN_RATING") {
      matchingFinds = finds.filter((find) => Number(find.cache.terrain) === rule.rating);
      current = matchingFinds.length;
      label = `Terrain ${rule.rating.toFixed(1)} finds`;
    } else if (rule.type === "FAVORITE_POINTS") {
      matchingFinds = finds.filter((find) => favoritePoints(find) >= rule.minimumFavoritePoints);
      current = matchingFinds.length;
      label = `Caches with at least ${rule.minimumFavoritePoints} Favorite points`;
    } else if (rule.type === "ATTRIBUTE") {
      matchingFinds = finds.filter((find) => attributesFromRaw(find.cache.raw).some((attribute) => attribute.id === rule.attributeId));
      current = matchingFinds.length;
      label = `${rule.attributeLabel} attribute finds`;
    } else {
      matchingFinds = finds.filter((find) => rule.filters.some((filter) => projectGcFilterMatches(filter, find)));
      current = matchingFinds.length;
      label = `Project-GC count: ${rule.filterLabel}`;
    }

    const passed = current >= rule.minimum;
    return {
      rule,
      passed,
      current,
      required: rule.minimum,
      label,
      detail: passed
        ? `${current.toLocaleString()} achieved; ${rule.minimum.toLocaleString()} required.`
        : `${current.toLocaleString()} achieved; ${Math.max(rule.minimum - current, 0).toLocaleString()} more needed.`,
      evidence: matchingFinds.slice(0, MAX_EVIDENCE_ROWS).map((find) => ({
        date: loggedEvidenceDate(find),
        gcCode: find.cache.gcCode,
        name: find.cache.name
      })),
      evidenceLimited: matchingFinds.length > MAX_EVIDENCE_ROWS
    };
  });

  return { passed: results.every((result) => result.passed), rules: results };
}

export function proofText(username: string, name: string, result: ReturnType<typeof evaluateChallenge>) {
  const status = result.passed ? "qualifies" : "does not yet qualify";
  const lines = result.rules.map((item) => `- ${item.label}: ${item.current}/${item.required} ${item.passed ? "✓" : "✗"}`);
  return [`${username} ${status} for “${name}”.`, ...lines, "Checked with Geostats using the user's imported find data."].join("\n");
}
