import assert from "node:assert/strict";
import test from "node:test";
import { cacheTypeIdentity, cacheTypeOptions, canonicalCacheTypeName } from "./cache-types";

test("maps Groundspeak full names to stable type ids", () => {
  assert.deepEqual(cacheTypeIdentity("Unknown Cache"), { id: "8", label: "Mystery Cache" });
  assert.deepEqual(cacheTypeIdentity("Earth Cache"), { id: "137", label: "EarthCache" });
  assert.deepEqual(cacheTypeIdentity("Groundspeak HQ Cache"), { id: "3773", label: "Geocaching HQ Cache" });
});

test("maps GSAK short display names to the same canonical ids", () => {
  // GSAK's g_CacheType() stores short names ("Mystery") where GPX stores
  // full names ("Unknown Cache"). Both must resolve identically.
  assert.deepEqual(cacheTypeIdentity("Mystery"), { id: "8", label: "Mystery Cache" });
  assert.deepEqual(cacheTypeIdentity("Unknown"), { id: "8", label: "Mystery Cache" });
  assert.deepEqual(cacheTypeIdentity("Earth"), { id: "137", label: "EarthCache" });
  assert.deepEqual(cacheTypeIdentity("L&F Event"), { id: "3653", label: "Community Celebration Event" });
  assert.deepEqual(cacheTypeIdentity("Groundspeak HQ"), { id: "3773", label: "Geocaching HQ Cache" });
  assert.deepEqual(cacheTypeIdentity("L&F Celebration"), { id: "3774", label: "Geocaching HQ Celebration" });
});

test("canonicalCacheTypeName collapses source spellings to one stored name", () => {
  assert.equal(canonicalCacheTypeName("Mystery"), "Mystery Cache");
  assert.equal(canonicalCacheTypeName("Unknown Cache"), "Mystery Cache");
  assert.equal(canonicalCacheTypeName("Mystery Cache"), "Mystery Cache");
  assert.equal(canonicalCacheTypeName("Earth"), "EarthCache");
  assert.equal(canonicalCacheTypeName("Traditional Cache"), "Traditional Cache");
  assert.equal(canonicalCacheTypeName(null), null);
  assert.equal(canonicalCacheTypeName("  "), null);
});

test("canonicalCacheTypeName preserves unknown types instead of dropping them", () => {
  assert.equal(canonicalCacheTypeName("Partner Cache"), "Partner Cache");
});

test("options mark GSAK short names as imported canonical types, not customs", () => {
  const options = cacheTypeOptions(["Mystery"]);
  assert.equal(options.find((option) => option.id === "8")?.imported, true);
  assert.equal(options.some((option) => option.id === "custom:mystery"), false);
});
