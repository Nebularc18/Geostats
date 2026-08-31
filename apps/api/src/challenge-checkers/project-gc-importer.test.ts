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

test("rejects an outer return that changes the c_number verdict", () => {
  const script = numberScript.replace("return c_number(conf)", "local ok = c_number(conf).ok and conf.brief\nreturn { ok = ok }");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /additional pass\/fail condition/);
});

test("rejects overriding the c_number result after invocation", () => {
  const script = numberScript.replace("return c_number(conf)", "local res = c_number(conf)\nres.ok = false\nreturn res");
  assert.throws(() => importProjectGcNumberScript(script, '{"limit":1}'), /result must not be reassigned/);
});

test("rejects unsupported config fields instead of changing checker meaning", () => {
  assert.throws(() => importProjectGcNumberScript(numberScript, '{"limit":1,"radius":10}'), /radius.*not supported/);
});
