import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { ImportSource } from "@geostats/shared";
import { detectFtfLog, parseGpx, parseImportFile, parseTrackableCsv, parseTrackableImportFile } from "./index";

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

function patchZipUncompressedSizes(content: Buffer, size: number): Buffer {
  const patched = Buffer.from(content);
  for (let index = 0; index < patched.length - 4; index += 1) {
    const signature = patched.readUInt32LE(index);
    if (signature === 0x04034b50) {
      patched.writeUInt32LE(size, index + 22);
    }
    if (signature === 0x02014b50) {
      patched.writeUInt32LE(size, index + 24);
    }
  }
  return patched;
}

const cgeoGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.0" creator="c:geo" xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1" xmlns:gsak="http://www.gsak.net/xmlv1/6">
  <wpt lat="56.1943" lon="15.592383">
    <time>2004-03-14T00:00:00Z</time>
    <name>GCHXYE</name>
    <desc>Vastra Mark</desc>
    <type>Geocache|Traditional Cache</type>
    <groundspeak:cache>
      <groundspeak:name>Vastra Mark</groundspeak:name>
      <groundspeak:placed_by>Darnell_SE</groundspeak:placed_by>
      <groundspeak:owner>Darnell_SE</groundspeak:owner>
      <groundspeak:type>Traditional Cache</groundspeak:type>
      <groundspeak:container>Other</groundspeak:container>
      <groundspeak:difficulty>2.5</groundspeak:difficulty>
      <groundspeak:terrain>1.5</groundspeak:terrain>
      <groundspeak:country>Sweden</groundspeak:country>
      <groundspeak:state>Blekinge</groundspeak:state>
    </groundspeak:cache>
    <gsak:wptExtension>
      <gsak:UserFound>2026-05-09T01:00:00Z</gsak:UserFound>
    </gsak:wptExtension>
  </wpt>
  <wpt lat="56.7257" lon="16.374417">
    <name>01B4GAW</name>
    <desc>Parkering</desc>
    <type>Waypoint|Parking Area</type>
    <gsak:wptExtension>
      <gsak:Parent>GCB4GAW</gsak:Parent>
    </gsak:wptExtension>
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

test("parseGpx accepts c:geo found exports with gsak UserFound dates", () => {
  const parsed = parseGpx(cgeoGpx, ImportSource.MY_FINDS_GPX);

  assert.equal(parsed.caches.length, 1);
  assert.equal(parsed.finds.length, 1);
  assert.equal(parsed.caches[0]?.gcCode, "GCHXYE");
  assert.equal(parsed.caches[0]?.name, "Vastra Mark");
  assert.equal(parsed.finds[0]?.foundAt?.toISOString(), "2026-05-09T01:00:00.000Z");
});

test("parseGpx prefers the matching c:geo finder log over other public found logs", () => {
  const cgeoWithLogs = cgeoGpx.replace(
    "</groundspeak:cache>",
    `<groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2026-04-05T01:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>SomeoneElse</groundspeak:finder>
          <groundspeak:text>Different user's log.</groundspeak:text>
        </groundspeak:log>
        <groundspeak:log>
          <groundspeak:date>2026-05-09T01:23:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>Nebularc_</groundspeak:finder>
          <groundspeak:text>My c:geo log.</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>`
  );

  const parsed = parseGpx(cgeoWithLogs, ImportSource.MY_FINDS_GPX, { gcUsername: "Nebularc_" });

  assert.equal(parsed.finds[0]?.foundAt?.toISOString(), "2026-05-09T01:23:00.000Z");
  assert.equal(parsed.finds[0]?.logText, "My c:geo log.");
});

test("parseGpx uses c:geo UserFound instead of an unrelated public found log", () => {
  const cgeoWithOtherLog = cgeoGpx.replace(
    "</groundspeak:cache>",
    `<groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2026-04-05T01:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>SomeoneElse</groundspeak:finder>
          <groundspeak:text>Different user's log.</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>`
  );

  const parsed = parseGpx(cgeoWithOtherLog, ImportSource.MY_FINDS_GPX, { gcUsername: "Nebularc_" });

  assert.equal(parsed.finds[0]?.foundAt?.toISOString(), "2026-05-09T01:00:00.000Z");
  assert.equal(parsed.finds[0]?.logText, null);
});

test("parseGpx does not use unrelated log text when username is provided without UserFound", () => {
  const cgeoWithOnlyOtherLog = cgeoGpx
    .replace(/\s*<gsak:wptExtension>[\s\S]*?<\/gsak:wptExtension>/, "")
    .replace(
      "</groundspeak:cache>",
      `<groundspeak:logs>
        <groundspeak:log>
          <groundspeak:date>2026-04-05T01:00:00Z</groundspeak:date>
          <groundspeak:type>Found it</groundspeak:type>
          <groundspeak:finder>SomeoneElse</groundspeak:finder>
          <groundspeak:text>Different user's log.</groundspeak:text>
        </groundspeak:log>
      </groundspeak:logs>
    </groundspeak:cache>`
    );

  const parsed = parseGpx(cgeoWithOnlyOtherLog, ImportSource.MY_FINDS_GPX, { gcUsername: "Nebularc_" });

  assert.equal(parsed.finds[0]?.foundAt?.toISOString(), "2026-04-05T01:00:00.000Z");
  assert.equal(parsed.finds[0]?.logText, null);
});

test("parseImportFile reads GPX files from a ZIP", async () => {
  const zip = new JSZip();
  zip.file("pocket-query.gpx", gpx);
  const content = await zip.generateAsync({ type: "nodebuffer" });

  const parsed = await parseImportFile("query.zip", content, ImportSource.POCKET_QUERY);

  assert.equal(parsed.caches.length, 1);
  assert.equal(parsed.caches[0]?.name, "Harbor Cache");
});

test("Pocket Queries do not turn another geocacher's public log into the user's find", () => {
  const parsed = parseGpx(gpx, ImportSource.POCKET_QUERY, { gcUsername: "Nebularc_" });

  assert.equal(parsed.caches.length, 1);
  assert.equal(parsed.finds.length, 0);
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

test("parseImportFile counts unsupported ZIP entries toward the entry limit", async () => {
  const previous = process.env.IMPORT_MAX_ZIP_ENTRIES;
  process.env.IMPORT_MAX_ZIP_ENTRIES = "2";
  try {
    const zip = new JSZip();
    zip.file("pocket-query.gpx", gpx);
    zip.file("notes.txt", "ignored");
    zip.file("image.png", "ignored");
    const content = await zip.generateAsync({ type: "nodebuffer" });

    await assert.rejects(
      () => parseImportFile("query.zip", content, ImportSource.POCKET_QUERY),
      /more than 2 entries/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.IMPORT_MAX_ZIP_ENTRIES;
    } else {
      process.env.IMPORT_MAX_ZIP_ENTRIES = previous;
    }
  }
});

test("parseImportFile ignores unsupported ZIP entries within the entry limit", async () => {
  const zip = new JSZip();
  zip.file("pocket-query.gpx", gpx);
  zip.file("notes.txt", "ignored");

  const parsed = await parseImportFile(
    "query.zip",
    await zip.generateAsync({ type: "nodebuffer" }),
    ImportSource.POCKET_QUERY,
  );

  assert.equal(parsed.caches.length, 1);
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

test("parseImportFile aborts ZIP entries that inflate beyond the entry limit", async () => {
  const previous = process.env.IMPORT_MAX_ZIP_ENTRY_BYTES;
  process.env.IMPORT_MAX_ZIP_ENTRY_BYTES = "1024";
  try {
    const zip = new JSZip();
    zip.file("pocket-query.gpx", gpx.repeat(200));
    const content = patchZipUncompressedSizes(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), 1);

    await assert.rejects(() => parseImportFile("query.zip", content, ImportSource.POCKET_QUERY), /exceeds 1024|size mismatch/);
  } finally {
    if (previous === undefined) {
      delete process.env.IMPORT_MAX_ZIP_ENTRY_BYTES;
    } else {
      process.env.IMPORT_MAX_ZIP_ENTRY_BYTES = previous;
    }
  }
});

test("parseTrackableCsv accepts GSAK-style movement columns", () => {
  const parsed = parseTrackableCsv([
    "Tracking Number,Trackable Name,Action,Date,GC Code,Cache Name,Latitude,Longitude,Notes",
    "TB1234,Red coin,Dropped,2025-04-03,GCAB12,Harbor Cache,56.1612,15.5869,Left it here",
    "TB1234,Red coin,Visited,2025-04-04,GCXY99,Forest Cache,57.1,16.2,Great walk"
  ].join("\n"));

  assert.equal(parsed.trackables.length, 2);
  assert.equal(parsed.logs.length, 2);
  assert.equal(parsed.logs[0]?.trackingCode, "TB1234");
  assert.equal(parsed.logs[0]?.logType, "DROPPED");
  assert.equal(parsed.logs[1]?.gcCode, "GCXY99");
});

test("parseTrackableImportFile extracts a trackable journey from JSON API data", async () => {
  const parsed = await parseTrackableImportFile(
    "trackable-journey.json",
    Buffer.from(
      JSON.stringify({
        trackables: [{ referenceCode: "TB1234", name: "Red coin", kilometersTraveled: 12.5 }],
        journeys: [
          {
            trackableCode: "TB1234",
            geocacheCode: "GCAB12",
            geocacheName: "Harbor Cache",
            loggedDate: "2025-04-03T00:00:00Z",
            trackableLogType: { name: "Dropped Off" },
            coordinates: { latitude: 56.1612, longitude: 15.5869 }
          }
        ]
      })
    )
  );

  assert.equal(parsed.trackables[0]?.trackingCode, "TB1234");
  assert.equal(parsed.logs.length, 1);
  assert.equal(parsed.logs[0]?.logType, "DROPPED");
  assert.equal(parsed.logs[0]?.latitude, 56.1612);
});

test("parseTrackableImportFile reads trackable inventory and logs from a Geocaching GPX", async () => {
  const parsed = await parseTrackableImportFile(
    "geocaching-trackables.gpx",
    Buffer.from(`<?xml version="1.0"?><gpx xmlns:groundspeak="http://www.groundspeak.com/cache/1/0/1"><wpt lat="56.1" lon="15.5"><time>2025-04-03T00:00:00Z</time><name>GCAB12</name><groundspeak:cache><groundspeak:name>Harbor Cache</groundspeak:name><groundspeak:inventory><groundspeak:item><groundspeak:name>Red coin TB1234</groundspeak:name><groundspeak:logs><groundspeak:log><groundspeak:type>Dropped Off</groundspeak:type><groundspeak:date>2025-04-03T00:00:00Z</groundspeak:date></groundspeak:log></groundspeak:logs></groundspeak:item></groundspeak:inventory></groundspeak:cache></wpt></gpx>`)
  );

  assert.equal(parsed.trackables.some((item) => item.trackingCode === "TB1234"), true);
  assert.equal(parsed.logs[0]?.logType, "DROPPED");
  assert.equal(parsed.logs[0]?.gcCode, "GCAB12");
});

test("parseTrackableImportFile reads Geocaching KML with a document-level trackable code", async () => {
  const parsed = await parseTrackableImportFile(
    "trackable-journey.kml",
    Buffer.from(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>TB1234 - Red coin</name><Folder><Placemark><name>GCAB12 - Harbor Cache</name><description>Visited 2025-04-03</description><Point><coordinates>15.5869,56.1612,0</coordinates></Point></Placemark><Placemark><name>GCXY99 - Forest Cache</name><description>Dropped 2025-04-04</description><Point><coordinates>16.2,57.1,0</coordinates></Point></Placemark></Folder></Document></kml>`)
  );

  assert.equal(parsed.trackables.length, 2);
  assert.equal(parsed.trackables[0]?.trackingCode, "TB1234");
  assert.equal(parsed.trackables[0]?.name, "Red coin");
  assert.equal(parsed.logs.length, 2);
  assert.equal(parsed.logs[1]?.logType, "DROPPED");
  assert.equal(parsed.logs[1]?.latitude, 57.1);
});

test("parseTrackableImportFile uses the supplied code when a KML omits trackable metadata", async () => {
  const parsed = await parseTrackableImportFile(
    "trackable-journey.kml",
    Buffer.from(`<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>My journey</name><Placemark><name>GCAB12 - Harbor Cache</name><description>Visited 04/03/2025</description><Point><coordinates>15.5869,56.1612,0</coordinates></Point></Placemark></Document></kml>`),
    "TB5678"
  );

  assert.equal(parsed.trackables[0]?.trackingCode, "TB5678");
  assert.equal(parsed.logs[0]?.trackingCode, "TB5678");
  assert.equal(parsed.logs[0]?.loggedAt.toISOString(), "2025-04-03T00:00:00.000Z");
});

test("parseTrackableImportFile preserves date-less KML stop order and skips its duplicate route line", async () => {
  const parsed = await parseTrackableImportFile(
    "trackable-journey.kml",
    Buffer.from(`<kml xmlns="http://earth.google.com/kml/2.2"><Document><name>The world wanderer</name><Placemark><name>GCAB12</name><Point><coordinates>15.5869,56.1612,100</coordinates></Point><description><![CDATA[]]></description></Placemark><Placemark><name>GCXY99</name><Point><coordinates>16.2,57.1,100</coordinates></Point><description><![CDATA[]]></description></Placemark><Placemark><name>Travelbug Route</name><LineString><coordinates>15.5869,56.1612,100 16.2,57.1,100</coordinates></LineString></Placemark></Document></kml>`),
    "TB5678"
  );

  assert.equal(parsed.trackables[0]?.name, "The world wanderer");
  assert.equal(parsed.logs.length, 2);
  assert.equal(parsed.logs[0]?.latitude, 56.1612);
  assert.equal(parsed.logs[1]?.longitude, 16.2);
  assert.equal(parsed.logs[0]?.raw.__geostatsKmlDateEstimated, true);
});

test("parseTrackableImportFile infers a stable KML identifier when cache stops omit the TB code", async () => {
  const content = Buffer.from(`<kml xmlns="http://earth.google.com/kml/2.2"><Document><Style id="tbTravelStyle"/><name>The world wanderer</name><Placemark><name>GCAB12</name><Point><coordinates>15.5869,56.1612,100</coordinates></Point></Placemark><Placemark><name>GCXY99</name><Point><coordinates>16.2,57.1,100</coordinates></Point></Placemark><Placemark><name>Travelbug Route</name><LineString><coordinates>15.5869,56.1612,100 16.2,57.1,100</coordinates></LineString></Placemark></Document></kml>`);
  const parsed = await parseTrackableImportFile("trackable-journey.kml", content);

  assert.match(parsed.trackables[0]?.trackingCode ?? "", /^KML-THE-WORLD-WANDERER-[A-Z0-9]+$/);
  assert.equal(parsed.trackables[0]?.raw.__geostatsKmlTrackingCodeInferred, true);
  assert.equal(parsed.logs.length, 2);
});

test("parseTrackableImportFile accepts a KMZ wrapper", async () => {
  const zip = new JSZip();
  zip.file("doc.kml", `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>TB1234</name><Placemark><name>GCAB12</name><description>Visited 2025-04-03</description><Point><coordinates>15.5869,56.1612,0</coordinates></Point></Placemark></Document></kml>`);
  const parsed = await parseTrackableImportFile("trackable-journey.kmz", await zip.generateAsync({ type: "nodebuffer" }));

  assert.equal(parsed.trackables[0]?.trackingCode, "TB1234");
  assert.equal(parsed.logs.length, 1);
});

test("parseTrackableImportFile counts unsupported KMZ entries toward the entry limit", async () => {
  const previous = process.env.IMPORT_MAX_ZIP_ENTRIES;
  process.env.IMPORT_MAX_ZIP_ENTRIES = "2";
  try {
    const zip = new JSZip();
    zip.file("doc.kml", `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>TB1234</name><Placemark><name>GCAB12</name><Point><coordinates>15.5869,56.1612,0</coordinates></Point></Placemark></Document></kml>`);
    zip.file("preview.png", "ignored");
    zip.file("metadata.xml", "ignored");
    const content = await zip.generateAsync({ type: "nodebuffer" });

    await assert.rejects(
      () => parseTrackableImportFile("trackable-journey.kmz", content),
      /more than 2 entries/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.IMPORT_MAX_ZIP_ENTRIES;
    } else {
      process.env.IMPORT_MAX_ZIP_ENTRIES = previous;
    }
  }
});
