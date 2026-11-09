import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { evaluateChallenge, proofText, type CheckerFind } from "./challenge-checker.evaluator";
import { ChallengeCheckersService } from "./challenge-checkers.service";
import { importProjectGcCountryScript, isProjectGcCountryScript } from "./project-gc-importer";

const script = readFileSync(resolve(__dirname, "../../src/challenge-checkers/fixtures/generic-country-2026-11-03.lua"), "utf8");
const config = { countries: 3, findsPerCountry: 1, list: "show" };
const find = (gcCode: string, country: string | null, cacheType = "Traditional Cache"): CheckerFind => ({
  foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"),
  cache: { gcCode, name: gcCode, country, cacheType, difficulty: 1, terrain: 1, region: null, county: null }
});
const finds = [find("GC1", "Sweden"), find("GC2", "Denmark"), find("GC3", "Norway")];

test("imports the supplied Generic Country script through the service and evaluates three countries", () => {
  const service = new ChallengeCheckersService({} as never, {} as never);
  const imported = service.importProjectGc({ script, config: JSON.stringify(config) });
  assert.equal(imported.rules[0]!.type, "COUNTRIES");
  assert.match(imported.summary, /3 countries with at least 1 find each/);
  assert.match(imported.summary, /bookmark exclusion list is unavailable/);
  assert.equal(evaluateChallenge(imported.rules, finds).passed, true);
  assert.match(evaluateChallenge(imported.rules, finds).rules[0]!.detail, /bookmark exclusions are unavailable/);
  assert.equal(evaluateChallenge(imported.rules, finds.slice(0, 2)).passed, false);
});

test("country counts require enough unique eligible caches within each country and the total", () => {
  const rules = importProjectGcCountryScript(script, JSON.stringify({ countries: 2, findsPerCountry: 2, findsTotal: 5 })).rules;
  const four = [...finds, find("GC4", "Sweden"), find("GC5", "Denmark")];
  assert.equal(evaluateChallenge(rules, four).passed, true);
  assert.equal(evaluateChallenge(rules, four.filter((row) => row.cache.country !== "Norway")).passed, false);
  const result = evaluateChallenge(rules, [...finds, finds[0]!, find("GC6", null), find("GC7", "Finland", "Locationless Cache")]);
  assert.equal(result.passed, false);
  assert.equal(result.rules[0]!.current, 0);
});

test("country imports reject changed script logic and unsupported tag conditions", () => {
  assert.equal(isProjectGcCountryScript(script.replace(/\r\n/g, "\n")), true);
  for (const changed of [script.replace("areasFound >= minAreas", "areasFound <= minAreas"), script.replace("'Locationless Cache'", "'Traditional Cache'")]) {
    assert.equal(isProjectGcCountryScript(changed), false);
    assert.throws(() => importProjectGcCountryScript(changed, JSON.stringify(config)), /version/);
  }
  for (const extra of [{ countries: "all" }, { minElevation: 100 }, { country: "Europe" }, { findsPerCountry: 0 }]) {
    assert.throws(() => importProjectGcCountryScript(script, JSON.stringify({ ...config, ...extra })));
  }
});

test("country imports apply cache type, country and GC exclusions", () => {
  const rules = importProjectGcCountryScript(script, JSON.stringify({ countries: 1, country: "Sweden", ExcludedGCCodes: "GC1", excludedTypes: "Events", ignoreBookmark: false })).rules;
  assert.equal(evaluateChallenge(rules, [...finds, find("GC4", "Sweden", "Event Cache")]).passed, false);
  assert.equal(evaluateChallenge(rules, [...finds, find("GC5", "Sweden")]).passed, true);
});

test("country rules survive saving and loading, and exclude the challenge itself", async () => {
  let saved: any;
  let history = finds;
  const prisma = {
    challengeChecker: {
      create: async ({ data }: any) => { saved = { id: "country-checker", ...data }; return saved; },
      findFirst: async () => saved
    },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: { findMany: async () => history },
    import: { findFirst: async () => null }
  };
  const service = new ChallengeCheckersService(prisma as never, {} as never);
  const imported = service.importProjectGc({ script, config: JSON.stringify(config) });
  await service.create("owner", { name: "Three countries", gcCode: "GCSELF", rules: imported.rules });
  assert.equal((await service.runOwned("owner", "country-checker")).passed, true);
  history = [finds[0]!, finds[1]!, find("GCSELF", "Norway")];
  assert.equal((await service.runOwned("owner", "country-checker")).passed, false);
});


test("country date filters apply before repeat logs are removed", () => {
  const rules = importProjectGcCountryScript(script, JSON.stringify({ countries: 1, minVisitDate: "2025-02-01" })).rules;
  const before = find("GCREPEAT", "Sweden");
  const after = { ...before, foundAt: new Date("2025-03-01T00:00:00Z"), foundDate: new Date("2025-03-01T00:00:00Z") };
  const result = evaluateChallenge(rules, [before, after, after]);
  assert.equal(result.passed, true);
  assert.equal(result.rules[0]!.current, 1);
  assert.deepEqual(result.rules[0]!.evidence, [{ date: "2025-03-01", gcCode: "GCREPEAT", name: "GCREPEAT" }]);
  const needsTwo = importProjectGcCountryScript(script, JSON.stringify({ countries: 1, findsPerCountry: 2, minVisitDate: "2025-02-01" })).rules;
  assert.equal(evaluateChallenge(needsTwo, [before, after, after]).passed, false);
});

test("copied country proofs retain the total requirement and bookmark limitation", () => {
  const rules = importProjectGcCountryScript(script, JSON.stringify({ ...config, findsTotal: 5 })).rules;
  const result = evaluateChallenge(rules, finds);
  const proof = proofText("Geocacher", "Three countries", result);
  assert.equal(result.passed, false);
  assert.match(proof, /3 countries; 3 required/);
  assert.match(proof, /3 total finds; 5 required/);
  assert.match(proof, /bookmark exclusions are unavailable and are not applied/);
  const passing = importProjectGcCountryScript(script, JSON.stringify(config)).rules;
  const passingProof = proofText("Geocacher", "Three countries", evaluateChallenge(passing, finds));
  assert.match(passingProof, /3 total finds; 1 required/);
  assert.match(passingProof, /bookmark exclusions are unavailable and are not applied/);
  const noBookmark = importProjectGcCountryScript(script, JSON.stringify({ ...config, ignoreBookmark: false })).rules;
  assert.doesNotMatch(proofText("Geocacher", "Three countries", evaluateChallenge(noBookmark, finds)), /bookmark exclusions/);
});
