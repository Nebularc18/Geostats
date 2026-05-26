import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { ImportSource } from "@geostats/shared";
import { detectFtfLog, parseGpx, parseImportFile } from "./index";

const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0">
  <wpt lat="56.161200" lon="15.586900">
    <time>2020-01-01T00:00:00Z</time>
    <name>GC12345</name>
    <groundspeak:cache>
      <groundspeak:name>Harbor Cache</groundspeak:name>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Regular</groundspeak:container>
      <groundspeak:difficulty>2</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
      <groundspeak:country>Sweden</groundspeak:country>
      <groundspeak:state>Blekinge</groundspeak:state>
      <groundspeak:owner>Cache Owner</groundspeak:owner>
      <groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2024-05-01T12:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:text>Nice find.</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>
  </wpt>
</gpx>`;

test("parseGpx extracts caches and found logs", () => {
  const parsed = parseGpx(gpx, ImportSource.MY_FINDS_GPX);

  assert.equal(parsed.caches.length, 1);
  assert.equal(parsed.finds.length, 1);
  assert.equal(parsed.caches[0]?.gcCode, "GC12345");
  assert.equal(parsed.caches[0]?.country, "Sweden");
  assert.equal(parsed.finds[0]?.foundAt?.toISOString(), "2024-05-01T12:00:00.000Z");
});

test("detectFtfLog marks FTF logs from user log text", () => {
  const parsed = parseGpx(gpx.replace("Nice find.", "FTF at 08:14, great cache."), ImportSource.MY_FINDS_GPX);

  assert.equal(detectFtfLog(parsed.finds[0]?.logText ?? null), true);
});

test("detectFtfLog supports custom user search terms", () => {
  assert.equal(detectFtfLog("Silver medal on this one.", ["silver medal"]), true);
  assert.equal(detectFtfLog("TFTC on the way home.", ["FTF"]), false);
});

test("parseGpx accepts large My Finds files with many escaped entities", () => {
  const manyEntities = Array.from({ length: 1500 }, () => "TFTC &amp; nice cache").join(" ");
  const largeGpx = gpx.replace("Nice find.", manyEntities);

  const parsed = parseGpx(largeGpx, ImportSource.MY_FINDS_GPX);

  assert.equal(parsed.finds.length, 1);
  assert.match(parsed.finds[0]?.logText ?? "", /TFTC & nice cache/);
});

test("parseImportFile reads GPX files from a ZIP", async () => {
  const zip = new JSZip();
  zip.file("pocket-query.gpx", gpx);
  const content = await zip.generateAsync({ type: "nodebuffer" });

  const parsed = await parseImportFile("query.zip", content, ImportSource.POCKET_QUERY);

  assert.equal(parsed.caches.length, 1);
  assert.equal(parsed.caches[0]?.name, "Harbor Cache");
});

test("parseImportFile rejects ZIP files without GPX entries", async () => {
  const zip = new JSZip();
  zip.file("notes.txt", "nothing useful");
  const content = await zip.generateAsync({ type: "nodebuffer" });

  await assert.rejects(() => parseImportFile("empty.zip", content, ImportSource.POCKET_QUERY), /did not contain/);
});

test("parseImportFile rejects ZIP files with too many GPX entries", async () => {
  const previous = process.env.IMPORT_MAX_ZIP_ENTRIES;
  process.env.IMPORT_MAX_ZIP_ENTRIES = "1";
  try {
    const zip = new JSZip();
    zip.file("one.gpx", gpx);
    zip.file("two.gpx", gpx);
    const content = await zip.generateAsync({ type: "nodebuffer" });

    await assert.rejects(() => parseImportFile("query.zip", content, ImportSource.POCKET_QUERY), /more than 1/);
  } finally {
    if (previous === undefined) {
      delete process.env.IMPORT_MAX_ZIP_ENTRIES;
    } else {
      process.env.IMPORT_MAX_ZIP_ENTRIES = previous;
    }
  }
});

test("parseImportFile rejects oversized ZIP GPX entries", async () => {
  const previous = process.env.IMPORT_MAX_ZIP_ENTRY_BYTES;
  process.env.IMPORT_MAX_ZIP_ENTRY_BYTES = "20";
  try {
    const zip = new JSZip();
    zip.file("pocket-query.gpx", gpx);
    const content = await zip.generateAsync({ type: "nodebuffer" });

    await assert.rejects(() => parseImportFile("query.zip", content, ImportSource.POCKET_QUERY), /exceeds 20/);
  } finally {
    if (previous === undefined) {
      delete process.env.IMPORT_MAX_ZIP_ENTRY_BYTES;
    } else {
      process.env.IMPORT_MAX_ZIP_ENTRY_BYTES = previous;
    }
  }
});
