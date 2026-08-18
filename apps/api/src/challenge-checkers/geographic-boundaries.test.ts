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
