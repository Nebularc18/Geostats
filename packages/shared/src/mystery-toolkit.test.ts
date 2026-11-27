import test from "node:test";
import assert from "node:assert/strict";
import {
  a1z26Decode,
  a1z26Encode,
  atbash,
  base64Decode,
  base64Encode,
  caesarShift,
  formatCoordinateDd,
  formatCoordinateDdm,
  formatCoordinateDms,
  morseDecode,
  morseEncode,
  parseAnyCoordinate,
  projectCoordinate,
  reverseText,
  rot13
} from "./mystery-toolkit";

test("cipher helpers encode and decode accurately", () => {
  assert.equal(rot13("Under the bridge"), "Haqre gur oevqtr");
  assert.equal(rot13(rot13("N 56 10.123")), "N 56 10.123");
  assert.equal(caesarShift("ABC", 3), "DEF");
  assert.equal(atbash("ABC XYZ"), "ZYX CBA");
  assert.equal(reverseText("GC12345"), "54321CG");

  const a1 = a1z26Encode("CACHE");
  assert.equal(a1.encoded, "3-1-3-8-5");
  assert.equal(a1.wordValue, 20);
  assert.equal(a1.digitalRoot, 2);
  assert.equal(a1z26Decode("3-1-3-8-5"), "CACHE");

  assert.equal(morseEncode("SOS 1"), "... --- ... / .----");
  assert.equal(morseDecode("... --- ... / .----"), "SOS 1");

  const encoded = base64Encode("N 56° 10.500");
  assert.equal(base64Decode(encoded), "N 56° 10.500");
});

test("coordinate parsing, formatting, and projection work across formats", () => {
  const fromDms = parseAnyCoordinate(`N 56° 10' 30.0" E 015° 35' 15.0"`);
  assert.ok(fromDms);
  assert.ok(Math.abs(fromDms.latitude - 56.175) < 1e-6);
  assert.ok(Math.abs(fromDms.longitude - 15.5875) < 1e-6);

  assert.equal(formatCoordinateDdm(56.175, 15.5875), "N 56° 10.500 E 015° 35.250");
  assert.equal(formatCoordinateDms(56.175, 15.5875), `N 56° 10' 30.0" E 015° 35' 15.0"`);
  assert.equal(formatCoordinateDd(56.175, 15.5875), "56.175000, 15.587500");

  const north = projectCoordinate(56.0, 15.0, 1000, 0, "m");
  assert.ok(north.latitude > 56.008 && north.latitude < 56.01);
  assert.ok(Math.abs(north.longitude - 15.0) < 1e-5);
});
