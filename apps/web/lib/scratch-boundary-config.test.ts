import assert from "node:assert/strict";
import test from "node:test";

import { countryFlagCodeFromProperties } from "./scratch-boundary-config.ts";

test("corrects every country with a missing or non-standard flag code", () => {
  assert.equal(countryFlagCodeFromProperties("France", { "ISO3166-1-Alpha-2": "-99" }), "fr");
  assert.equal(countryFlagCodeFromProperties("Kosovo", { "ISO3166-1-Alpha-2": "-99" }), "xk");
  assert.equal(countryFlagCodeFromProperties(" norway ", { "ISO3166-1-Alpha-2": "-99" }), "no");
  assert.equal(countryFlagCodeFromProperties("Taiwan", { "ISO3166-1-Alpha-2": "CN-TW" }), "tw");
});

test("accepts standard ISO alpha-2 codes and rejects invalid flag paths", () => {
  assert.equal(countryFlagCodeFromProperties("Sweden", { "ISO3166-1-Alpha-2": "SE" }), "se");
  assert.equal(countryFlagCodeFromProperties("Unmapped territory", { "ISO3166-1-Alpha-2": "-99" }), null);
  assert.equal(countryFlagCodeFromProperties("Missing code", {}), null);
});
