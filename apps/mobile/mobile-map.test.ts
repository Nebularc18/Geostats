import assert from "node:assert/strict";
import test from "node:test";
import { hasNativeMapSupport, scratchMapGeometryBudget, SCRATCH_WORLD_REGION, selectNativeMapPoints } from "./mobile-map";

test("Scratch Map's world camera stays inside Google Maps latitude bounds", () => {
  const south = SCRATCH_WORLD_REGION.latitude - SCRATCH_WORLD_REGION.latitudeDelta / 2;
  const north = SCRATCH_WORLD_REGION.latitude + SCRATCH_WORLD_REGION.latitudeDelta / 2;

  assert.ok(south >= -90);
  assert.ok(north <= 90);
  assert.ok(SCRATCH_WORLD_REGION.longitudeDelta < 360);
});

test("Android maps require a configured Google Maps API key", () => {
  assert.equal(hasNativeMapSupport("android"), false);
  assert.equal(hasNativeMapSupport("android", "   "), false);
  assert.equal(hasNativeMapSupport("android", "configured-key"), true);
  assert.equal(hasNativeMapSupport("ios"), true);
});

test("combined maps retain own hides when finds exceed the marker limit", () => {
  const finds = Array.from({ length: 750 }, (_, id) => ({ id: `find-${id}`, isOwnHide: false }));
  const hides = Array.from({ length: 5 }, (_, id) => ({ id: `hide-${id}`, isOwnHide: true }));

  const selected = selectNativeMapPoints([...finds, ...hides], 500);

  assert.equal(selected.length, 500);
  assert.ok(selected.some((point) => point.isOwnHide));
  assert.ok(selected.some((point) => !point.isOwnHide));
});

test("single-kind maps use the complete marker budget", () => {
  const hides = Array.from({ length: 600 }, (_, id) => ({ id, isOwnHide: true }));
  const selected = selectNativeMapPoints(hides, 500);

  assert.equal(selected.length, 500);
  assert.ok(selected.every((point) => point.isOwnHide));
});

test("maps below the marker limit preserve their original points", () => {
  const points = [{ id: 1, isOwnHide: false }, { id: 2, isOwnHide: true }];
  assert.equal(selectNativeMapPoints(points, 500), points);
});

test("Android country and county layers can retain their complete feature sets", () => {
  const countries = scratchMapGeometryBudget("countries", "android");
  const counties = scratchMapGeometryBudget("counties", "android");

  assert.ok(countries.maxPolygons >= 360);
  assert.ok(counties.maxPolygons >= 290);
  assert.ok(countries.maxPolygons * countries.maxPointsPerRing <= countries.maxVertices);
  assert.ok(counties.maxPolygons * counties.maxPointsPerRing <= counties.maxVertices);
  assert.ok(countries.maxHighlightedPointsPerRing >= 900);
  assert.ok(countries.maxPointsPerRing >= 140);
  assert.ok(countries.maxHighlightedPointsPerRing > countries.maxPointsPerRing * 6);
});

test("dense detail layers retain their lower hard vertex ceiling", () => {
  assert.ok(scratchMapGeometryBudget("regions", "android").maxVertices < scratchMapGeometryBudget("countries", "android").maxVertices);
  assert.equal(scratchMapGeometryBudget("counties", "android").maxVertices, 12_000);
});
