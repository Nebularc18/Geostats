import assert from "node:assert/strict";
import test from "node:test";
import { browserCapturedMystery, mysteryAiPrompt, mysteryCodeFromText, parseMysteryGpx, selectMysteryImports } from "./mystery-tools";

const waypoint = (code = "GC123", type = "Unknown Cache", lat = "59.123") => `<wpt lat="${lat}" lon="18.456"><name>${code}</name><desc>Fallback</desc><groundspeak:cache><groundspeak:name>Puzzle &amp; name</groundspeak:name><groundspeak:type>${type}</groundspeak:type><groundspeak:country>Sweden</groundspeak:country><groundspeak:state>Stockholm</groundspeak:state><groundspeak:long_description><![CDATA[<p>Find the number</p><p>Then decode it.</p>]]></groundspeak:long_description><groundspeak:encoded_hints>Look up</groundspeak:encoded_hints></groundspeak:cache></wpt>`;
const gpx = (points: string) => `<gpx xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1">${points}</gpx>`;

test("imports namespaced mysteries with puzzle text and hints", () => {
  const result = parseMysteryGpx(gpx(waypoint()));
  assert.equal(result.skipped, 0);
  assert.equal(result.mysteries[0].gcCode, "GC123");
  assert.equal(result.mysteries[0].name, "Puzzle & name");
  assert.equal(result.mysteries[0].publishedLatitude, 59.123);
  assert.equal(result.mysteries[0].country, "Sweden");
  assert.equal(result.mysteries[0].listingText, "Find the number\nThen decode it.");
  assert.deepEqual(result.mysteries[0].clues, ["Listing hint:\nLook up"]);
});

test("skips other types, duplicates, and invalid coordinates", () => {
  const result = parseMysteryGpx(gpx(waypoint() + waypoint() + waypoint("GC456", "Traditional Cache") + waypoint("GC789", "Unknown Cache", "91") + waypoint("GC999", "Unknown Cache", "")));
  assert.equal(result.mysteries.length, 1);
  assert.equal(result.skipped, 4);
});

test("accepts simple mystery GPX without Groundspeak extensions", () => {
  assert.equal(parseMysteryGpx('<gpx><wpt lat="0" lon="0"><name>GC123</name><desc>Simple puzzle</desc><type>Geocache|Unknown Cache</type></wpt></gpx>').mysteries[0].name, "Simple puzzle");
});

test("rejects malformed XML, non-GPX files, DTDs, and oversized input", () => {
  for (const value of ["not xml", "<gpx><wpt></gpx>", "<html/>", '<!DOCTYPE gpx [<!ENTITY x "hello">]><gpx/>', " ".repeat(10 * 1024 * 1024 + 1)]) {
    assert.throws(() => parseMysteryGpx(value));
  }
});

test("AI copy preserves failed, successful, keyword, and unknown attempts with notes", () => {
  const prompt = mysteryAiPrompt({ gcCode: "GC123", name: "Puzzle", publishedLatitude: 0, publishedLongitude: 0, notes: "Use a cipher", fieldNotes: "Bring a torch", listingText: "Puzzle text", clues: ["Saved excerpt"], attempts: [
    { latitude: 1, longitude: 2, state: "wrong" },
    { kind: "keyword", answer: "answer", state: "correct", finalLatitude: 3, finalLongitude: 4 },
    { answer: "maybe", state: "unchecked" },
    { answer: "next", state: "planned", note: "Test later" }
  ] });
  for (const fragment of ["https://coord.info/GC123", "DIDN'T WORK: 1.00000, 2.00000", "WORKED: answer", "revealed final: 3.00000, 4.00000", "RESULT UNKNOWN: maybe", "NOT TRIED YET: next; Test later", "Use a cipher", "Bring a torch", "Puzzle text"]) assert.ok(prompt.includes(fragment), fragment);
  assert.match(prompt, /LISTING\nPuzzle text\n\nCLUES\nSaved excerpt/);
});

test("AI copy explains missing listing text and images", () => {
  const prompt = mysteryAiPrompt({ gcCode: "GC1", name: "Empty", publishedLatitude: 0, publishedLongitude: 0, notes: "", clues: [], attempts: [] });
  assert.match(prompt, /listing is not included/);
  assert.match(prompt, /None yet/);
  assert.match(prompt, /attach them/);
});

test("extracts codes from official cache links and Geocaching share text", () => {
  for (const value of [" gc12345 ", "https://coord.info/GC12345", "https://www.geocaching.com/geocache/GC12345_puzzle", "Check out this cache! https://coord.info/GC12345.", "https://www.geocaching.com/seek/cache_details.aspx?wp=GC12345", "https://www.geocaching.com/geocache/GC12345?foo=1"]) {
    assert.equal(mysteryCodeFromText(value), "GC12345", value);
  }
});

test("rejects unrelated links, misleading hosts, incomplete codes, and private app URLs", () => {
  for (const value of ["", "GC", "something GC12345 something", "https://example.com/GC12345", "https://geocaching.com.evil.test/geocache/GC12345", "https://coord.info.evil.test/GC12345", "https://coord.info/GC12345/other", "file:///GC12345", "https://www.geocaching.com/geocache/not-a-cache"]) {
    assert.equal(mysteryCodeFromText(value), null, value);
  }
});

test("browser captures are bound to the requested cache and cannot set sharing or solution fields", () => {
  const value = { gcCode: "GC12345", name: "Puzzle", latitude: 59, longitude: 18, listingText: "Puzzle text", clues: ["Listing hint:\nLook up"], listingImageUrls: ["https://img.geocaching.com/puzzle.jpg", "javascript:bad()"], sharedBy: { id: "other" }, notes: "Not imported", attempts: [{ state: "correct" }] };
  const result = browserCapturedMystery(value, "GC12345")!;
  assert.equal(result.publishedLatitude, 59);
  assert.equal(result.listingText, "Puzzle text");
  assert.deepEqual(result.clues, ["Listing hint:\nLook up"]);
  assert.deepEqual(result.listingImageUrls, ["https://img.geocaching.com/puzzle.jpg"]);
  assert.equal("sharedBy" in result, false);
  assert.equal("notes" in result, false);
  assert.equal("attempts" in result, false);
  assert.equal(browserCapturedMystery(value, "GC999"), null);
  assert.equal(browserCapturedMystery({ ...value, latitude: NaN }, "GC12345"), null);
});

test("nested GPX extensions retain mystery type, description, and hints", () => {
  const xml = gpx(waypoint().replace("<groundspeak:cache>", "<extensions><groundspeak:cache>").replace("</groundspeak:cache>", "</groundspeak:cache></extensions>"));
  const result = parseMysteryGpx(xml);
  assert.equal(result.mysteries.length, 1);
  assert.equal(result.mysteries[0].listingComplete, true);
  assert.match(result.mysteries[0].listingText ?? "", /Find the number/);
  assert.match(result.mysteries[0].clues.join("\n"), /Look up/);
});

test("import planning waits for account load and preserves existing cache records", () => {
  const saved = { gcCode: "GC12345", notes: "Saved solution", sharedBy: undefined };
  const incoming = [{ gcCode: "gc12345", notes: "", sharedBy: undefined }, { gcCode: "GC999", notes: "", sharedBy: undefined }];
  assert.throws(() => selectMysteryImports([saved], incoming, false), /finish loading/);
  const result = selectMysteryImports([saved], incoming, true);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.added.map((cache) => cache.gcCode), ["GC999"]);
  assert.equal(saved.notes, "Saved solution");
});

test("import planning respects remaining owned workspace capacity without counting received shares", () => {
  const existing = Array.from({ length: 499 }, (_, index) => ({ gcCode: `GC${index}`, sharedBy: undefined as unknown }));
  existing.push({ gcCode: "GCSHARED", sharedBy: { id: "owner" } });
  const result = selectMysteryImports(existing, [{ gcCode: "GCNEW1" }, { gcCode: "GCNEW2" }], true);
  assert.equal(result.added.length, 1);
  assert.equal(result.excess, 1);
  const full = selectMysteryImports([...existing, ...result.added], [{ gcCode: "GCNEW2" }], true);
  assert.equal(full.added.length, 0);
  assert.equal(full.excess, 1);
});
