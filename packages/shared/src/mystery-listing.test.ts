import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMysteryListing } from "./mystery-listing";

test("moves legacy descriptions and image links without moving saved clues or hints", () => {
  const clues = ["Listing hint:\nPå armlängds avstånd", "Count the hats", "Puzzle listing: a note I typed", "Puzzle images:\nCount the red dots"];
  const image = "https://img.geocaching.com/puzzle.jpg";
  const normalized = normalizeMysteryListing({ clues: [
    ...clues,
    "Short description:\nThe circus comes to town.",
    "Puzzle listing:\nCount the hats.\nThen count the rabbits.",
    `Puzzle images:\n${image}`
  ], listingImageUrls: [image, "javascript:bad()"] });
  assert.deepEqual(normalized, { listingText: "The circus comes to town.\n\nCount the hats.\nThen count the rabbits.", listingImageUrls: [image], clues });
  assert.deepEqual(normalizeMysteryListing(normalized), normalized);
});

test("avoids repeating a legacy short description when the GPX already includes it", () => {
  const normalized = normalizeMysteryListing({ clues: ["Short description:\nIntro", "Puzzle listing:\nIntro\n\nStory"] });
  assert.equal(normalized.listingText, "Intro\n\nStory");
});

test("does not reinterpret saved excerpts once the listing has its own field", () => {
  const clues = ["Puzzle listing:\nChapter 2"];
  assert.deepEqual(normalizeMysteryListing({ listingText: "Source", clues }).clues, clues);
});
