import assert from "node:assert/strict";
import test from "node:test";
import { attributesFromRaw, evaluateChallenge } from "./challenge-checker.evaluator";

const finds = [
  { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { gcCode: "GC1", name: "One", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Skane", county: null } },
  { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { gcCode: "GC2", name: "Two", cacheType: "Mystery Cache", difficulty: 2.5, terrain: 3, country: "Sweden", region: "Skane", county: null } },
  { foundAt: new Date("2024-02-29T00:00:00Z"), foundDate: new Date("2024-02-29T00:00:00Z"), cache: { gcCode: "GC3", name: "Three", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Denmark", region: null, county: null } }
];

test("evaluates supported rules and combines them with AND", () => {
  const result = evaluateChallenge([
    { type: "TOTAL_FINDS", minimum: 3 },
    { type: "CACHE_TYPE", cacheTypeId: "2", cacheTypeLabel: "Traditional Cache", minimum: 2 },
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

test("matches imported cache-type aliases by canonical id", () => {
  const result = evaluateChallenge([
    { type: "CACHE_TYPE", cacheTypeId: "8", cacheTypeLabel: "Mystery Cache", minimum: 2 }
  ], [
    { ...finds[0]!, cache: { ...finds[0]!.cache, cacheType: "Unknown Cache" } },
    { ...finds[1]!, cache: { ...finds[1]!.cache, cacheType: "Unknown (Mystery) Cache" } }
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.rules[0]!.current, 2);
});

test("labels text-free GSAK attributes by Groundspeak id", () => {
  const raw = {
    "groundspeak:cache": {
      "groundspeak:attributes": {
        "groundspeak:attribute": [{ id: "1", inc: "1" }, { id: "2", inc: "0" }, { id: "71", inc: "1" }]
      }
    }
  };
  assert.deepEqual(attributesFromRaw(raw), [
    { id: "1", label: "Dogs" },
    { id: "71", label: "Challenge cache" }
  ]);
});

test("evaluates the expanded imported-data rules", () => {
  const expandedFinds = [
    { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { ...finds[0]!.cache, gcCode: "GC30", size: "Micro", hiddenDate: new Date("2001-01-01T00:00:00Z"), difficulty: 2.5, terrain: 3, raw: { "groundspeak:cache": { "groundspeak:favorite_points": 12, "groundspeak:attributes": { "groundspeak:attribute": { id: "1", inc: "1", text: "Dogs" } } } } } },
    { foundAt: new Date("2025-01-02T00:00:00Z"), foundDate: new Date("2025-01-02T00:00:00Z"), cache: { ...finds[0]!.cache, gcCode: "GC31", size: "Micro", hiddenDate: new Date("2001-02-01T00:00:00Z"), difficulty: 2.5, terrain: 3, raw: { "groundspeak:cache": { "groundspeak:favorite_points": 4 } } } },
    { foundAt: new Date("2025-01-04T00:00:00Z"), foundDate: new Date("2025-01-04T00:00:00Z"), cache: { ...finds[0]!.cache, gcCode: "GC32", size: "Regular", hiddenDate: new Date("2001-02-15T00:00:00Z"), difficulty: 1, terrain: 1, raw: {} } }
  ];
  const result = evaluateChallenge([
    { type: "CACHE_SIZE", size: "Micro", minimum: 2 },
    { type: "FIND_STREAK", minimum: 2 },
    { type: "PLACED_MONTHS", minimum: 2 },
    { type: "MONTH_OF_YEAR", month: 1, minimum: 3 },
    { type: "WEEKDAY", weekday: 3, minimum: 1 },
    { type: "DIFFICULTY_RATING", rating: 2.5, minimum: 2 },
    { type: "TERRAIN_RATING", rating: 3, minimum: 2 },
    { type: "FAVORITE_POINTS", minimumFavoritePoints: 10, minimum: 1 },
    { type: "ATTRIBUTE", attributeId: "1", attributeLabel: "Dogs", minimum: 1 }
  ], expandedFinds);
  assert.equal(result.passed, true);
  assert.deepEqual(result.rules.map((rule) => rule.current), [2, 2, 2, 3, 1, 2, 2, 1, 1]);
});

test("matches Swedish län/kommun names across Groundspeak and boundary spellings", () => {
  const karlskronaFind = { foundAt: new Date("2025-01-01T00:00:00Z"), foundDate: new Date("2025-01-01T00:00:00Z"), cache: { gcCode: "GCKNA", name: "Kna find", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Blekinge", county: "Karlskrona" } };
  const locationResult = evaluateChallenge([
    { type: "LOCATION", field: "county", value: "Karlskrona", country: "Sweden", region: "Blekinge län", minimum: 1 }
  ], [karlskronaFind]);
  assert.equal(locationResult.rules[0]!.current, 1);

  const kommunResult = evaluateChallenge([
    { type: "LOCATION", field: "county", value: "Karlskrona kommun", country: "Sweden", region: "Blekinge", minimum: 1 }
  ], [karlskronaFind]);
  assert.equal(kommunResult.rules[0]!.current, 1);

  const importedResult = evaluateChallenge([{
    type: "PROJECT_GC_NUMBER",
    minimum: 1,
    filterLabel: "Karlskrona",
    filters: [{ countries: ["Sweden"], regions: ["Blekinge län"], counties: ["Karlskrona"] }]
  }], [karlskronaFind]);
  assert.equal(importedResult.rules[0]!.current, 1);
});

test("evaluates imported Project-GC count filters as alternatives without double counting", () => {
  const result = evaluateChallenge([{
    type: "PROJECT_GC_NUMBER",
    minimum: 2,
    filterLabel: "Sweden Micro; or EarthCache",
    filters: [
      { countries: ["Sweden"], sizes: ["Micro"] },
      { cacheTypeIds: ["137"] }
    ]
  }], [
    { ...finds[0]!, cache: { ...finds[0]!.cache, size: "Micro" } },
    { ...finds[1]!, cache: { ...finds[1]!.cache, cacheType: "EarthCache", size: "Micro" } },
    { ...finds[2]!, cache: { ...finds[2]!.cache, size: "Regular" } }
  ]);
  assert.equal(result.passed, true);
  assert.equal(result.rules[0]!.current, 2);
  assert.match(result.rules[0]!.label, /Project-GC count/);
});
