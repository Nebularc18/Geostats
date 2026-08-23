import assert from "node:assert/strict";
import test from "node:test";
import { placeSuggestionsFromPhoton } from "./place-suggestions";

test("turns Photon features into distinct readable place suggestions", () => {
  const suggestions = placeSuggestionsFromPhoton({
    features: [
      {
        geometry: { coordinates: [15.5866, 56.1612] },
        properties: { name: "Karlskrona", type: "city", county: "Blekinge County", country: "Sweden" }
      },
      {
        geometry: { coordinates: [15.5866, 56.1612] },
        properties: { name: "Karlskrona", type: "city", county: "Blekinge County", country: "Sweden" }
      }
    ]
  });
  assert.deepEqual(suggestions, [{
    label: "Karlskrona, Blekinge County, Sweden",
    latitude: 56.1612,
    longitude: 15.5866,
    kind: "city"
  }]);
});

test("ignores malformed Photon features", () => {
  assert.deepEqual(placeSuggestionsFromPhoton({ features: [{ properties: { name: "Missing coordinates" } }] }), []);
  assert.deepEqual(placeSuggestionsFromPhoton(null), []);
});
