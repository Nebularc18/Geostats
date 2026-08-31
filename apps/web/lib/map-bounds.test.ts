import assert from "node:assert/strict";
import test from "node:test";
import { boundsFor } from "./map-bounds.ts";

test("computes bounds for large point sets without spreading coordinates", () => {
  const points = Array.from({ length: 100_000 }, (_, index) => ({
    latitude: (index % 181) - 90,
    longitude: (index % 361) - 180
  }));

  assert.deepEqual(boundsFor(points), [
    [-180, -90],
    [180, 90]
  ]);
});

test("ignores invalid coordinates when computing bounds", () => {
  assert.deepEqual(
    boundsFor([
      { latitude: Number.NaN, longitude: 15 },
      { latitude: 56, longitude: 15 }
    ]),
    [
      [15, 56],
      [15, 56]
    ]
  );
  assert.equal(boundsFor([{ latitude: 91, longitude: 15 }]), null);
});
