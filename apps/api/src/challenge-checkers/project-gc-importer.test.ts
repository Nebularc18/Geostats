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
  assert.throws(() => importProjectGcNumberScript("return os.execute('bad')", '{"limit":1}'), /currently supports Project-GC c_number scripts/);
});

test("rejects unsupported config fields instead of changing checker meaning", () => {
  assert.throws(() => importProjectGcNumberScript(numberScript, '{"limit":1,"radius":10}'), /radius.*not supported/);
});
