import assert from "node:assert/strict";
import test from "node:test";
import {
  areaFromCachePageMetadata,
  locationFromCachePageMetadata,
  normalizeMysteryArea
} from "./mystery-area.ts";

test("reads the cache area from legacy Geocaching description metadata", () => {
  assert.equal(
    areaFromCachePageMetadata(
      "GC2264 E55:an (Strängnäs) (Traditional Cache) in Södermanland, Sweden created by IT-gubben",
      "E55:an (GC2264) was created by IT-gubben. It's located in Södermanland, Sweden.Old defense fortress."
    ),
    "Södermanland"
  );
});

test("falls back to the legacy Geocaching page title", () => {
  assert.equal(
    areaFromCachePageMetadata(
      "GC75P53 NKG #034 (Unknown Cache) in Östergötland, Sweden created by spårsyskonen",
      ""
    ),
    "Östergötland"
  );
});

test("reads both county and country from Geocaching metadata", () => {
  assert.deepEqual(
    locationFromCachePageMetadata(
      "GC75P53 NKG #034 (Unknown Cache) in Östergötland, Sweden created by spårsyskonen",
      ""
    ),
    { county: "Östergötland", country: "Sweden" }
  );
});

test("does not mistake legacy owner metadata for a cache area", () => {
  assert.equal(normalizeMysteryArea("A cache by Example Owner Message this owner"), "");
});
