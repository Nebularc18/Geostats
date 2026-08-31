import assert from "node:assert/strict";
import test from "node:test";
import { importProjectGcNumberScript } from "./project-gc-importer";

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
