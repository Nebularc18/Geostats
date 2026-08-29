import assert from "node:assert/strict";
import test from "node:test";
import { cacheTypeIdentity, cacheTypeOptions } from "./cache-type-catalog";

test("maps source-specific names to stable Geocaching type ids", () => {
  assert.deepEqual(cacheTypeIdentity("Unknown Cache"), { id: "8", label: "Mystery Cache" });
  assert.deepEqual(cacheTypeIdentity("Earth Cache"), { id: "137", label: "EarthCache" });
  assert.deepEqual(cacheTypeIdentity("Groundspeak HQ Cache"), { id: "3773", label: "Geocaching HQ Cache" });
});

test("returns the full canonical catalog and preserves imported custom types", () => {
  const options = cacheTypeOptions(["Unknown (Mystery) Cache", "Partner Cache"]);
  assert.equal(options.filter((option) => !option.id.startsWith("custom:")).length, 19);
  assert.equal(options.find((option) => option.id === "8")?.imported, true);
  assert.deepEqual(options.find((option) => option.label === "Partner Cache"), {
    id: "custom:partner cache",
    label: "Partner Cache",
    aliases: [],
    imported: true
  });
});
