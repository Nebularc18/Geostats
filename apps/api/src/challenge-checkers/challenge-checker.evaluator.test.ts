import assert from "node:assert/strict";
import test from "node:test";
import { evaluateChallenge } from "./challenge-checker.evaluator";

const finds = [
  { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { gcCode: "GC1", name: "One", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Skane", county: null } },
  { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { gcCode: "GC2", name: "Two", cacheType: "Mystery Cache", difficulty: 2.5, terrain: 3, country: "Sweden", region: "Skane", county: null } },
  { foundAt: new Date("2024-02-29T00:00:00Z"), foundDate: new Date("2024-02-29T00:00:00Z"), cache: { gcCode: "GC3", name: "Three", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Denmark", region: null, county: null } }
];

test("evaluates supported rules and combines them with AND", () => {
  const result = evaluateChallenge([
    { type: "TOTAL_FINDS", minimum: 3 },
    { type: "CACHE_TYPE", cacheType: "Traditional Cache", minimum: 2 },
    { type: "LOCATION", field: "country", value: "Sweden", country: "Sweden", minimum: 2 },
    { type: "CALENDAR_DAYS", minimum: 2 },
    { type: "DIFFICULTY_TERRAIN", minimum: 2 }
  ], finds);
  assert.equal(result.passed, true);
  assert.deepEqual(result.rules.map((rule) => rule.current), [3, 2, 2, 2, 2]);
  assert.equal(result.rules[3]!.evidence.length, 2);
  assert.equal(result.rules[4]!.evidence.length, 2);
});

test("scopes duplicate county names through their selected parents", () => {
  const result = evaluateChallenge([
    { type: "LOCATION", field: "county", value: "Central", country: "Sweden", region: "Skane", minimum: 1 }
  ], [
    ...finds,
    { foundAt: new Date("2025-03-01T00:00:00Z"), foundDate: new Date("2025-03-01T00:00:00Z"), cache: { gcCode: "GC4", name: "Wrong parent", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Denmark", region: "Zealand", county: "Central" } },
    { foundAt: new Date("2025-03-02T00:00:00Z"), foundDate: new Date("2025-03-02T00:00:00Z"), cache: { gcCode: "GC5", name: "Right parent", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Skane", county: "Central" } }
  ]);
  assert.equal(result.rules[0]!.current, 1);
  assert.equal(result.rules[0]!.evidence[0]!.gcCode, "GC5");
});

test("can match metadata-free locations through a geographic matcher", () => {
  const result = evaluateChallenge([
    { type: "LOCATION", field: "region", value: "Capital Region", country: "Iceland", region: "Capital Region", minimum: 1 }
  ], finds, { locationMatch: (_rule, find) => find.cache.gcCode === "GC3" });
  assert.equal(result.rules[0]!.current, 1);
  assert.equal(result.rules[0]!.evidence[0]!.gcCode, "GC3");
});

test("reports an unmet rule", () => {
  const result = evaluateChallenge([{ type: "CALENDAR_DAYS", minimum: 366 }], finds);
  assert.equal(result.passed, false);
  assert.match(result.rules[0]!.detail, /364 more needed/);
});

test("credits calendar days and formats evidence from the persisted logged date", () => {
  const result = evaluateChallenge([{ type: "CALENDAR_DAYS", minimum: 1 }], [
    { foundAt: new Date("2025-05-03T12:00:00Z"), foundDate: new Date("2025-05-03T00:00:00Z"), cache: { gcCode: "GC10", name: "Midday", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: null, county: null } },
    { foundAt: new Date("2024-05-02T22:30:00Z"), foundDate: new Date("2024-05-03T00:00:00Z"), cache: { gcCode: "GC11", name: "Local next day", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: null, county: null } }
  ]);

  assert.equal(result.rules[0]!.current, 1);
  assert.equal(result.rules[0]!.evidence[0]!.gcCode, "GC11");
  assert.equal(result.rules[0]!.evidence[0]!.date, "2024-05-03");
});

test("does not accept a mutable profile timezone as a calendar input", () => {
  const result = evaluateChallenge([{ type: "CALENDAR_DAYS", minimum: 1 }], [
    { foundAt: new Date("2025-05-03T12:00:00Z"), foundDate: new Date("2025-05-03T00:00:00Z"), cache: { gcCode: "GC20", name: "First year", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: null, county: null } },
    { foundAt: new Date("2024-05-02T22:30:00Z"), foundDate: new Date("2024-05-03T00:00:00Z"), cache: { gcCode: "GC21", name: "Second year", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: null, county: null } }
  ]);

  assert.equal(result.rules[0]!.current, 1);
  assert.equal(result.rules[0]!.evidence[0]!.date, "2024-05-03");
});
