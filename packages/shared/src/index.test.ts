import assert from "node:assert/strict";
import test from "node:test";
import { parseCoordinate } from "./index";

function assertCoordinates(value: string, latitude: number, longitude: number) {
  const parsed = parseCoordinate(value);
  assert.ok(parsed);
  assert.ok(Math.abs(parsed.latitude - latitude) < 0.0000001);
  assert.ok(Math.abs(parsed.longitude - longitude) < 0.0000001);
}

test("parses geocaching coordinates with a Unicode prime", () => {
  assertCoordinates("N 59° 55.881′ E 016° 34.374′", 59.93135, 16.5729);
});

test("parses geocaching coordinates with straight or curly apostrophes", () => {
  assertCoordinates("N 59° 55.881' E 016° 34.374'", 59.93135, 16.5729);
  assertCoordinates("N 59° 55.881’ E 016° 34.374’", 59.93135, 16.5729);
});

test("parses geocaching coordinates without degree and minute symbols", () => {
  assertCoordinates("N 59 56.493 E 016 35.068", 59.94155, 16.584466666666667);
  assertCoordinates("S 59 56.493 W 016 35.068", -59.94155, -16.584466666666667);
});

test("continues to parse decimal coordinates", () => {
  assert.deepEqual(parseCoordinate("59.93135, 16.57290"), {
    latitude: 59.93135,
    longitude: 16.5729
  });
});

test("rejects out-of-range degrees and minutes", () => {
  assert.equal(parseCoordinate("N 59° 60.000′ E 016° 34.374′"), null);
  assert.equal(parseCoordinate("N 59 60.000 E 016 34.374"), null);
  assert.equal(parseCoordinate("N 91° 00.000′ E 016° 34.374′"), null);
  assert.equal(parseCoordinate("N 59° 55.881′ E 181° 00.000′"), null);
});
