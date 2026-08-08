import assert from "node:assert/strict";
import test from "node:test";
import { parseBulkFailedAttempts, parseFailedCoordinateCsv } from "./mystery-bulk-attempts.ts";

test("bulk failed tries recognize coordinates, keywords and approaches", () => {
  const result = parseBulkFailedAttempts(`
59.40582, 18.36120
keyword: BLUEBIRD
approach: Read the first letter of every line
plain answer
  `);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.attempts, [
    { kind: "coordinate", latitude: 59.40582, longitude: 18.3612 },
    { kind: "keyword", answer: "BLUEBIRD" },
    { kind: "approach", answer: "Read the first letter of every line" },
    { kind: "keyword", answer: "plain answer" }
  ]);
});

test("bulk failed tries deduplicate case-insensitively and report explicit bad coordinates", () => {
  const result = parseBulkFailedAttempts("keyword: Answer\nkw: answer\ncoord: nowhere");

  assert.deepEqual(result.attempts, [{ kind: "keyword", answer: "Answer" }]);
  assert.deepEqual(result.errors, ["Line 3: invalid coordinate"]);
});

test("coordinate CSV import reads latitude and longitude columns and ignores other data", () => {
  const result = parseFailedCoordinateCsv(`GC Code,Name,Latitude,Longitude,Notes
GC12345,First,59.40582,18.36120,wrong checker result
GC54321,Second,not-a-coordinate,ignored,anything
GC99999,Duplicate,59.405820,18.361200,duplicate`);

  assert.deepEqual(result.attempts, [
    { kind: "coordinate", latitude: 59.40582, longitude: 18.3612 }
  ]);
  assert.equal(result.ignoredRows, 1);
});

test("coordinate CSV import supports a quoted coordinates column", () => {
  const result = parseFailedCoordinateCsv(`name,coordinates,status
One,"N 59° 24.349' E 018° 21.672'",failed`);

  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].kind, "coordinate");
  assert.ok(Math.abs((result.attempts[0] as { latitude: number }).latitude - 59.4058167) < 0.000001);
  assert.equal(result.ignoredRows, 0);
});

test("coordinate CSV import preserves decimal commas in semicolon-delimited files", () => {
  const result = parseFailedCoordinateCsv(`Name;Latitude;Longitude;Notes
First;59,40582;18,36120;failed
Second;60,12345;19,54321;also failed`);

  assert.deepEqual(result.attempts, [
    { kind: "coordinate", latitude: 59.40582, longitude: 18.3612 },
    { kind: "coordinate", latitude: 60.12345, longitude: 19.54321 }
  ]);
  assert.equal(result.ignoredRows, 0);
});

test("coordinate CSV import normalizes decimal commas in a combined coordinates column", () => {
  const result = parseFailedCoordinateCsv(`Name;Coordinates;Notes
First;59,40582 18,36120;failed`);

  assert.deepEqual(result.attempts, [
    { kind: "coordinate", latitude: 59.40582, longitude: 18.3612 }
  ]);
  assert.equal(result.ignoredRows, 0);
});
