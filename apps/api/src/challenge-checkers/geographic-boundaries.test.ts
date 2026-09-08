import assert from "node:assert/strict";
import test from "node:test";
import { GeographicBoundariesService, pointInBoundary } from "./geographic-boundaries";

const square = { type: "Polygon" as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as [number, number][]] };

test("matches coordinates inside polygon boundaries", () => {
  assert.equal(pointInBoundary([5, 5], square), true);
  assert.equal(pointInBoundary([15, 5], square), false);
});

test("supports multipolygon administrative areas", () => {
  assert.equal(pointInBoundary([25, 25], { type: "MultiPolygon", coordinates: [square.coordinates, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]] as [number, number][][]] }), true);
});

test("cleans source-specific country-code suffixes from administrative names", () => {
  const boundaries = new GeographicBoundariesService() as unknown as { name(feature: unknown): string };
  assert.equal(boundaries.name({ properties: { shapeName: '"Evje og Hornnes" nor', shapeGroup: "NOR" } }), "Evje og Hornnes");
  assert.equal(boundaries.name({ properties: { shapeName: "Capital Region isl", shapeGroup: "ISL" } }), "Capital Region");
});

test("resolves Swedish municipalities through the detailed national dataset", async () => {
  const regions = { features: [{ properties: { name: "Blekinge", l_id: 10 }, geometry: square }] };
  const counties = {
    features: [
      { properties: { kom_namn: "Karlskrona", lan_code: "10" }, geometry: square },
      { properties: { kom_namn: "Lund", lan_code: "12" }, geometry: square }
    ]
  };
  const fetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => ({
    ok: true,
    json: async () => String(url).includes("municipalities") ? counties : regions
  })) as typeof fetch;
  try {
    const boundaries = new GeographicBoundariesService();
    assert.deepEqual(await boundaries.regions("Sweden"), ["Blekinge"]);
    assert.deepEqual(await boundaries.counties("Sweden", "Blekinge län"), ["Karlskrona"]);
    assert.deepEqual(await boundaries.geometry("Sweden", "county", "Karlskrona", "Blekinge län"), square);
    assert.equal(await boundaries.geometry("Sweden", "region", "Blekinge"), square);
  } finally {
    globalThis.fetch = fetch;
  }
});
