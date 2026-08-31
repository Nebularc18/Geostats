import assert from "node:assert/strict";
import test from "node:test";
import { comparisonBucketRows, comparisonCountries, readSavedFriends } from "./friend-comparison.ts";

test("builds side-by-side bucket rows", () => {
  assert.deepEqual(
    comparisonBucketRows(
      [
        { key: "Traditional", count: 10 },
        { key: "Mystery", count: 2 }
      ],
      [
        { key: "Traditional", count: 4 },
        { key: "Multi", count: 5 }
      ]
    ),
    [
      { key: "Traditional", you: 10, friend: 4 },
      { key: "Multi", you: 0, friend: 5 },
      { key: "Mystery", you: 2, friend: 0 }
    ]
  );
});

test("separates shared and unique countries", () => {
  assert.deepEqual(
    comparisonCountries(
      [
        { key: "Sweden", count: 10 },
        { key: "Norway", count: 2 }
      ],
      [
        { key: "Sweden", count: 5 },
        { key: "Denmark", count: 3 }
      ]
    ),
    { shared: ["Sweden"], onlyYou: ["Norway"], onlyFriend: ["Denmark"] }
  );
});

test("reads a bounded, unique saved-friend list", () => {
  assert.deepEqual(readSavedFriends('[" Alice ","Bob","Alice",3]'), ["Alice", "Bob"]);
  assert.deepEqual(readSavedFriends("not json"), []);
});
