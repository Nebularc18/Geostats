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

export type CalendarFillRule = {
  type: "CALENDAR_FILL";
  minimum: number;
  perDay: number;
  allowLeapDaySkip: boolean;
  filters: ProjectGcFindFilter[];
  filterLabel: string;
};

export type DistinctTypesRule = {
  type: "DISTINCT_TYPES";
  minimum: number;
  filters: ProjectGcFindFilter[];
  filterLabel: string;
};

export type MonthlyAttributeRule = {
  type: "MONTHLY_ATTRIBUTE";
  months: Array<{ month: number; minimum: number }>;
  overallMinimum: number;
  attributeId: string;
  attributeLabel: string;
  filters: ProjectGcFindFilter[];
  filterLabel: string;
  excludedGcCodes: string[];
  excludeSelf: boolean;
};

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
  | ProjectGcNumberRule
  | CalendarFillRule
  | DistinctTypesRule
  | MonthlyAttributeRule;

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
  calendar?: { days: Record<string, number>; perDay: number; allowLeapDaySkip: boolean };
};

const MAX_EVIDENCE_ROWS = 500;

function sameText(left: string | null, right: string) {
  return left?.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function normalizeLocationName(value: string) {
  // Groundspeak/GPX data uses "Blekinge" while boundary datasets use
  // "Blekinge län" (and "Karlskrona" vs "Karlskrona kommun"). Normalize
  // administrative suffixes so the same place matches either naming.
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

export function sameLocationText(left: string | null | undefined, right: string) {
  if (left == null) return false;
  const leftTrimmed = left.trim();
  const rightTrimmed = right.trim();
  if (leftTrimmed.localeCompare(rightTrimmed, undefined, { sensitivity: "accent" }) === 0) return true;
  return normalizeLocationName(leftTrimmed).localeCompare(normalizeLocationName(rightTrimmed), undefined, { sensitivity: "accent" }) === 0;
}

function loggedCalendarKey(find: CheckerFind) {
  return `${String(find.foundDate.getUTCMonth() + 1).padStart(2, "0")}-${String(find.foundDate.getUTCDate()).padStart(2, "0")}`;
}

function loggedEvidenceDate(find: CheckerFind) {
  return find.foundDate.toISOString().slice(0, 10);
}

function dedupedByCache(finds: CheckerFind[]) {
  // The checkers this mirrors skip repeat logs of the same cache; finds
  // arrive oldest-first so keeping the first row matches that.
  const seen = new Set<string>();
  return finds.filter((find) => {
    const code = find.cache.gcCode.trim().toUpperCase();
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
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
  const inLocationList = (value: string | null | undefined, choices: string[] | undefined) => !choices || (value != null && choices.some((choice) => sameLocationText(value, choice)));
  const cacheTypeId = find.cache.cacheType ? cacheTypeIdentity(find.cache.cacheType).id : null;
  const visitDate = loggedEvidenceDate(find);
  const hiddenDate = find.cache.hiddenDate?.toISOString().slice(0, 10);
  const latitude = Number(find.cache.latitude);
  const longitude = Number(find.cache.longitude);
  return inLocationList(find.cache.country, filter.countries) &&
    inLocationList(find.cache.region, filter.regions) &&
    inLocationList(find.cache.county, filter.counties) &&
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
        : sameLocationText(find.cache[rule.field], rule.value) &&
          (!rule.country || sameLocationText(find.cache.country, rule.country)) &&
          (!rule.region || sameLocationText(find.cache.region, rule.region)));
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
    } else if (rule.type === "PROJECT_GC_NUMBER") {
      matchingFinds = finds.filter((find) => rule.filters.some((filter) => projectGcFilterMatches(filter, find)));
      current = matchingFinds.length;
      label = `Project-GC count: ${rule.filterLabel}`;
    } else if (rule.type === "DISTINCT_TYPES") {
      // Canonical cache-type ids: alias spellings ("Unknown" vs "Mystery")
      // merge instead of splitting, so this count never exceeds a
      // per-string count.
      const seen = new Map<string, CheckerFind>();
      for (const find of dedupedByCache(finds.filter((find) => rule.filters.some((filter) => projectGcFilterMatches(filter, find))))) {
        if (!find.cache.cacheType) continue;
        const id = cacheTypeIdentity(find.cache.cacheType).id;
        if (!seen.has(id)) seen.set(id, find);
      }
      current = seen.size;
      matchingFinds = [...seen.values()];
      label = `Distinct cache types (${rule.filterLabel})`;
    } else if (rule.type === "MONTHLY_ATTRIBUTE") {
      const excluded = new Set(rule.excludedGcCodes.map((code) => code.trim().toUpperCase()));
      const eligible = dedupedByCache(finds.filter((find) => !excluded.has(find.cache.gcCode.trim().toUpperCase()) &&
        rule.filters.some((filter) => projectGcFilterMatches(filter, find)) &&
        attributesFromRaw(find.cache.raw).some((attribute) => attribute.id === rule.attributeId)));
      const monthly = rule.months.map(({ month, minimum }) => {
        const group = eligible.filter((find) => find.foundDate.getUTCMonth() + 1 === month);
        return { month, minimum, count: group.length, met: group.length >= minimum, sample: group.slice(0, minimum) };
      });
      current = monthly.filter((entry) => entry.met).length;
      matchingFinds = monthly.flatMap((entry) => entry.sample);
      const missing = monthly.filter((entry) => !entry.met).map((entry) => String(entry.month).padStart(2, "0"));
      label = `${rule.attributeLabel} × ${rule.months.length} months (${rule.filterLabel})`;
      const passed = current >= rule.overallMinimum;
      return {
        rule,
        passed,
        current,
        required: rule.overallMinimum,
        label,
        detail: passed
          ? `${current.toLocaleString()} achieved; ${rule.overallMinimum.toLocaleString()} required.`
          : `${current.toLocaleString()} achieved; ${Math.max(rule.overallMinimum - current, 0).toLocaleString()} more needed.${missing.length ? ` Missing: ${missing.join(", ")}.` : ""}`,
        evidence: matchingFinds.slice(0, MAX_EVIDENCE_ROWS).map((find) => ({
          date: loggedEvidenceDate(find),
          gcCode: find.cache.gcCode,
          name: find.cache.name
        })),
        evidenceLimited: matchingFinds.length > MAX_EVIDENCE_ROWS
      };
    } else {
      const byDate = new Map<string, CheckerFind[]>();
      for (const find of finds.filter((find) => rule.filters.some((filter) => projectGcFilterMatches(filter, find)))) {
        const key = loggedCalendarKey(find);
        const group = byDate.get(key);
        if (group) group.push(find);
        else byDate.set(key, [find]);
      }
      const complete = [...byDate.entries()].filter(([, group]) => group.length >= rule.perDay);
      const leapComplete = (byDate.get("02-29")?.length ?? 0) >= rule.perDay;
      current = complete.length;
      matchingFinds = complete.map(([, group]) => group[0]!);
      label = `Distinct calendar dates (${rule.filterLabel})`;
      const passed = current >= rule.minimum ||
        (rule.allowLeapDaySkip && rule.minimum === 366 && current === 365 && !leapComplete);
      const days: Record<string, number> = {};
      for (const [key, group] of byDate) days[key] = group.length;
      return {
        rule,
        passed,
        current,
        required: rule.minimum,
        label,
        calendar: { days, perDay: rule.perDay, allowLeapDaySkip: rule.allowLeapDaySkip },
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
