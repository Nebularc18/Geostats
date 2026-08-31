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

function maskLua(source: string) {
  // Keep line breaks and source positions while removing strings and comments.
  // Validation must inspect Lua syntax, not text that happens to look like syntax.
  const chars = source.split("");
  let index = 0;
  const blank = (from: number, to: number) => {
    for (let cursor = from; cursor < to; cursor += 1) if (chars[cursor] !== "\n" && chars[cursor] !== "\r") chars[cursor] = " ";
  };
  const longBracketEnd = (from: number) => {
    if (chars[from] !== "[") return null;
    let cursor = from + 1;
    while (chars[cursor] === "=") cursor += 1;
    if (chars[cursor] !== "[") return null;
    const equals = "=".repeat(cursor - from - 1);
    const close = source.indexOf(`]${equals}]`, cursor + 1);
    return close < 0 ? chars.length : close + equals.length + 2;
  };
  while (index < chars.length) {
    if (chars[index] === "-" && chars[index + 1] === "-") {
      const longEnd = longBracketEnd(index + 2);
      if (longEnd !== null) {
        blank(index, longEnd); index = longEnd; continue;
      }
      const end = source.indexOf("\n", index + 2);
      const actualEnd = end < 0 ? chars.length : end;
      blank(index, actualEnd); index = actualEnd; continue;
    }
    if (chars[index] === "\"" || chars[index] === "'") {
      const quote = chars[index]!;
      let end = index + 1;
      while (end < chars.length) {
        if (chars[end] === "\\") { end += 2; continue; }
        if (chars[end] === quote) { end += 1; break; }
        end += 1;
      }
      blank(index, end); index = end; continue;
    }
    const longStringEnd = longBracketEnd(index);
    if (longStringEnd !== null) {
      blank(index, longStringEnd); index = longStringEnd; continue;
    }
    index += 1;
  }
  return chars.join("");
}

function functionBody(source: string, name: string): string | null {
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(\\s*conf\\s*\\)`, "g");
  const match = declaration.exec(source);
  if (!match) return null;
  let depth = 1;
  let cursor = match.index + match[0].length;
  while (cursor < source.length) {
    const lineEnd = source.indexOf("\n", cursor);
    const end = lineEnd < 0 ? source.length : lineEnd;
    const line = source.slice(cursor, end);
    const withoutForDo = line.replace(/\b(?:for|while)\b[^\n]*\bdo\b/g, "");
    depth += (line.match(/\bfunction\b/g) ?? []).length;
    depth += (line.match(/\bif\b[^\n]*\bthen\b/g) ?? []).length;
    depth += (line.match(/\b(?:for|while)\b[^\n]*\bdo\b/g) ?? []).length;
    depth += (withoutForDo.match(/\bdo\b/g) ?? []).length;
    depth += (line.match(/\brepeat\b/g) ?? []).length;
    depth -= (line.match(/\bend\b/g) ?? []).length;
    depth -= (line.match(/\buntil\b/g) ?? []).length;
    if (depth <= 0) return source.slice(match.index + match[0].length, cursor);
    cursor = end + 1;
  }
  return null;
}

function balancedCallArguments(source: string, start: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return null;
}

function callSites(source: string) {
  const calls: Array<{ name: string; argumentsText: string }> = [];
  const callPattern = /\b([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\(/g;
  for (const match of source.matchAll(callPattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const argumentsText = balancedCallArguments(source, open);
    if (argumentsText !== null) calls.push({ name: match[1]!.replace(/\s/g, ""), argumentsText });
  }
  return calls;
}

function topLevelArguments(value: string) {
  const result: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "(") round += 1; else if (char === ")") round -= 1;
    else if (char === "[") square += 1; else if (char === "]") square -= 1;
    else if (char === "{") curly += 1; else if (char === "}") curly -= 1;
    else if (char === "," && round === 0 && square === 0 && curly === 0) { result.push(value.slice(start, index).trim()); start = index + 1; }
  }
  result.push(value.slice(start).trim());
  return result;
}

function configAliases(source: string) {
  const aliases = new Set(["conf", "config"]);
  const assignment = /(?:\blocal\s+)?([A-Za-z_]\w*)\s*=\s*(?:(?:TableCopy\s*\(\s*)?(?:config|conf)\s*\)?)/g;
  for (const match of source.matchAll(assignment)) {
    const previous = source.slice(0, match.index ?? 0).trimEnd().at(-1);
    if (previous === "{" || previous === ",") continue;
    aliases.add(match[1]!);
  }
  return aliases;
}

function validateFindsConfig(source: string) {
  const aliases = configAliases(source);
  const calls: Array<{ options: string; index: number }> = [];
  const callPattern = /\bPGC\s*\.\s*GetFinds\s*\(/g;
  for (const match of source.matchAll(callPattern)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const argumentsText = balancedCallArguments(source, open);
    if (argumentsText === null) throw new BadRequestException("Project-GC GetFinds call has unbalanced arguments");
    const args = topLevelArguments(argumentsText);
    if (args.length < 2) throw new BadRequestException("Project-GC GetFinds must pass a config-derived filter");
    calls.push({ options: args[1]!, index: match.index ?? 0 });
  }
  if (calls.length !== 1) throw new BadRequestException("The importer requires exactly one Project-GC GetFinds call");
  const options = calls[0]!.options;
  const direct = options.match(/^[A-Za-z_]\w*$/)?.[0];
  if (direct && !aliases.has(direct)) throw new BadRequestException("Project-GC GetFinds must use the tag config as its filter");
  if (!direct) {
    const filterValue = options.match(/\bfilter\s*=\s*([A-Za-z_]\w*)/)?.[1];
    if (!filterValue || !aliases.has(filterValue) || !/^\{\s*filter\s*=\s*[A-Za-z_]\w*\s*\}$/s.test(options)) throw new BadRequestException("Project-GC GetFinds must use the tag config as its filter");
  }
  for (const alias of aliases) {
    if (alias === "conf" || alias === "config") continue;
    const assignment = new RegExp("(?:\\blocal\\s+)?" + alias + "\\s*=\\s*([^\\n;]+)", "g");
    for (const match of source.matchAll(assignment)) {
      const rhs = match[1]!.trim();
      if (!/^(?:TableCopy\s*\(\s*(?:config|conf)\s*\)|config|conf)\s*$/i.test(rhs)) {
        throw new BadRequestException("Project-GC filter config is reassigned from an unsupported source");
      }
    }
  }
  // A config copy may be expanded for the supported sample checker, but it
  // cannot be replaced with an unrelated table or function result.
  for (const alias of aliases) {
    if (new RegExp("\\b" + alias + "\\s*\\[").test(source) || new RegExp("\\b" + alias + "\\s*\\.[^\\n;=]*\\[").test(source)) {
      throw new BadRequestException("Project-GC filter config cannot use indexed mutations");
    }
    if (new RegExp("\\b" + alias + "\\s*\\.\\s*filter\\s*\\.\\s*(?!filters\\b)").test(source)) {
      throw new BadRequestException("Project-GC filter config uses an unsupported nested filter");
    }
    const mutation = new RegExp("\\b" + alias + "\\s*\\.\\s*([A-Za-z_]\\w*(?:\\s*\\.\\s*[A-Za-z_]\\w*)*)\\s*=\\s*([^\\n;]+)", "g");
    for (const match of source.matchAll(mutation)) {
      const property = match[1]!.replaceAll(" ", "");
      const rhs = match[2]!.trim();
      if (alias === "conf" || alias === "config") {
        throw new BadRequestException("Project-GC tag config must not be mutated by the checker");
      }
      if (!/^(?:filter(?:\.filters)?|fields|order)$/i.test(property)) {
        throw new BadRequestException("Project-GC filter config changes the find count options");
      }
      if (property === "fields" || property === "order") continue;
      const allowedCopy = /^TableCopy\s*\(\s*[A-Za-z_]\w*(?:\s*\.\s*filter)?\s*\)$/.test(rhs);
      const allowed = /^expandFilter\s*\(\s*[A-Za-z_]\w*\s*\)$/.test(rhs) || rhs === "config" || rhs === "conf" || allowedCopy || rhs === "nil" || rhs === "l_filter";
      if (!(allowed || property === "filter.filters" && rhs === "nil")) {
        throw new BadRequestException("Project-GC filter is modified from the tag config in an unsupported way");
      }
    }
  }
}

function validateCountCondition(source: string) {
  const body = functionBody(source, "c_number");
  if (!body) throw new BadRequestException("Project-GC c_number must be a function taking conf");
  if ((source.match(/\bfunction\s+c_number\s*\(/g) ?? []).length !== 1 || (source.match(/\bc_number\s*\(\s*conf\s*\)/g) ?? []).length !== 2) {
    throw new BadRequestException("The importer requires one c_number(conf) checker invocation");
  }
  if ((source.match(/#\s*finds/g) ?? []).length !== 1 || (body.match(/#\s*finds/g) ?? []).length !== 1) throw new BadRequestException("c_number must compare the complete find count exactly once");
  const findsAssignments = body.match(/\bfinds\s*=\s*/g) ?? [];
  if (findsAssignments.length !== 1) throw new BadRequestException("The c_number finds result must not be reassigned");
  if (!/\bfinds\s*=\s*(?:(?:[A-Za-z_]\w*\s*\.\s*)?[A-Za-z_]\w*)\s*\(/.test(body)) {
    throw new BadRequestException("The c_number finds result must come from a function call");
  }
  const findsAliases = new Set(["finds"]);
  const findsAliasAssignments = /(?:^|[;\n])\s*(?:\blocal\s+)?([A-Za-z_]\w*)\s*=\s*([^;\n]*)/g;
  for (const assignment of body.matchAll(findsAliasAssignments)) {
    const valueName = assignment[2]!.trim().match(/^([A-Za-z_]\w*)$/)?.[1];
    if (valueName && findsAliases.has(valueName)) findsAliases.add(assignment[1]!);
  }
  const findsAliasPattern = [...findsAliases].map((alias) => "\\b" + alias + "\\b").join("|");
  if (new RegExp("(?:" + findsAliasPattern + ")\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\])\\s*=").test(body)) {
    throw new BadRequestException("The c_number finds result must not be mutated in place");
  }
  const mutatingTableCalls = new Set(["table.insert", "table.remove", "table.sort", "table.move", "table.clear", "rawset"]);
  for (const call of callSites(body)) {
    if (mutatingTableCalls.has(call.name) && new RegExp("(?:" + findsAliasPattern + ")").test(call.argumentsText)) {
      throw new BadRequestException("The c_number finds result must not be mutated in place");
    }
  }
  const exactIf = body.match(/\bif\s*\(?\s*#\s*finds\s*>=\s*conf\s*\.\s*limit\s*\)?\s*then\b/g) ?? [];
  const exactReturn = body.match(/\bok\s*=\s*#\s*finds\s*>=\s*conf\s*\.\s*limit\b\s*(?=[,}])/g) ?? [];
  if (exactIf.length + exactReturn.length !== 1) throw new BadRequestException("c_number must return exactly the conf.limit count condition");
  const returnStatements = [...body.matchAll(/\breturn\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
  const hasFinalReturn = exactReturn.length === 1 || returnStatements.some((value) => /\bok\s*=\s*ok\b/.test(value));
  const hasAllowedEarlyReturn = returnStatements.some((value) => /\bok\s*=\s*nil\b/.test(value));
  if ((body.match(/\breturn\b/g) ?? []).length !== returnStatements.length || !hasFinalReturn || (returnStatements.length > 2 || returnStatements.length === 2 && !hasAllowedEarlyReturn)) {
    throw new BadRequestException("c_number has an unsupported return condition");
  }
  if (exactIf.length) {
    const assignments = [...body.matchAll(/\bok\s*=\s*([^\n;}]*)/g)].map((match) => match[1]!.trim().replace(/[,}].*$/, "").replace(/\bend\s*$/, "").trim());
    if (assignments.some((value) => !["true", "false", "ok", "nil"].includes(value)) || assignments.filter((value) => value === "true").length !== 1 || assignments.filter((value) => value === "false").length !== 1 || assignments.filter((value) => value === "ok").length !== 1) {
      throw new BadRequestException("c_number has an additional pass/fail condition");
    }
  }
  const resultInvocation = /(?:\blocal\s+)?([A-Za-z_]\w*)\s*=\s*c_number\s*\(\s*conf\s*\)(?=\s*(?:[,;\n]|$))/g;
  for (const match of source.matchAll(resultInvocation)) {
    const resultName = match[1]!;
    const afterInvocation = source.slice((match.index ?? 0) + match[0].length);
    const aliases = new Set([resultName]);
    const assignments = /(?:^|[;\n])\s*(?:\blocal\s+)?([A-Za-z_]\w*)\s*=\s*([^;\n]*)/g;
    for (const assignment of afterInvocation.matchAll(assignments)) {
      const name = assignment[1]!;
      const value = assignment[2]!.trim();
      const valueName = value.match(/^([A-Za-z_]\w*)$/)?.[1];
      const isResultRead = [...aliases].some((alias) => new RegExp("^" + alias + "\\s*\\.\\s*ok$").test(value));
      if (aliases.has(name)) {
        if (!valueName || !aliases.has(valueName)) {
          throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
        }
      } else if (valueName && aliases.has(valueName)) {
        aliases.add(name);
      } else if (!isResultRead && [...aliases].some((alias) => new RegExp("\\b" + alias + "\\b").test(value))) {
        throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
      }
    }
    const aliasPattern = [...aliases].map((alias) => "\\b" + alias + "\\b").join("|");
    const resultAssignment = new RegExp("(?:" + aliasPattern + ")\\s*(?:\\.\\s*ok\\s*=|\\[[^\\]]*\\]\\s*=)");
    const containerAssignment = /\b[A-Za-z_]\w*\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]]*\])\s*=\s*([^\n;]*)/g;
    const resultRead = (value: string) => [...aliases].some((alias) => new RegExp("^" + alias + "\\s*\\.\\s*ok$").test(value.trim()));
    const aliasReference = new RegExp("(?:" + aliasPattern + ")");
    const containerReference = [...afterInvocation.matchAll(containerAssignment)].some((assignment) => !resultRead(assignment[1]!) && aliasReference.test(assignment[1]!));
    const callReference = callSites(afterInvocation).some((call) => aliasReference.test(call.argumentsText));
    if (resultAssignment.test(afterInvocation) || containerReference || callReference) {
      throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
    }
  }
  const allOkAssignments = [...source.matchAll(/\bok\s*=\s*([^\n;}]*)/g)].map((match) => match[1]!.trim().replace(/[,}].*$/, "").replace(/\bend\s*$/, "").trim());
  const allowedCountExpression = /^#\s*finds\s*>=\s*conf\s*\.\s*limit$/;
  if (allOkAssignments.some((value) => value !== "true" && value !== "false" && value !== "ok" && value !== "nil" && value !== "res.ok" && !allowedCountExpression.test(value))) {
    throw new BadRequestException("The checker contains an additional pass/fail condition");
  }
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
  const script = maskLua(scriptValue);
  validateFindsConfig(script);
  validateCountCondition(script);
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
