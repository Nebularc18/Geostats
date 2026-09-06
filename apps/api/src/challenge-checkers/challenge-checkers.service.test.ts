import assert from "node:assert/strict";
import test from "node:test";
import { ChallengeCheckersService, MAX_PUBLIC_CHALLENGE_FINDS, resolveDisplayTimeZone } from "./challenge-checkers.service";

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

test("public challenge checks reject histories over the bound before evaluation", async () => {
  let findQuery: Record<string, unknown> | undefined;
  const checker = {
    id: "checker-1", userId: "user-1", name: "Large challenge", gcCode: "GCTEST",
    description: null, rules: [{ type: "TOTAL_FINDS", minimum: 1 }], publicSlug: "public",
    publishedAt: new Date(), updatedAt: new Date()
  };
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: { findMany: async (query: Record<string, unknown>) => {
      findQuery = query;
      return new Array(MAX_PUBLIC_CHALLENGE_FINDS + 1);
    } },
    import: { findFirst: async () => null }
  };
  const service = new ChallengeCheckersService(prisma as never, {} as never);

  await assert.rejects(() => service.runPublic("public"), /support at most 50000 finds/);
  assert.equal(findQuery?.take, MAX_PUBLIC_CHALLENGE_FINDS + 1);
});

test("owned challenge checks retain full-history behavior", async () => {
  let findQuery: Record<string, unknown> | undefined;
  const checker = {
    id: "checker-1", userId: "user-1", name: "Owned challenge", gcCode: "GCTEST",
    description: null, rules: [{ type: "TOTAL_FINDS", minimum: 1 }], publicSlug: null,
    publishedAt: null, updatedAt: new Date()
  };
  const prisma = {
    challengeChecker: { findFirst: async () => checker },
    geocachingProfile: { findUnique: async () => ({ gcUsername: "Geocacher" }) },
    find: { findMany: async (query: Record<string, unknown>) => { findQuery = query; return []; } },
    import: { findFirst: async () => null }
  };
  const service = new ChallengeCheckersService(prisma as never, {} as never);

  await service.runOwned("user-1", "checker-1");
  assert.equal("take" in findQuery!, false);
});
