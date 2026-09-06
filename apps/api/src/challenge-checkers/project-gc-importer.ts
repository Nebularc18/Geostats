import { BadRequestException } from "@nestjs/common";
import { cacheTypeIdentity, cacheTypeLabel } from "./cache-type-catalog";
import type { ProjectGcFindFilter, ProjectGcNumberRule } from "./challenge-checker.evaluator";

const MAX_SCRIPT_LENGTH = 250_000;
const MAX_CONFIG_LENGTH = 25_000;
const MAX_PARSE_NESTING = 100;
const MAX_PARSE_CALLS = 1000;
const MAX_PARSE_SCAN_WORK = 10_000_000;
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
const MUTATING_TABLE_CALLS = new Set(["table.insert", "table.remove", "table.sort", "table.move", "table.clear", "rawset"]);
const READ_ONLY_CALLS = new Set(["ipairs", "pairs", "next", "tostring", "table.concat", "TableCopy", "PGC.print", "PrinFindsTable", "PrintFindsText", "PrintFindsHtml"]);
const CONTROL_CALLS = new Set(["if", "for", "while", "repeat", "until", "return", "function"]);
const SUPPORTED_FIND_CALLS = new Set(["PGC.GetFinds", "GetCombinedFinds"]);

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
  // Bracket access with a plain identifier key (t['field']) is rewritten to
  // dot form (t.field): identical semantics in Lua, and it keeps the field
  // name visible to the structural checks below (a blanked key would read as
  // an unknown field). Keywords are never rewritten so block parsing stays
  // exact, and only same-line brackets qualify.
  const LUA_KEYWORDS = new Set([
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
    "then", "true", "until", "while"
  ]);
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
      const content = source.slice(index + 1, end - 1);
      let open = index - 1;
      while (open >= 0 && (chars[open] === " " || chars[open] === "\t")) open -= 1;
      let close = end;
      while (close < chars.length && (chars[close] === " " || chars[close] === "\t")) close += 1;
      if (/^[A-Za-z_]\w*$/.test(content) && !LUA_KEYWORDS.has(content) && chars[open] === "[" && chars[close] === "]") {
        // t['field'] means exactly t.field: rewrite it so structural checks
        // see the field name (a blanked key would read as an unknown field).
        blank(open, close + 1);
        const replacement = `.${content}`;
        for (let cursor = 0; cursor < replacement.length; cursor += 1) chars[open + cursor] = replacement[cursor]!;
        index = close + 1;
        continue;
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

const LUA_DEFINED_GLOBALS = new Set([
  "PGC", "table", "string", "math", "pairs", "ipairs", "next", "type", "tostring", "tonumber",
  "select", "unpack", "print", "pcall", "error", "assert", "rawget", "rawset", "rawequal",
  "setmetatable", "getmetatable", "require", "os", "io", "coroutine", "package", "debug", "utf8", "_G", "_VERSION"
]);

function definedLuaNames(source: string) {
  const defined = new Set(LUA_DEFINED_GLOBALS);
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) defined.add(match[1]!);
  for (const match of source.matchAll(/\bfunction\s+[A-Za-z_]\w*\s*\(([^)]*)\)/g)) {
    for (const parameter of (match[1] ?? "").split(",")) {
      const name = parameter.trim();
      if (/^[A-Za-z_]\w*$/.test(name)) defined.add(name);
    }
  }
  for (const match of source.matchAll(/(?:^|[;\n])\s*(?:\blocal\s+)?([A-Za-z_]\w*)\s*=(?!=)/g)) defined.add(match[1]!);
  for (const match of source.matchAll(/\blocal\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/g)) {
    for (const name of match[1]!.split(",")) defined.add(name.trim());
  }
  for (const match of source.matchAll(/\bfor\s+([A-Za-z_][\w\s,]*?)\s+in\s+[^\n]+\s+do\b/g)) {
    for (const name of match[1]!.split(",")) {
      const trimmed = name.trim();
      if (/^[A-Za-z_]\w*$/.test(trimmed)) defined.add(trimmed);
    }
  }
  for (const match of source.matchAll(/\bfor\s+([A-Za-z_]\w*)\s*=[^,\n]+,[^\n]+\s+do\b/g)) defined.add(match[1]!);
  return defined;
}

function stripDeadNilBranches(source: string) {
  // The official generic checker guards its legacy excludeTypes handling with
  // `k == excludeTypes`, where excludeTypes is a never-assigned global (nil).
  // Loop variables are never nil, so such a branch can never execute. Blank
  // its body (keeping newlines and offsets) so later checks only see live
  // code. Anything not provably dead is left untouched and fails closed.
  const defined = definedLuaNames(source);
  const lines = source.split("\n");
  const offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  const loopVariables = new Set<string>();
  for (const match of source.matchAll(/\bfor\s+([A-Za-z_][\w\s,]*?)\s+in\s+[^\n]+\s+do\b/g)) {
    for (const name of match[1]!.split(",")) {
      const trimmed = name.trim();
      if (/^[A-Za-z_]\w*$/.test(trimmed)) loopVariables.add(trimmed);
    }
  }
  for (const match of source.matchAll(/\bfor\s+([A-Za-z_]\w*)\s*=[^,\n]+,[^\n]+\s+do\b/g)) loopVariables.add(match[1]!);
  const nonNilOperand = (value: string) => {
    const trimmed = value.trim();
    if (/^[A-Za-z_]\w*$/.test(trimmed)) return loopVariables.has(trimmed) || ["PGC", "table", "string", "math"].includes(trimmed);
    return /^(['"]).*\1$/.test(trimmed) || /^-?\d/.test(trimmed) || trimmed === "true" || trimmed === "false" || /^\{/.test(trimmed);
  };
  const blank = (from: number, to: number, chars: string[]) => {
    for (let index = from; index < to; index += 1) if (chars[index] !== "\n") chars[index] = " ";
  };
  const chars = source.split("");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    let dead = false;
    if (/^(?:if|elseif)\s/.test(trimmed)) {
      const equality = trimmed.match(/^(?:if|elseif)\s+\(?\s*([A-Za-z_]\w*)\s*==\s*([A-Za-z_]\w*)\s*\)?\s*then\b/);
      if (equality) {
        const [left, right] = [equality[1]!, equality[2]!];
        dead = !defined.has(left) && nonNilOperand(right) || !defined.has(right) && nonNilOperand(left);
      } else {
        const bare = trimmed.match(/^(?:if|elseif)\s+([A-Za-z_]\w*)\s*then\b\s*$/);
        if (bare && !defined.has(bare[1]!)) dead = true;
      }
    }
    if (!dead) continue;
    let depth = 1;
    let lineIndex = index + 1;
    while (lineIndex < lines.length) {
      const bodyLine = lines[lineIndex]!;
      const bodyTrimmed = bodyLine.trim();
      if (depth === 1 && /^(?:elseif|else)\b/.test(bodyTrimmed)) break;
      const withoutForDo = bodyLine.replace(/\b(?:for|while)\b[^\n]*\bdo\b/g, "");
      depth += (bodyLine.match(/\bfunction\b/g) ?? []).length;
      depth += (bodyLine.match(/\bif\b[^\n]*\bthen\b/g) ?? []).length;
      depth += (bodyLine.match(/\b(?:for|while)\b[^\n]*\bdo\b/g) ?? []).length;
      depth += (withoutForDo.match(/\bdo\b/g) ?? []).length;
      depth += (bodyLine.match(/\brepeat\b/g) ?? []).length;
      depth -= (bodyLine.match(/\bend\b/g) ?? []).length;
      depth -= (bodyLine.match(/\buntil\b/g) ?? []).length;
      if (depth <= 0) {
        const closing = [...bodyLine.matchAll(/\bend\b|\buntil\b/g)].at(-1);
        blank(offsets[index]! + lines[index]!.length + 1, closing ? offsets[lineIndex]! + closing.index! : offsets[lineIndex]!, chars);
        break;
      }
      lineIndex += 1;
    }
    if (lineIndex < lines.length && depth > 0) {
      blank(offsets[index]! + lines[index]!.length + 1, offsets[lineIndex]!, chars);
    }
  }
  return chars.join("");
}

function validateParseBudgets(source: string) {
  let nesting = 0;
  let calls = 0;
  let scanWork = source.length;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (char === "(" || char === "[" || char === "{") {
      nesting += 1;
      if (nesting > MAX_PARSE_NESTING) throw new BadRequestException("Project-GC script nesting is too deep");
      if (char === "(") {
        calls += 1;
        scanWork += source.length;
        if (calls > MAX_PARSE_CALLS) throw new BadRequestException("Project-GC script contains too many calls");
        if (scanWork > MAX_PARSE_SCAN_WORK) throw new BadRequestException("Project-GC script requires too much parsing work");
      }
    } else if (char === ")" || char === "]" || char === "}") {
      nesting = Math.max(0, nesting - 1);
    }
  }
}

function blockBody(source: string, start: number): string | null {
  let depth = 1;
  let cursor = start;
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
    if (depth <= 0) {
      const closing = [...line.matchAll(/\bend\b|\buntil\b/g)].at(-1);
      return source.slice(start, closing ? cursor + closing.index : cursor);
    }
    cursor = end + 1;
  }
  return null;
}

function functionBody(source: string, name: string): string | null {
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(\\s*conf\\s*\\)`, "g");
  const match = declaration.exec(source);
  return match ? blockBody(source, match.index + match[0].length) : null;
}

function functionDefinition(source: string, name: string): { parameters: string[]; body: string } | null {
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(([^)]*)\\)`, "g");
  const match = declaration.exec(source);
  if (!match) return null;
  const body = blockBody(source, match.index + match[0].length);
  if (body === null) return null;
  const parameters = (match[1] ?? "").split(",").map((parameter) => parameter.trim()).filter((parameter) => /^[A-Za-z_]\w*$/.test(parameter));
  return { parameters, body };
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

function isWholeCallExpression(value: string, name: string) {
  const match = new RegExp("^" + name.replace(".", "\\.") + "\\s*\\(").exec(value);
  if (!match) return false;
  const open = match[0].length - 1;
  const argumentsText = balancedCallArguments(value, open);
  return argumentsText !== null && !value.slice(open + argumentsText.length + 2).trim();
}

function referencesAny(value: string, names: Set<string>) {
  return [...names].some((name) => new RegExp("\\b" + name + "\\b").test(value));
}

function findsReferenceEscapes(value: string, aliases: Set<string>, source: string) {
  // Every mention of a finds alias inside an assigned value must be inert:
  // a length read (#finds), a field read (finds[i]), or an argument to a
  // call that provably only reads it (display helpers such as
  // PrintFindsText, or any script-defined function shown not to mutate the
  // parameter it receives). Anything else — a bare reference, a container
  // literal, an unknown callee — fails closed.
  const names = [...aliases].join("|");
  if (!names) return false;
  const enclosingCall = (position: number) => {
    let depth = 0;
    for (let cursor = position - 1; cursor >= 0; cursor -= 1) {
      const char = value[cursor]!;
      if (char === ")") depth += 1;
      else if (char === "(") {
        if (depth === 0) {
          const head = value.slice(0, cursor).match(/([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*$/)?.[1]?.replace(/\s/g, "");
          const rest = balancedCallArguments(value, cursor);
          return head !== undefined && rest !== null ? { head, argumentsText: rest } : null;
        }
        depth -= 1;
      }
    }
    return null;
  };
  for (const match of value.matchAll(new RegExp("\\b(?:" + names + ")\\b", "g"))) {
    const before = value.slice(0, match.index).replace(/\s+$/, "");
    const after = value.slice(match.index! + match[0].length).replace(/^\s+/, "");
    if (before.endsWith("#")) continue;
    if (after.startsWith(".") || after.startsWith("[")) continue;
    const call = enclosingCall(match.index!);
    if (!call) return true;
    if (MUTATING_TABLE_CALLS.has(call.head)) return true;
    if (READ_ONLY_CALLS.has(call.head) && !functionDefinition(source, call.head)) continue;
    const definition = functionDefinition(source, call.head);
    if (!definition) return true;
    const argumentsList = topLevelArguments(call.argumentsText);
    const nested = definition.parameters[argumentsList.findIndex((argument) => new RegExp("\\b" + match[0] + "\\b").test(argument))];
    if (!nested || functionMutatesParameter(source, call.head, nested)) return true;
  }
  return false;
}

function assignmentSites(source: string) {
  const assignments: Array<{ name: string; value: string; local: boolean }> = [];
  const assignment = /(?:^|[;\n])\s*(\blocal\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*([^;\n]*)/g;
  for (const match of source.matchAll(assignment)) assignments.push({ name: match[2]!, value: match[3]!.trim(), local: Boolean(match[1]) });
  return assignments;
}

function memberAssignmentSites(source: string) {
  const assignments: Array<{ name: string; member: string; value: string; index: number }> = [];
  const assignment = /\b([A-Za-z_]\w*)\s*(\.\s*[A-Za-z_]\w*|\[[^\]]*\])\s*=(?!=)\s*([^\n;]*)/g;
  for (const match of source.matchAll(assignment)) assignments.push({ name: match[1]!, member: match[2]!.replace(/\s/g, ""), value: match[3]!.trim(), index: match.index ?? 0 });
  return assignments;
}

function sameTableReference(value: string, target: string) {
  const normalized = value.replace(/\s/g, "");
  return normalized === target || normalized.startsWith(`${target}.`) || normalized.startsWith(`${target}[`);
}

function accumulatorIsPopulated(body: string, assignment: { name: string; member: string; index: number }, derived: Set<string>) {
  const target = `${assignment.name}${assignment.member}`;
  const suffix = body.slice(assignment.index);
  const inputField = assignment.member === ".types" ? "types" : assignment.member === ".excludeTypes" ? "excludeTypes" : undefined;
  if (inputField && new RegExp("\\b(?:if|elseif)\\b[^\\n]*\\b" + inputField + "\\b").test(suffix)) return false;
  for (const call of callSites(suffix)) {
    if (call.name !== "table.insert") continue;
    const argumentsList = topLevelArguments(call.argumentsText);
    if (argumentsList.length < 2 || !sameTableReference(argumentsList[0]!, target)) continue;
    if (referencesAny(argumentsList[1]!, derived) || (argumentsList[2] !== undefined && referencesAny(argumentsList[2]!, derived))) return true;
  }
  const nestedAssignment = new RegExp("\\b" + assignment.name + "\\s*" + assignment.member.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "(?:\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\]))\\s*=(?!=)\\s*([^\\n;]*)", "g");
  return [...suffix.matchAll(nestedAssignment)].some((match) => referencesAny(match[1]!.trim(), derived));
}

function functionNames(source: string) {
  return new Set([...source.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)].map((match) => match[1]!));
}

function functionsReturningAliases(source: string, aliases: Set<string>) {
  const returning = new Set<string>();
  const names = functionNames(source);
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of names) {
      if (name === "c_number" || returning.has(name)) continue;
      const definition = functionDefinition(source, name);
      if (!definition) continue;
      const localAliases = new Set(aliases);
      let aliasesChanged = true;
      while (aliasesChanged) {
        aliasesChanged = false;
        for (const assignment of assignmentSites(definition.body)) {
          const valueName = assignment.value.match(/^([A-Za-z_]\w*)$/)?.[1];
          const helper = assignment.value.match(/^([A-Za-z_]\w*)\s*\(/)?.[1];
          if ((valueName && localAliases.has(valueName) || helper && returning.has(helper)) && !localAliases.has(assignment.name)) {
            localAliases.add(assignment.name);
            aliasesChanged = true;
          }
        }
      }
      const returns = [...definition.body.matchAll(/\breturn\b([^\n;]*)/g)].map((match) => match[1]!.replace(/\bend\s*$/, "").trim());
      if (returns.some((value) => referencesAny(value, localAliases) || [...returning].some((helper) => new RegExp("^" + helper + "\\s*\\(").test(value)))) {
        returning.add(name);
        changed = true;
      }
    }
  }
  return returning;
}

function memberField(member: string) {
  return member.match(/^\.([A-Za-z_]\w*)$/)?.[1];
}

function preservesMemberField(value: string, member: string, derived: Set<string>) {
  const field = memberField(member);
  if (!field) return false;
  const source = value.match(/^([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)(?:\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]]*\]))*$/);
  return source !== null && source[2] === field && derived.has(source[1]!);
}

function copiesDerivedValue(value: string, member: string, derived: Set<string>) {
  const argument = value.match(/^TableCopy\s*\(\s*([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*|\s*\[[^\]]*\])?)\s*\)$/)?.[1];
  if (!argument) return false;
  const root = argument.match(/^[A-Za-z_]\w*/)?.[0];
  if (!root || !derived.has(root)) return false;
  const field = memberField(member);
  if (!field) return true;
  return preservesMemberField(argument, member, derived);
}

function validateExpandedFilter(source: string) {
  const definition = functionDefinition(source, "expandFilter");
  if (!definition || definition.parameters.length !== 1) {
    throw new BadRequestException("Project-GC expandFilter must take one filter argument");
  }
  const parameter = definition.parameters[0]!;
  if (functionMutatesParameter(source, "expandFilter", parameter)) {
    throw new BadRequestException("Project-GC expandFilter must not mutate its argument");
  }
  const derived = new Set([parameter]);
  let changed = true;
  while (changed) {
    changed = false;
    const loops = /\bfor\s+(?:([A-Za-z_]\w*)\s*,\s*)?([A-Za-z_]\w*)\s+in\s+([^\n]+)\s+do\b/g;
    for (const loop of definition.body.matchAll(loops)) {
      if (!referencesAny(loop[3]!, derived)) continue;
      for (const name of [loop[1], loop[2]]) {
        if (name && !derived.has(name)) { derived.add(name); changed = true; }
      }
    }
    for (const assignment of assignmentSites(definition.body)) {
      if (referencesAny(assignment.value, derived) && !derived.has(assignment.name)) {
        derived.add(assignment.name); changed = true;
      }
    }
    for (const assignment of memberAssignmentSites(definition.body)) {
      if (referencesAny(assignment.value, derived) && !derived.has(assignment.name)) {
        derived.add(assignment.name); changed = true;
      }
    }
  }
  for (const assignment of memberAssignmentSites(definition.body)) {
    if (!derived.has(assignment.name)) continue;
    const simpleValue = preservesMemberField(assignment.value, assignment.member, derived);
    const copiedValue = copiesDerivedValue(assignment.value, assignment.member, derived);
    const emptyAccumulator = assignment.value === "{}" && (assignment.member === ".types" || assignment.member === ".excludeTypes" || assignment.member.startsWith("[")) && accumulatorIsPopulated(definition.body, assignment, derived);
    if (!simpleValue && !copiedValue && !emptyAccumulator) {
      throw new BadRequestException(`Project-GC expandFilter must preserve the input filter semantics (unsupported write to ${assignment.name}${assignment.member})`);
    }
  }
  const returns = [...definition.body.matchAll(/\breturn\b([^\n;]*)/g)].map((match) => match[1]!.replace(/\bend\s*$/, "").trim());
  const returnsFromUnknownCall = returns.some((value) => {
    const call = value.match(/^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\(/)?.[1]?.replace(/\s/g, "");
    return call !== undefined && call !== "TableCopy";
  });
  if (!returns.length || returns.some((value) => !referencesAny(value, derived)) || returnsFromUnknownCall) {
    throw new BadRequestException("Project-GC expandFilter must return a filter derived from its argument");
  }
}

function functionMutatesParameter(source: string, name: string, parameter: string, stack = new Set<string>()): boolean {
  const key = `${name}:${parameter}`;
  if (stack.has(key)) return true;
  const definition = functionDefinition(source, name);
  if (!definition) return true;
  const nextStack = new Set(stack);
  nextStack.add(key);
  const aliases = new Set([parameter]);
  const localNames = new Set(assignmentSites(definition.body).filter((assignment) => assignment.local).map((assignment) => assignment.name));
  for (const assignment of assignmentSites(definition.body)) {
    const valueName = assignment.value.match(/^([A-Za-z_]\w*)$/)?.[1];
    const valueRead = [...aliases].some((alias) => new RegExp("^" + alias + "\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\]|$)").test(assignment.value));
    const valueCall = /^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?\s*\(/.test(assignment.value);
    if (aliases.has(assignment.name)) {
      if (!valueName || !aliases.has(valueName)) return true;
    } else if (valueName && aliases.has(valueName)) {
      if (!assignment.local && !localNames.has(assignment.name)) return true;
      aliases.add(assignment.name);
    } else if (referencesAny(assignment.value, aliases) && !valueRead && !/^#\s*(?:[A-Za-z_]\w*)$/.test(assignment.value) && !valueCall) {
      return true;
    }
  }
  const aliasPattern = [...aliases].map((alias) => "\\b" + alias + "\\b").join("|");
  if (new RegExp("(?:" + aliasPattern + ")\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\])\\s*=").test(definition.body)) return true;
  for (const assignment of memberAssignmentSites(definition.body)) {
    if (referencesAny(assignment.value, aliases)) return true;
  }
  for (const call of callSites(definition.body)) {
    if (CONTROL_CALLS.has(call.name)) continue;
    const argumentsList = topLevelArguments(call.argumentsText);
    for (const [index, argument] of argumentsList.entries()) {
      if (!referencesAny(argument, aliases)) continue;
      if (MUTATING_TABLE_CALLS.has(call.name)) return true;
      if (READ_ONLY_CALLS.has(call.name) && call.name === "TableCopy") continue;
      const nested = functionDefinition(source, call.name);
      if (nested) {
        const nestedParameter = nested.parameters[index];
        if (!nestedParameter || functionMutatesParameter(source, call.name, nestedParameter, nextStack)) return true;
      } else if (!READ_ONLY_CALLS.has(call.name)) {
        return true;
      }
    }
  }
  return false;
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
  const assignment = /(?:\blocal\s+)?([A-Za-z_]\w*)\s*=\s*(?:(?:TableCopy\s*\(\s*)?(?:config|conf)\s*\)?(?![\w.\[]))/g;
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
    const assignment = new RegExp("(?:\\blocal\\s+)?" + alias + "\\s*=(?!=)\\s*([^\\n;]+)", "g");
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
    const mutation = new RegExp("\\b" + alias + "\\s*\\.\\s*([A-Za-z_]\\w*(?:\\s*\\.\\s*[A-Za-z_]\\w*)*)\\s*=(?!=)\\s*([^\\n;]+)", "g");
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
      const expanded = /^expandFilter\s*\(\s*[A-Za-z_]\w*\s*\)$/.test(rhs);
      if (expanded) validateExpandedFilter(source);
      const allowed = expanded || rhs === "config" || rhs === "conf" || allowedCopy || rhs === "nil" || rhs === "l_filter";
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
  // The single-comparison requirement is enforced structurally below
  // (exactly one `#finds >= conf.limit` check, gated ok-assignments and a
  // gated verdict return). Other `#finds` uses — index math such as
  // `#finds+1` or display text such as `".." .. #finds .. ".."` — cannot
  // reach the verdict, so they are not counted here.
  const findsAssignmentCount = body.match(/\bfinds\s*=(?!=)\s*/g) ?? [];
  if (findsAssignmentCount.length !== 1) throw new BadRequestException("The c_number finds result must not be reassigned");
  if (!/\bfinds\s*=\s*(?:(?:[A-Za-z_]\w*\s*\.\s*)?[A-Za-z_]\w*)\s*\(/.test(body)) {
    throw new BadRequestException("The c_number finds result must come from a function call");
  }
  const findsAliases = new Set(["finds"]);
  const findsAssignments = assignmentSites(body);
  const findsBinding = findsAssignments.find((assignment) => assignment.name === "finds");
  const findsCall = findsBinding?.value.match(/^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\(/)?.[1]?.replace(/\s/g, "");
  if (!findsBinding || !findsCall || !SUPPORTED_FIND_CALLS.has(findsCall) || !isWholeCallExpression(findsBinding.value, findsCall)) {
    throw new BadRequestException("The c_number finds result must come from a supported Project-GC find call");
  }
  if (findsCall === "GetCombinedFinds" && !functionDefinition(source, findsCall)) {
    throw new BadRequestException("The c_number finds result must come from a supported Project-GC find call");
  }
  const localNames = new Set([
    ...findsAssignments.filter((assignment) => assignment.local).map((assignment) => assignment.name),
    ...[...body.matchAll(/\blocal\s+([A-Za-z_]\w*)/g)].map((match) => match[1]!)
  ]);
  let aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const assignment of findsAssignments) {
      const valueName = assignment.value.match(/^([A-Za-z_]\w*)$/)?.[1];
      if (valueName && findsAliases.has(valueName)) {
        if (!assignment.local && !localNames.has(assignment.name)) {
          throw new BadRequestException("The c_number finds result must not escape its local scope");
        }
        if (!findsAliases.has(assignment.name)) {
          findsAliases.add(assignment.name);
          aliasesChanged = true;
        }
      } else if (referencesAny(assignment.value, findsAliases)) {
        const valueRead = [...findsAliases].some((alias) => new RegExp("^" + alias + "\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\]|$)").test(assignment.value));
        const valueLength = new RegExp("^#\\s*(?:" + [...findsAliases].join("|") + ")$").test(assignment.value);
        const valueCopy = /^TableCopy\s*\(/.test(assignment.value);
        if (!valueRead && !valueLength && !valueCopy && findsReferenceEscapes(assignment.value, findsAliases, source)) {
          throw new BadRequestException("The c_number finds result must not escape its local scope");
        }
      }
    }
  }
  const returningFindHelpers = functionsReturningAliases(source, findsAliases);
  aliasesChanged = true;
  while (aliasesChanged) {
    aliasesChanged = false;
    for (const assignment of findsAssignments) {
      const helper = assignment.value.match(/^([A-Za-z_]\w*)\s*\(/)?.[1];
      if (!helper || !returningFindHelpers.has(helper)) continue;
      if (!assignment.local && !localNames.has(assignment.name)) {
        throw new BadRequestException("The c_number finds result must not escape its local scope");
      }
      if (!findsAliases.has(assignment.name)) {
        findsAliases.add(assignment.name);
        aliasesChanged = true;
      }
    }
  }
  const helperReference = [...returningFindHelpers].map((helper) => new RegExp("\\b" + helper + "\\s*\\("));
  for (const assignment of findsAssignments) {
    if (assignment.value.trim().startsWith("{") && helperReference.some((pattern) => pattern.test(assignment.value))) {
      throw new BadRequestException("The c_number finds result must not escape its local scope");
    }
  }
  for (const assignment of memberAssignmentSites(body)) {
    if (helperReference.some((pattern) => pattern.test(assignment.value))) {
      throw new BadRequestException("The c_number finds result must not escape its local scope");
    }
  }
  const findsAliasPattern = [...findsAliases].map((alias) => "\\b" + alias + "\\b").join("|");
  if (new RegExp("(?:" + findsAliasPattern + ")\\s*(?:\\.\\s*[A-Za-z_]\\w*|\\[[^\\]]*\\])\\s*=").test(body)) {
    throw new BadRequestException("The c_number finds result must not be mutated in place");
  }
  for (const assignment of memberAssignmentSites(body)) {
    if (referencesAny(assignment.value, findsAliases)) {
      throw new BadRequestException("The c_number finds result must not escape its local scope");
    }
  }
  for (const call of callSites(body)) {
    if (CONTROL_CALLS.has(call.name)) continue;
    const argumentsList = topLevelArguments(call.argumentsText);
    for (const [index, argument] of argumentsList.entries()) {
      if (!new RegExp("(?:" + findsAliasPattern + ")").test(argument)) continue;
      if (MUTATING_TABLE_CALLS.has(call.name)) {
        throw new BadRequestException("The c_number finds result must not be mutated in place");
      }
      const definition = functionDefinition(source, call.name);
      if (definition) {
        const parameter = definition.parameters[index];
        if (!parameter || functionMutatesParameter(source, call.name, parameter)) {
          throw new BadRequestException("The c_number finds result must not be mutated in place");
        }
      } else if (!READ_ONLY_CALLS.has(call.name)) {
        throw new BadRequestException("The c_number finds result must not be mutated in place");
      }
    }
  }
  for (const call of callSites(body)) {
    const argumentsList = topLevelArguments(call.argumentsText);
    if (!argumentsList.some((argument) => [...returningFindHelpers].some((helper) => new RegExp("^" + helper + "\\s*\\(").test(argument.trim())))) continue;
    if (MUTATING_TABLE_CALLS.has(call.name) || !READ_ONLY_CALLS.has(call.name)) {
      throw new BadRequestException("The c_number finds result must not be mutated in place");
    }
  }
  const exactIf = body.match(/\bif\s*\(?\s*#\s*finds\s*>=\s*conf\s*\.\s*limit\s*\)?\s*then\b/g) ?? [];
  const exactReturn = body.match(/\bok\s*=\s*#\s*finds\s*>=\s*conf\s*\.\s*limit\b\s*(?=[,}])/g) ?? [];
  if (exactIf.length + exactReturn.length !== 1) throw new BadRequestException("c_number must return exactly the conf.limit count condition");
  const returnStatements = [...body.matchAll(/\breturn\s*\{([^}]*)\}/g)].map((match) => match[1] ?? "");
  if (returnStatements.some((value) => (value.match(/\bok\s*=/g) ?? []).length > 1)) {
    throw new BadRequestException("The c_number result must not contain duplicate verdict fields");
  }
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
  const cNumberCalls = [...source.matchAll(/\bc_number\s*\(\s*conf\s*\)/g)].filter((match) => !/\bfunction\s*$/.test(source.slice(0, match.index ?? 0)));
  if (cNumberCalls.length !== 1) throw new BadRequestException("The importer requires one direct c_number(conf) checker invocation");
  const invocation = cNumberCalls[0]!;
  const invocationIndex = invocation.index ?? 0;
  const statementStart = Math.max(source.lastIndexOf("\n", invocationIndex), source.lastIndexOf(";", invocationIndex)) + 1;
  const invocationEnd = invocationIndex + invocation[0]!.length;
  const nextNewline = source.indexOf("\n", invocationEnd);
  const nextSemicolon = source.indexOf(";", invocationEnd);
  const statementEnd = [nextNewline, nextSemicolon].filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? source.length;
  const beforeInvocation = source.slice(statementStart, invocationIndex);
  const afterInvocationStatement = source.slice(invocationEnd, statementEnd);
  const assignmentMatch = /^\s*$/.test(afterInvocationStatement) ? beforeInvocation.match(/^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=\s*$/) : null;
  const directReturn = /^\s*return\s*$/.test(beforeInvocation) && /^\s*$/.test(afterInvocationStatement);
  if (!assignmentMatch && !directReturn) {
    throw new BadRequestException("The c_number result must be returned or assigned directly");
  }
  if (directReturn) {
    if (source.slice(statementEnd).trim()) throw new BadRequestException("The c_number result must be returned or assigned directly");
  } else {
    const resultName = assignmentMatch?.[1];
    if (!resultName) throw new BadRequestException("The c_number result must be returned or assigned directly");
    const afterInvocation = source.slice(invocationEnd);
    const aliases = new Set([resultName]);
    const verdictAliases = new Set<string>();
    const assignments = /(?:^|[;\n])\s*(?:\blocal\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*([^;\n]*)/g;
    for (const assignment of afterInvocation.matchAll(assignments)) {
      const name = assignment[1]!;
      const value = assignment[2]!.trim();
      const valueName = value.match(/^([A-Za-z_]\w*)$/)?.[1];
      const isResultRead = [...aliases].some((alias) => new RegExp("^" + alias + "\\s*\\.\\s*ok$").test(value));
      if (isResultRead) verdictAliases.add(name);
      if (verdictAliases.has(name) && !isResultRead && value !== name) {
        throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
      }
      if (aliases.has(name)) {
        if (!valueName || !aliases.has(valueName)) {
          throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
        }
      } else if (valueName && aliases.has(valueName)) {
        aliases.add(name);
      } else if (!isResultRead && [...aliases].some((alias) => new RegExp("\\b" + alias + "\\b").test(value))) {
        // Reads of display fields (slog/shtml/log/html) into fresh locals
        // cannot fabricate a pass: the returned verdict must still be res.ok
        // or a boolean read of it (checked with returnVerdict below), and
        // verdict aliases cannot be reassigned from these locals.
        const fieldReadPattern = new RegExp("\\b(?:" + [...aliases].map((alias) => alias).join("|") + ")\\s*\\.\\s*[A-Za-z_]\\w*", "g");
        if ([...aliases].some((alias) => new RegExp("\\b" + alias + "\\b").test(value.replace(fieldReadPattern, "")))) {
          throw new BadRequestException("The c_number result must not be reassigned or have its verdict overridden");
        }
      }
    }
    const aliasPattern = [...aliases].map((alias) => "\\b" + alias + "\\b").join("|");
    const resultAssignment = new RegExp("(?:" + aliasPattern + ")\\s*(?:\\.\\s*ok\\s*=(?!=)|\\[[^\\]]*\\]\\s*=(?!=))");
    const methodCall = new RegExp("(?:" + aliasPattern + ")\\s*:\\s*[A-Za-z_]\\w*\\s*\\(");
    const containerAssignment = /\b[A-Za-z_]\w*\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]]*\])\s*=(?!=)\s*([^\n;]*)/g;
    const resultRead = (value: string) => [...aliases].some((alias) => new RegExp("^" + alias + "\\s*\\.\\s*ok$").test(value.trim()));
    const aliasReference = new RegExp("(?:" + aliasPattern + ")");
    if ([...afterInvocation.matchAll(/\breturn\s*\{([^}]*)\}/g)].some((statement) => (statement[1]!.match(/\bok\s*=/g) ?? []).length > 1)) {
      throw new BadRequestException("The c_number result must not contain duplicate verdict fields");
    }
    const containerReference = [...afterInvocation.matchAll(containerAssignment)].some((assignment) => !resultRead(assignment[1]!) && aliasReference.test(assignment[1]!));
    // Calls that only read the result (e.g. ok_html(res.ok) for display) are
    // fine when the callee is defined in the script and provably does not
    // mutate the argument it receives. Unknown callees still fail closed.
    const callReference = callSites(afterInvocation).some((call) => {
      if (!aliasReference.test(call.argumentsText)) return false;
      if (MUTATING_TABLE_CALLS.has(call.name) || READ_ONLY_CALLS.has(call.name)) return MUTATING_TABLE_CALLS.has(call.name);
      const definition = functionDefinition(source, call.name);
      if (!definition) return true;
      const argumentsList = topLevelArguments(call.argumentsText);
      return argumentsList.some((argument, index) => {
        if (!aliasReference.test(argument)) return false;
        const parameter = definition.parameters[index];
        return !parameter || functionMutatesParameter(source, call.name, parameter);
      });
    });
    const returnVerdict = [...afterInvocation.matchAll(/\breturn\s*\{([^}]*)\}/g)].some((statement) => {
      const value = statement[1]!.match(/\bok\s*=\s*([^,}\n]+)/)?.[1]?.trim();
      if (value === undefined) return false;
      return !resultRead(value) && ![...verdictAliases].some((alias) => new RegExp("^" + alias + "$").test(value));
    });
    if (resultAssignment.test(afterInvocation) || methodCall.test(afterInvocation) || containerReference || callReference || returnVerdict) {
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
  const script = stripDeadNilBranches(maskLua(scriptValue));
  validateParseBudgets(script);
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
