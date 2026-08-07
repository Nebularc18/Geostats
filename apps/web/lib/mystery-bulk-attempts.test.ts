import assert from "node:assert/strict";
import test from "node:test";
import { parseBulkFailedAttempts } from "./mystery-bulk-attempts.ts";

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
