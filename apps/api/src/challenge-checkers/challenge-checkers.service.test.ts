import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeCheckersService, resolveDisplayTimeZone } from "./challenge-checkers.service";

test("resolves the cacher display timezone from home coordinates with profile fallback", () => {
  assert.equal(resolveDisplayTimeZone({ homeLatitude: 59.3293, homeLongitude: 18.0686, timeZone: "America/New_York" }), "Europe/Stockholm");
  assert.equal(resolveDisplayTimeZone({ homeLatitude: null, homeLongitude: null, timeZone: "America/New_York" }), "America/New_York");
});

test("falls back to imported location metadata when boundary geometry is unavailable", async () => {
  const checker = {
    id: "checker-1",
    userId: "user-1",
    name: "Region challenge",
    gcCode: "GCTEST",
    description: null,
    rules: [{ type: "LOCATION", field: "region", value: "Skane", country: "Sweden", region: "Skane", minimum: 1 }],
    publicSlug: null,
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher", timeZone: "Europe/Stockholm" }) },
    find: { findMany: async () => [{
      foundAt: new Date("2025-05-02T22:30:00Z"),
      foundDate: new Date("2025-05-03T00:00:00Z"),
      cache: { gcCode: "GCFIND", name: "Fallback find", cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Skane", county: null, latitude: 55.6, longitude: 13 }
    }] },
    import: { findFirst: async () => null }
  };
  const boundaries = { geometry: async () => { throw new Error("Boundary provider unavailable"); } };
  const service = new ChallengeCheckersService(prisma as never, boundaries as never);

  const result = await service.runOwned("user-1", "checker-1");

  assert.equal(result.passed, true);
  assert.equal(result.rules[0]!.current, 1);
  assert.equal(result.rules[0]!.evidence[0]!.date, "2025-05-03");
});

test("prefers imported metadata over coarse boundaries and uses geometry only for missing fields", async () => {
  const checker = {
    id: "checker-1",
    userId: "user-1",
    name: "County challenge",
    gcCode: "GCTEST",
    description: null,
    rules: [{ type: "LOCATION", field: "county", value: "Karlskrona", country: "Sweden", region: "Blekinge län", minimum: 1 }],
    publicSlug: null,
    publishedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };
  const find = (gcCode: string, county: string | null, latitude: number, longitude: number) => ({
    foundAt: new Date("2025-05-02T22:30:00Z"),
    foundDate: new Date("2025-05-03T00:00:00Z"),
    cache: { gcCode, name: gcCode, cacheType: "Traditional Cache", difficulty: 1, terrain: 1, country: "Sweden", region: "Blekinge", county, latitude, longitude, userData: [] }
  });
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher", timeZone: "Europe/Stockholm" }) },
    find: { findMany: async () => [
      find("GCMETA", "Karlskrona", 50, 50),
      find("GCGEO", null, 5, 5),
      find("GCOUT", null, 50, 50)
    ] },
    import: { findFirst: async () => null }
  };
  const square = { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] };
  const boundaries = { geometry: async () => square };
  const service = new ChallengeCheckersService(prisma as never, boundaries as never);

  const result = await service.runOwned("user-1", "checker-1");

  assert.equal(result.rules[0]!.current, 2);
  assert.deepEqual(result.rules[0]!.evidence.map((row) => row.gcCode).sort(), ["GCGEO", "GCMETA"]);
});

test("public checker evaluation rejects find histories above its bounded query", async () => {
  const checker = {
    id: "checker-1",
    userId: "user-1",
    name: "Public challenge",
    gcCode: "GCTEST",
    description: null,
    rules: [{ type: "TOTAL_FINDS", minimum: 1 }],
    publicSlug: "public-slug",
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };
  let findQuery: Record<string, unknown> | undefined;
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: {
      findMany: async (query: Record<string, unknown>) => {
        findQuery = query;
        return Array(10_001).fill({});
      }
    }
  };
  const service = new ChallengeCheckersService(prisma as never, {} as never);

  await assert.rejects(service.runPublic("public-slug"), /cannot evaluate more than 10,000 finds/);
  assert.equal(findQuery?.take, 10_001);
});

test("owned checker evaluation keeps complete find-history compatibility", async () => {
  const checker = {
    id: "checker-1",
    userId: "user-1",
    name: "Owned challenge",
    gcCode: "GCTEST",
    description: null,
    rules: [{ type: "TOTAL_FINDS", minimum: 1 }],
    publicSlug: null,
    publishedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z")
  };
  let findQuery: Record<string, unknown> | undefined;
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: { findMany: async (query: Record<string, unknown>) => { findQuery = query; return []; } },
    import: { findFirst: async () => null }
  };
  const service = new ChallengeCheckersService(prisma as never, {} as never);

  await service.runOwned("user-1", "checker-1");
  assert.equal(findQuery && "take" in findQuery, false);
});

test("uses imported location choices when catalog providers are unavailable", async () => {
  const prisma = {
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: { findMany: async () => [
      { cache: { country: "Norway", region: "Vestland", county: "Bergen" } },
      { cache: { country: "Norway", region: "Vestland", county: "Voss" } }
    ] }
  };
  const boundaries = {
    regions: async () => { throw new Error("Kartverket unavailable"); },
    counties: async () => { throw new Error("Kartverket unavailable"); }
  };
  const service = new ChallengeCheckersService(prisma as never, boundaries as never);

  assert.deepEqual(await service.locationCatalogForUser("user-1", "Norway", undefined), { regions: ["Vestland"], counties: [] });
  assert.deepEqual(await service.locationCatalogForUser("user-1", "Norway", "Vestland"), { regions: [], counties: ["Bergen", "Voss"] });
});


function filterRule(filter: Record<string, unknown>) {
  return { type: "PROJECT_GC_NUMBER", minimum: 1, filters: [filter] };
}

test("creation and updates reject oversized text and numeric filter lists before writing", async () => {
  let writes = 0;
  const service = new ChallengeCheckersService({ challengeChecker: {
    findFirst: async () => ({ id: "checker", userId: "owner" }),
    create: async () => { writes++; }, update: async () => { writes++; }
  } } as any, {} as any);
  for (const key of ["countries", "regions", "counties", "cacheTypeIds", "excludedCacheTypeIds", "sizes", "difficulties", "terrains"]) {
    const rule = filterRule({ [key]: Array(257).fill(["difficulties", "terrains"].includes(key) ? 1 : "nonmatching") });
    await assert.rejects(service.create("owner", { name: "Bounded", gcCode: "GC123", rules: [rule] }), /Invalid .* filter/);
    await assert.rejects(service.update("owner", "checker", { rules: [rule] }), /Invalid .* filter/);
  }
  assert.equal(writes, 0);
});

test("multiple individually bounded filters cannot evade total checker complexity limits", async () => {
  const service = new ChallengeCheckersService({} as any, {} as any);
  const rules = Array.from({ length: 5 }, () => filterRule({ countries: Array(256).fill("nonmatching") }));
  await assert.rejects(service.create("owner", { name: "Bounded", gcCode: "GC123", rules }), /total checker complexity/);
});

test("oversized persisted rules are rejected on owned and public runs before loading finds", async () => {
  let queriedFinds = false;
  const checker = { id: "checker", userId: "owner", rules: [filterRule({ countries: Array(257).fill("nonmatching") })] };
  const service = new ChallengeCheckersService({
    challengeChecker: { findFirst: async () => checker },
    find: { findMany: async () => { queriedFinds = true; return []; } }
  } as any, {} as any);
  await assert.rejects(service.runOwned("owner", "checker"), /Invalid countries filter/);
  await assert.rejects(service.runPublic("published"), /Invalid countries filter/);
  assert.equal(queriedFinds, false);
});

test("bounded filters with a large history reject excessive evaluation work before mapping finds", async () => {
  const checker = { id: "checker", userId: "owner", rules: [filterRule({ countries: Array(256).fill("nonmatching") })] };
  const service = new ChallengeCheckersService({
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Owner" }) },
    // Invalid find objects would throw if evaluation were reached.
    find: { findMany: async () => Array(4_000).fill(null) }
  } as any, {} as any);
  await assert.rejects(service.runOwned("owner", "checker"), /evaluation exceeds the work limit/);
  await assert.rejects(service.runPublic("published"), /evaluation exceeds the work limit/);
});

test("ordinary Project-GC filters continue to be persisted", async () => {
  let saved: any;
  const service = new ChallengeCheckersService({ challengeChecker: { create: async ({ data }: any) => { saved = data; return data; } } } as any, {} as any);
  await service.create("owner", { name: "Normal", gcCode: "GC123", rules: [filterRule({ countries: ["Sweden", "Norway"], difficulties: [1, 1.5, 2] })] });
  assert.deepEqual(saved.rules[0].filters, [{ countries: ["Sweden", "Norway"], difficulties: [1, 1.5, 2] }]);
});


test("alternate imported rule forms enforce the same filter bounds", async () => {
  const service = new ChallengeCheckersService({} as any, {} as any);
  const filters = [{ counties: Array(257).fill("nonmatching") }];
  const rules = [
    { type: "CALENDAR_FILL", minimum: 1, perDay: 1, allowLeapDaySkip: false, filters },
    { type: "DISTINCT_TYPES", minimum: 1, filters },
    { type: "MONTHLY_ATTRIBUTE", minimum: 1, months: [{ month: 1, minimum: 1 }], overallMinimum: 1, attributeId: "1", attributeLabel: "Dogs", filters, excludedGcCodes: [], excludeSelf: false }
  ];
  for (const rule of rules) {
    await assert.rejects(service.create("owner", { name: "Bounded", gcCode: "GC123", rules: [rule] }), /Invalid counties filter/);
  }
  await assert.rejects(service.create("owner", { name: "Bounded", gcCode: "GC123", rules: [{ ...rules[2], filters: [{}], excludedGcCodes: Array(257).fill("GC123") }] }), /Too many excluded GC codes/);
});

test("empty filters cannot evade the aggregate filter-count bound", async () => {
  const service = new ChallengeCheckersService({} as any, {} as any);
  const rules = Array.from({ length: 3 }, () => ({ type: "PROJECT_GC_NUMBER", minimum: 1, filters: Array.from({ length: 50 }, () => ({})) }));
  await assert.rejects(service.create("owner", { name: "Bounded", gcCode: "GC123", rules }), /total checker complexity/);
});


test("challenge location and execution preserve metadata from the exact user's private import", async () => {
  let savedQuery: any;
  const cache = { gcCode: "GCFIND", name: "GCFIND", metadataTrusted: false, latitude: 0, longitude: 0,
    country: null, region: null, county: null, cacheType: null,
    userData: [{ raw: { geostatsMetadata: { name: "Private find", latitude: 59, longitude: 18,
      country: "Sweden", region: "Stockholm", cacheType: "Traditional Cache" } } }] };
  const checker = { id: "checker", userId: "alice", name: "Sweden", gcCode: "GCTEST", description: null,
    rules: [{ type: "LOCATION", field: "country", value: "Sweden", minimum: 1 }], publicSlug: null,
    publishedAt: null, updatedAt: new Date() };
  const service = new ChallengeCheckersService({
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Alice", timeZone: "Europe/Stockholm" }) },
    find: { findMany: async (query: any) => { savedQuery = query; return [{ cache, foundAt: new Date(), foundDate: new Date() }]; } },
    import: { findFirst: async () => null }
  } as any, {} as any);
  const locations = await service.locationsForUser("alice");
  assert.equal(locations[0].name, "Sweden");
  assert.deepEqual(savedQuery.select.cache.select.userData.where, { userId: "alice" });
  const result = await service.runOwned("alice", "checker");
  assert.equal(result.passed, true);
  assert.equal(result.rules[0].evidence[0].name, "Private find");
  assert.deepEqual(savedQuery.include.cache.include.userData.where, { userId: "alice" });
});
