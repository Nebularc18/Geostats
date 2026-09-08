import assert from "node:assert/strict";
import test from "node:test";
import { importProjectGcCalendarScript, importProjectGcMatrixScript, importProjectGcMonthlyScript, importProjectGcNumberScript, isProjectGcMonthlyScript } from "./project-gc-importer";

const numberScript = `
local args={...}
local conf = args[1].config
function c_number(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;

test("imports a Project-GC c_number script and tag config", () => {
  const imported = importProjectGcNumberScript(numberScript, JSON.stringify({
    limit: 25,
    country: "Sweden",
    types: ["Physical"],
    difficulties: [2.5, 3]
  }));
  assert.equal(imported.rules[0]!.minimum, 25);
  assert.deepEqual(imported.rules[0]!.filters[0]!.countries, ["Sweden"]);
  assert.equal(imported.rules[0]!.filters[0]!.cacheTypeIds?.length, 7);
  assert.deepEqual(imported.rules[0]!.filters[0]!.difficulties, [2.5, 3]);
  assert.match(imported.summary, /25 finds/);
});

test("accepts the config-copy and expanded-filter shape used by the Project-GC sample", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter) return filter end
function GetCombinedFinds(profileId, config)
  local l_config = TableCopy(config)
  l_config.filter.filters = nil
  local l_filter = TableCopy(l_config)
  l_config.filter = l_filter
  l_config.fields = { 'gccode' }
  l_config.filter = expandFilter(c)
  return PGC.GetFinds(profileId, l_config)
end
function c_number(conf)
  local options = { 'limit' }
  if extraInConfig(conf, options) == true then return { ok = nil } end
  local finds = GetCombinedFinds(args[1].profileId, { filter = conf })
  local ok = false
  if #finds >= conf.limit then ok = true end
  return { ok = ok }
end
res = c_number(conf)
local ok = res.ok
return { ok = ok }
`;
  assert.equal(importProjectGcNumberScript(script, '{"limit":1}').rules[0]!.minimum, 1);
});

test("rejects a pass verdict planted outside its gating condition", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter) return filter end
function GetCombinedFinds(profileId, config)
  local l_config = TableCopy(config)
  l_config.filter.filters = nil
  local l_filter = TableCopy(l_config)
  l_config.filter = l_filter
  l_config.fields = { 'gccode' }
  l_config.filter = expandFilter(c)
  return PGC.GetFinds(profileId, l_config)
end
function c_number(conf)
  local options = { 'limit' }
  if extraInConfig(conf, options) == true then return { ok = nil } end
  local finds = GetCombinedFinds(args[1].profileId, { filter = conf })
  local ok = false
  if #finds >= conf.limit then end
  ok = true
  return { ok = ok }
end
res = c_number(conf)
local ok = res.ok
return { ok = ok }
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /additional pass\/fail condition/);
});

test("rejects an expanded filter that ignores its input", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter) return { country = 'Sweden' } end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*derived/);
});

test("rejects an expanded filter that delegates to a constant helper", () => {
  const script = `
local args={...}
local conf = args[1].config
function constantFilter(filter) return { country = 'Sweden' } end
function expandFilter(filter) return constantFilter(filter) end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*derived/);
});

test("rejects an expanded filter that adds a restriction", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = TableCopy(filter)
  result.country = 'Sweden'
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*semantics/);
});

test("rejects an expanded filter that copies across fields", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = TableCopy(filter)
  result.types = filter.country
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*(?:semantics|must not mutate)/);
});

test("rejects an expanded filter that clears a type field", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = TableCopy(filter)
  result.types = {}
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*semantics/);
});

test("accepts a populated type expansion accumulator", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = {}
  for k, value in pairs(filter) do
    result[k] = TableCopy(value)
  end
  result.types = {}
  for _, value in ipairs(filter.types) do
    table.insert(result.types, value)
  end
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.equal(importProjectGcNumberScript(script, '{"limit":1}').rules[0]!.minimum, 1);
});

test("rejects a partial type expansion accumulator", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = TableCopy(filter)
  result.types = {}
  for _, value in ipairs(filter.types) do
    if value == filter.types[1] then table.insert(result.types, value) end
  end
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*semantics/);
});

test("rejects an accumulator populated from an unrelated loop", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local result = TableCopy(filter)
  result.types = {}
  for _, value in ipairs(otherValues) do
    table.insert(result.types, 'Traditional Cache')
  end
  return result
end
function c_number(conf)
  local l_config = TableCopy(conf)
  l_config.filter = expandFilter(conf)
  local finds = PGC.GetFinds(args[1].profileId, { filter = conf })
  return { ok = #finds >= conf.limit }
end
return c_number(conf)
`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /expandFilter.*semantics/);
});

test("merges Project-GC alternative filters with the base filter", () => {
  const imported = importProjectGcNumberScript(numberScript, JSON.stringify({
    limit: 2,
    country: "Sweden",
    filters: [{ sizes: ["Micro"] }, { types: ["EarthCache"] }]
  }));
  assert.equal(imported.rules[0]!.filters.length, 2);
  assert.deepEqual(imported.rules[0]!.filters[0]!.countries, ["Sweden"]);
  assert.deepEqual(imported.rules[0]!.filters[0]!.sizes, ["Micro"]);
  assert.deepEqual(imported.rules[0]!.filters[1]!.cacheTypeIds, ["137"]);
});

test("rejects arbitrary Lua instead of executing it", () => {
  assert.throws(() => importProjectGcNumberScript("return os.execute('bad')", '{"limit":1}'), /Project-GC/);
});

test("rejects a c_number script that passes a different GetFinds filter", () => {
  const script = numberScript.replace("{ filter = conf }", "{ filter = other }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /tag config as its filter/);
});

test("rejects an added boolean condition in the checker result", () => {
  const script = numberScript.replace("return { ok = #finds >= conf.limit }", "return { ok = #finds >= conf.limit and conf.brief }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /exactly the conf.limit count condition/);
});

test("rejects mutation of the config passed to GetFinds", () => {
  const script = numberScript.replace("function c_number(conf)", "function c_number(conf)\n  conf.filter = other");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /must not be mutated/);
});

test("rejects reassignment of the finds result", () => {
  const script = numberScript.replace("return { ok = #finds >= conf.limit }", "finds = {}\n  return { ok = #finds >= conf.limit }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not be reassigned/);
});

test("rejects in-place mutation of the finds result", () => {
  const script = numberScript.replace("return { ok = #finds >= conf.limit }", "table.remove(finds, 1)\n  return { ok = #finds >= conf.limit }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not be mutated/);
});

test("rejects helper calls that mutate the finds result", () => {
  const script = numberScript.replace("return { ok = #finds >= conf.limit }", "function dropTop(rows)\n    table.remove(rows, 1)\n  end\n  dropTop(finds)\n  return { ok = #finds >= conf.limit }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not be mutated/);
});

test("rejects aliases returned through a closure before mutation", () => {
  const script = numberScript.replace(
    "return { ok = #finds >= conf.limit }",
    "local function expose()\n    return finds\n  end\n  local rows = expose()\n  table.remove(rows, 1)\n  return { ok = #finds >= conf.limit }"
  );
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not be mutated/);
});

test("rejects closure aliases stored in container fields", () => {
  const script = numberScript.replace(
    "return { ok = #finds >= conf.limit }",
    "local function expose()\n    return finds\n  end\n  local box = { rows = expose() }\n  table.remove(box.rows, 1)\n  return { ok = #finds >= conf.limit }"
  );
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not escape/);
});

test("rejects finds results that escape into mutable storage", () => {
  const scripts = [
    numberScript.replace("return { ok = #finds >= conf.limit }", "local box = { finds }\n  table.remove(box[1], 1)\n  return { ok = #finds >= conf.limit }"),
    numberScript.replace("return { ok = #finds >= conf.limit }", "local box = {}\n  box.result = finds\n  table.remove(box.result, 1)\n  return { ok = #finds >= conf.limit }"),
    numberScript.replace("return { ok = #finds >= conf.limit }", "function stash(rows)\n    savedRows = rows\n  end\n  stash(finds)\n  table.remove(savedRows, 1)\n  return { ok = #finds >= conf.limit }")
  ];
  for (const script of scripts) assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /finds result must not escape|finds result must not be mutated/);
});

test("rejects wrappers that transform the Project-GC finds result", () => {
  const script = numberScript.replace(
    "local finds = PGC.GetFinds(args[1].profileId, { filter = conf })",
    "function shrink(rows)\n    table.remove(rows, 1)\n    return rows\n  end\n  local finds = shrink(PGC.GetFinds(args[1].profileId, { filter = conf }))"
  );
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /supported Project-GC find call/);
});

test("rejects an outer return that changes the c_number verdict", () => {
  const script = numberScript.replace("return c_number(conf)", "local ok = c_number(conf).ok and conf.brief\nreturn { ok = ok }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /c_number result must be returned or assigned directly/);
});

test("rejects embedded c_number invocations", () => {
  const script = numberScript.replace("return c_number(conf)", "res = force(c_number(conf), true)\nreturn res");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /returned or assigned directly/);
});

test("rejects duplicate verdict fields in the outer result", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nreturn { ok = res.ok, ok = false }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /duplicate verdict fields/);
});

test("rejects overriding the c_number result after invocation", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nres.ok = false\nreturn res");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects method calls on the c_number result", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nres:flip()\nreturn res");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects aliases that override the c_number result", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nlocal alias = res\nalias.ok = false\nreturn res");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects indirect mutations of the c_number result", () => {
  const scripts = [
    numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nrawset(res, \"ok\", false)\nreturn res"),
    numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nlocal box = { result = res }\nbox.result.ok = false\nreturn res"),
    numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nmutate(res)\nreturn res")
  ];
  for (const script of scripts) assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects returning a constant verdict after invoking c_number", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nreturn { ok = false }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects changing a verdict alias after reading c_number", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nlocal ok = res.ok\nok = false\nreturn { ok = ok }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects unsupported config fields instead of changing checker meaning", () => {
  assert.throws(() => importProjectGcNumberScript(numberScript, '{"limit":1,"radius":10}'), /radius.*not supported/);
});

test("rejects scripts whose syntax nesting exceeds the parser budget", () => {
  const script = `${"(".repeat(101)}${")".repeat(101)}`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /nesting is too deep/);
});

test("rejects scripts whose call count exceeds the parser budget", () => {
  const script = "f()\n".repeat(4001);
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /contains too many calls/);
});

test("rejects scripts whose cumulative parser scan work exceeds the budget", () => {
  const script = `${"f()\n".repeat(500)}${" ".repeat(200_000)}`;
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /requires too much parsing work/);
});

const calendarScript = `
local args={...}
profileName = args[1]['profileName']
profileId = args[1]['profileId']
conf = args[1].config
local daysinmonth = { 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }
function CleanupConfig(conf)
  if conf.limit == nil then
    conf.limit = 1
  else
    conf.limit = tonumber(conf.limit)
  end
  if conf.needed == nil then
    conf.needed = 366
  else
    conf.needed = tonumber(conf.needed)
  end
  if conf.leapday == "allow" then
    conf.leapday = "false"
  else
    conf.leapday = "true"
  end
  return conf
end
function FilterFromConfig(conf)
  local filter = conf['filter'] or { }
  filter['country'] = filter['country'] or conf.country
  filter['sizes'] = filter['sizes'] or conf.sizes
  return filter
end
function makekey(month, day)
  return string.format("%02d-%02d", month, day)
end
function c_calendar(conf)
  local status = { }
  conf = CleanupConfig(conf)
  local filter = FilterFromConfig(conf)
  myFinds = PGC.GetFinds(profileId,
                         { includeLabCaches = conf.labs,
                           fields = { 'gccode', 'visitdate' },
                           order = 'OLDESTFIRST',
                           filter = filter } )
  for i, f in ipairs(myFinds) do
    day = string.sub(f['visitdate'], 6)
    if status[day] == nil then
      status[day] = 1
    else
      status[day] = status[day] + 1
    end
  end
  local numdone = 0
  for month = 1, 12 do
    for day = 1, daysinmonth[month] do
      local key = makekey(month, day)
      if status[key] ~= nil and status[key] >= conf.limit then
        numdone = numdone + 1
      end
    end
  end
  local ok = false
  if numdone >= conf.needed
    or (numdone == 365 and conf.needed == 366
    and conf.leapday == "false"
    and (status[makekey(2,29)] == nil
      or (status[makekey(2,29)] ~= nil and status[makekey(2,29)] < conf.limit))
    ) then
    ok = true
  end
  return { ok = ok }
end
res = c_calendar(conf)
local ok = res.ok
return { ok = ok }
`;

test("imports an official-style calendar checker", () => {
  const imported = importProjectGcCalendarScript(calendarScript, JSON.stringify({ leapday: "allow", limit: 1, filter: { sizes: ["Small"] } }));
  assert.equal(imported.rules[0]!.type, "CALENDAR_FILL");
  assert.equal(imported.rules[0]!.minimum, 366);
  assert.equal(imported.rules[0]!.perDay, 1);
  assert.equal(imported.rules[0]!.allowLeapDaySkip, true);
  assert.deepEqual(imported.rules[0]!.filters[0]!.sizes, ["Small"]);
  assert.match(imported.summary, /366 calendar dates/);
});

test("rejects calendar configs with unsupported modes", () => {
  const base = { leapday: "allow", limit: 1, filter: { sizes: ["Small"] } };
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, filters: [{ sizes: ["Small"] }] })), /single 'filter' object/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, years: 2 })), /single-year/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, placed: "birthday" })), /placed/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, nooftypes: 3 })), /cache types per day/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, ExcludedTypes: ["Event Cache"] })), /Excluded/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, filter: { sizes: ["Small"], types: ["Lab Cache"] } })), /Lab caches/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ limit: 1 })), /at least one find filter/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript, JSON.stringify({ ...base, radius: 10 })), /not supported/);
});

test("rejects calendar scripts that diverge from the tag config", () => {
  const config = JSON.stringify({ leapday: "allow", limit: 1, filter: { sizes: ["Small"] } });
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("filter = filter }", "filter = other }"), config), /tag config as its filter/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("if numdone >= conf.needed", "if numdone > conf.needed"), config), /distinct calendar dates/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("status[key] ~= nil and status[key] >= conf.limit", "status[key] ~= nil"), config), /distinct calendar dates/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("for month = 1, 12 do", "for month = 1, 6 do"), config), /distinct calendar dates/);
  assert.throws(() => importProjectGcCalendarScript("res = c_calendar(conf)\nreturn { ok = res.ok }", config), /single PGC.GetFinds call/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("function c_calendar(conf)", "function c_calendar_other(conf)"), config), /c_calendar must be a function/);
  assert.throws(() => importProjectGcCalendarScript(calendarScript.replace("    ) then\n    ok = true\n  end", "    ) then\n  end\n  ok = true"), config), /pass on its completed-day count/);
});

test("accepts the display and legacy-branch idioms of the official generic checker", () => {
  const script = `
local args={...}
local conf = args[1].config
function expandFilter(filter)
  local res = {}
  for k,v in pairs(filter) do
    if k=="types" then
      res['types'] = {}
      for i,t in ipairs(v) do
        if t=="Physical" then
          table.insert(res.types, "Traditional Cache")
        else
          table.insert(res.types, t)
        end
      end
    elseif k==excludeTypes then
      filter.excludeTypes = {}
    else
      res[k] = TableCopy(v)
    end
  end
  return res
end
function GetCombinedFinds(profileId, config)
  local l_config = TableCopy(config)
  l_config.filter.filters = nil
  local l_filter = TableCopy(l_config)
  l_config.filter = l_filter
  l_config.fields = { 'gccode' }
  l_config.filter = expandFilter(c)
  return PGC.GetFinds(profileId, l_config)
end
function shown(rows) return tostring(#rows) end
function ok_html(a)
  if a == true then return 'yes' else return 'no' end
end
function c_number(conf)
  local options = { 'limit' }
  if extraInConfig(conf, options) == true then return { ok = nil } end
  local finds = GetCombinedFinds(args[1].profileId, { filter = conf })
  local brief = shown(finds)
  local ok = false
  if #finds >= conf.limit then ok = true end
  local text = 'has ' .. #finds .. ' finds'
  if conf.brief == true then text = '' end
  return { ok = ok }
end
res = c_number(conf)
local log = res.slog
local html = ok_html(res.ok)
return { ok = res.ok, log = log, html = html }
`;
  const imported = importProjectGcNumberScript(script, JSON.stringify({ limit: 250, country: "Sweden", region: "Blekinge", county: "Karlskrona" }));
  assert.equal(imported.rules[0]!.minimum, 250);
  assert.deepEqual(imported.rules[0]!.filters[0]!.counties, ["Karlskrona"]);
  assert.deepEqual(imported.rules[0]!.filters[0]!.regions, ["Blekinge"]);
});

const matrixScript = `
local args = {...}
local conf = args[1].config
local profileId = args[1].profileId
local known_dimensions = {
  ["same"] = {["name"]=""}
, ["type"] = {["name"]="type" }
}
local x = conf.SameX
if x == nil then x='same' end
local y = conf.DifferentY
local xy = {x,y}
local filter = {}
filter.country = conf.country
filter.types = conf.types
local needed = 1
if (conf.Groups ~= nil) and (tonumber(conf.Groups)>0) then
    needed = tonumber(conf.Groups)
end
local mintuplesize = 2
if (conf.Minimum ~= nil) and (tonumber(conf.Minimum)>0) then
    mintuplesize = tonumber(conf.Minimum)
end
local finds = PGC.GetFinds(profileId, { fields = fields, filter = filter, includeLabCaches = conf.labcaches })
for n,f in ipairs (finds) do
\tfor _,d in ipairs (xy) do
\t\tif known_dimensions[d].read ~= nil then
\t\t\tf[d] = known_dimensions[d].read(f)
\t\tend
\tend
end
local tuples = {}
local tuplesize = {}
local qualified_tuples = {}
for n,f in ipairs (finds) do
\tif f[x] ~= nil and f[y] ~= nil then
\t\tif tuples[f[x]] == nil then
\t\t\ttuples[f[x]] = {}
\t\t\ttuplesize[f[x]] = 0
\t\tend
\t\tif tuples[f[x]][f[y]] == nil then
\t\t\ttuplesize[f[x]] = tuplesize[f[x]] + 1
\t\t\tif tuplesize[f[x]] == mintuplesize then
\t\t\t\ttable.insert (qualified_tuples, f[x])
\t\t\tend
\t\tend
\tend
end
local ok = false
local log = ""
local html = ""
if #qualified_tuples >= needed then
\tok = true
end
return { ok = ok, log = log, html = html }
`;

test("imports an official-style type matrix checker", () => {
  const imported = importProjectGcMatrixScript(matrixScript, JSON.stringify({ DifferentY: "type", Minimum: 10 }));
  assert.equal(imported.rules[0]!.type, "DISTINCT_TYPES");
  assert.equal(imported.rules[0]!.minimum, 10);
  assert.match(imported.summary, /10 distinct cache types/);
});

test("rejects matrix configs with unsupported modes", () => {
  const base = { DifferentY: "type", Minimum: 10 };
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ Minimum: 10 })), /DifferentY 'type'/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, SameX: "county" })), /SameX 'same'/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, Groups: 5 })), /single-group/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, Require: [["type", "=", "Traditional"]] })), /Require/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, owned: true })), /Owned-cache/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, filter: { country: "Sweden" } })), /top-level options/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript, JSON.stringify({ ...base, types: ["Physical"] })), /list the types instead/);
});

test("rejects matrix scripts that diverge from the tag config", () => {
  const config = JSON.stringify({ DifferentY: "type", Minimum: 10 });
  assert.throws(() => importProjectGcMatrixScript(matrixScript.replace("filter = filter,", "filter = other,"), config), /tag config as its filter/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript.replace("if #qualified_tuples >= needed then", "if #qualified_tuples > needed then"), config), /qualifying group count/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript.replace("local y = conf.DifferentY", "local y = 'size'"), config), /tag config dimensions/);
  assert.throws(() => importProjectGcMatrixScript(matrixScript.replace("table.insert (qualified_tuples, f[x])", "table.insert (qualified_tuples, f[y])"), config), /tag config dimensions/);
});

const monthlyScript = `
local args = {...}
local conf = args[1].config
local profileId = args[1].profileId
local gccode = args[1].gccode

function countbits(test, bits, range)
  local nr = 32 * range + 1
  local bnr = 0
  while bits > 0 do
    if bits % 2 > 0 then
      test.attributes[nr] = (test.attributes[nr] or 0) + 1
      bits = bits - 1
      bnr = bnr + 1
    end
    bits = bits / 2
    nr = nr + 1
  end
  return bnr
end

function attrbits(test, cache)
  return countbits(test, cache.attributes_set_1, 0)
end

function histogram(field)
  local ordfield = field .. '_ord'
  for _, cache in ipairs(finds) do
    cache[ordfield] = 1
  end
  return 1
end

function order(field, direction)
  local ordfield = field .. '_ord'
  for ord, cache in ipairs(finds) do
    cache[ordfield] = ord
  end
  return 1
end

function MaGeo526()
  local caches = PGC.GetFinds(7684056, { fields = fields })
  return caches
end

local functions = {
  bitmask = function() value = 1 end,
  sort = function() value = 1 end,
  funen = function() value = MaGeo526() end
}

function func(funcs, value, test, cache)
  for _, f in ipairs(funcs) do
    local arg = f
    functions[arg[1]]()
  end
  return value
end

function preparepolygons()
  for _, cache in ipairs(finds) do
    cache.polygon = polyname
  end
end

function preparetest(test)
  test.number = 0
end

function inittest(tests)
  for _, test in ipairs(tests) do
    preparetest(test)
    if test.visitdate then
      test.number = 0
    end
  end
end

function itemfilter(filter)
  return true
end

function testfilter_or(filters)
  if filters.field then return true end
  return true
end

function testfilter_and(filters)
  if filters.field then return true end
  return true
end

function qualify(test, index)
  local cache = finds[index]
  local stamp = iso:parse(cache.visitdate)
  local gap = stamp:diff(stamp)
  local peak = math.max(tonumber(cache.difficulty) or 0, 1)
  local bits = attrbits(test, cache)
  if test.condition then
    test.number = test.number + 1
  end
  if test.visitdate then
    cache.total = 1
  end
  if test.filters and not testfilter_and(test.filters) then
    return false
  end
  test.number = test.number + 1
  return true
end

local fields = {}
finds = PGC.GetFinds(profileId, { fields = fields, order = 'OLDESTFIRST', filter = conf.filter })

Exclude = {}
if type(conf.exclude) == "string" then
  Exclude[conf.exclude] = 1
else
  Exclude[gccode] = 1
end

if conf.labs then
  table.insert(finds, lab)
end

if conf.owned then
  table.insert(finds, cache)
end

for _, cache in ipairs(finds) do
  if Exclude[cache.gccode] then
    cache.exclude = true end
end

local testnumber = #conf.tests
if not conf.min then conf.min = testnumber end
local ok_number = 0
for _, test in ipairs(conf.tests) do
  preparetest(test)
  for index = 1, #finds do
    qualify(test, index)
  end
  if not test.number or test.min and test.number < test.min then
    test.passed = false
  else
    test.passed = true
    ok_number = ok_number + 1
  end
end

if
  ok_number < conf.min
  then
  ok = false
else
  ok = true
end
return { ok = ok, log = "", html = "" }
`;

const monthlyConfig = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  links: true,
  filter: { types: ["Mystery Cache"] },
  min: 3,
  tests: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((name, position) => ({
    name: `Find at least 3 caches with the "Challenge" attribute in ${name} (year not important)`,
    filters: [{ field: "visitdate[6,7]", value: String(position + 1).padStart(2, "0") }, { field: "attribute:71" }],
    log: { format: "{visitdate} {gccode} - {cache_name}", func: [["sort"]], limit: 3 },
    min: 3
  })),
  ...overrides
});

test("imports an official-style monthly attribute checker", () => {
  assert.equal(isProjectGcMonthlyScript(monthlyScript), true);
  assert.equal(isProjectGcMonthlyScript(matrixScript), false);
  const imported = importProjectGcMonthlyScript(monthlyScript, monthlyConfig());
  assert.equal(imported.rules[0]!.type, "MONTHLY_ATTRIBUTE");
  assert.equal(imported.rules[0]!.months.length, 12);
  assert.deepEqual(imported.rules[0]!.months[0], { month: 1, minimum: 3 });
  assert.equal(imported.rules[0]!.overallMinimum, 3);
  assert.equal(imported.rules[0]!.attributeId, "71");
  assert.equal(imported.rules[0]!.excludeSelf, true);
  assert.match(imported.rules[0]!.filterLabel, /Mystery/);
  assert.match(imported.summary, /3 months of Challenge cache/);
});

test("rejects monthly configs outside the supported pattern", () => {
  const base = JSON.parse(monthlyConfig());
  const withTests = (tests: unknown) => monthlyConfig({ tests });
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([{ ...base.tests[0], filters: [base.tests[0].filters[0]] }])), /one month and one attribute/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([base.tests[0], { ...base.tests[1], filters: base.tests[0].filters }])), /distinct months/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([{ ...base.tests[0], filters: [{ field: "visitdate[6,7]", value: "13" }, { field: "attribute:71" }] }])), /month must be/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([base.tests[0], { ...base.tests[1], filters: [{ field: "visitdate[6,7]", value: "02" }, { field: "attribute:72" }] }])), /same attribute/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([{ ...base.tests[0], min: undefined }])), /positive integer min/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, withTests([{ ...base.tests[0], log: { func: [["bitmask"]] } }])), /log func/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, monthlyConfig({ min: 0 })), /overall minimum/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, monthlyConfig({ min: 13 })), /overall minimum/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript, monthlyConfig({ owned: true })), /Owned-cache/);
});

test("rejects monthly scripts that diverge from the tag config", () => {
  const config = monthlyConfig();
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript.replace("filter = conf.filter", "filter = other"), config), /tag config as its filter/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript + "\nlocal extra = PGC.GetFinds(profileId, { filter = conf.filter })", config), /single PGC.GetFinds/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript.replace("test.number = test.number + 1\n  return true", "test.number = test.number + 1\n  cache.total = 2\n  return true"), config), /must not rewrite/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript.replace("ok_number < conf.min", "ok_number <= conf.min"), config), /qualifying count/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript.replace("function testfilter_and", "function testfilter_xor"), config), /count matching finds/);
  assert.throws(() => importProjectGcMonthlyScript(monthlyScript.replace("test.min and test.number < test.min", "test.number < test.min"), config), /count matching finds/);
});
