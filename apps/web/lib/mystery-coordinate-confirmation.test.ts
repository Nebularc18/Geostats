import assert from "node:assert/strict";
import test from "node:test";
import { cachePageShowsCoordinate } from "./mystery-coordinate-confirmation.ts";

function coordinatePageFixture(selector: string, textContent: string) {
  const coordinateNode = { textContent };
  const document = {
    querySelector(candidate: string) {
      return candidate === selector ? coordinateNode : null;
    }
  };
  return { coordinateNode, document };
}

test("confirms a manual save after Geocaching updates the legacy coordinate DOM", () => {
  const expected = { latitude: 59.40582, longitude: 18.3612 };
  const { coordinateNode, document } = coordinatePageFixture("#uxLatLon", "N 59° 20.000' E 018° 04.000'");

  assert.equal(cachePageShowsCoordinate(document, expected), false);

  coordinateNode.textContent = "N 59° 24.349' E 018° 21.672'";

  assert.equal(cachePageShowsCoordinate(document, expected), true);
});

test("confirms a manual save after Geocaching updates the current coordinate DOM", () => {
  const expected = { latitude: -33.86514, longitude: 151.2099 };
  const { coordinateNode, document } = coordinatePageFixture("[data-testid='coordinates']", "-33.86000, 151.20000");

  assert.equal(cachePageShowsCoordinate(document, expected), false);

  coordinateNode.textContent = "-33.86514, 151.20990";

  assert.equal(cachePageShowsCoordinate(document, expected), true);
});
