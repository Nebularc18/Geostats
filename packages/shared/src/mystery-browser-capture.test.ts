import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { MYSTERY_BROWSER_CAPTURE_SOURCE, mysteryBrowserCaptureScript } from "./mystery-browser-capture";

function captureMysteryDocument(document: unknown, href: string) {
  return JSON.parse(JSON.stringify(runInNewContext(`(${MYSTERY_BROWSER_CAPTURE_SOURCE})(document, href)`, { document, href, URL })));
}

function page(coordinate = "N 59° 20.123 E 018° 04.321") {
  const values: Record<string, string> = { "#ctl00_ContentBody_CacheName": "Puzzle", "#uxLatLon": coordinate, "#ctl00_ContentBody_ShortDescription": "Puzzle introduction", "#ctl00_ContentBody_LongDescription": "Solve this puzzle", "#div_hint": "Hint shown on the page" };
  return { querySelector: (selector: string) => values[selector] ? { innerText: values[selector], getAttribute: () => null } : null, querySelectorAll: () => [{ getAttribute: () => "https://img.geocaching.com/puzzle.jpg" }] };
}

test("captures only the cache content visible in the user's browser", () => {
  const result = captureMysteryDocument(page(), "https://www.geocaching.com/geocache/GC12345_puzzle");
  assert.equal(result?.gcCode, "GC12345");
  assert.ok(Math.abs(result!.latitude - (59 + 20.123 / 60)) < 0.000001);
  assert.equal(result.listingText, "Puzzle introduction\n\nSolve this puzzle");
  assert.deepEqual(result.clues, ["Listing hint as shown on Geocaching:\nHint shown on the page"]);
  assert.deepEqual(result!.listingImageUrls, ["https://img.geocaching.com/puzzle.jpg"]);
});

test("sign-in pages, restricted pages, wrong hosts, and invalid coordinates never produce a cache", () => {
  assert.equal(captureMysteryDocument(page(), "https://www.geocaching.com/account/signin"), null);
  assert.equal(captureMysteryDocument(page(), "https://evil.test/geocache/GC12345"), null);
  assert.equal(captureMysteryDocument(page("Sign in to view coordinates"), "https://www.geocaching.com/geocache/GC12345"), null);
  assert.equal(captureMysteryDocument(page("N 59° 70.123 E 018° 04.321"), "https://www.geocaching.com/geocache/GC12345"), null);
});

test("the serialized browser script works without reading browser credentials", () => {
  const messages: string[] = [];
  const document = Object.defineProperty(page("59.25, 18.5"), "cookie", { get() { throw new Error("Must not read cookies"); } });
  runInNewContext(mysteryBrowserCaptureScript(), { document, location: { href: "https://www.geocaching.com/geocache/GC12345" }, URL, window: { ReactNativeWebView: { postMessage: (value: string) => messages.push(value) } } });
  const message = JSON.parse(messages[0]);
  assert.equal(message.type, "geostats-mystery-page");
  assert.equal(message.data.latitude, 59.25);
  assert.equal(message.data.longitude, 18.5);
});

test("image-only puzzle descriptions are valid, while empty listings remain unavailable", () => {
  const base = page();
  const document = { ...base, querySelector: (selector: string) => selector.includes("Description") || selector.includes("description") ? null : base.querySelector(selector) };
  const captured = captureMysteryDocument(document, "https://www.geocaching.com/geocache/GC12345");
  assert.equal(captured?.listingText, "");
  assert.deepEqual(captured?.clues, ["Listing hint as shown on Geocaching:\nHint shown on the page"]);
  assert.equal(captured?.listingImageUrls.length, 1);
  assert.equal(captureMysteryDocument({ ...document, querySelectorAll: () => [] }, "https://www.geocaching.com/geocache/GC12345"), null);
});


test("browser injection does not rely on function source surviving Hermes bytecode", () => {
  const original = Function.prototype.toString;
  let script: string;
  try {
    Function.prototype.toString = () => "function captureMysteryDocument() { [bytecode] }";
    script = mysteryBrowserCaptureScript();
  } finally { Function.prototype.toString = original; }
  assert.ok(!script.includes("[bytecode]"));
  const messages: string[] = [];
  runInNewContext(script, { document: page(), location: { href: "https://www.geocaching.com/geocache/GC12345" }, URL,
    window: { ReactNativeWebView: { postMessage: (message: string) => messages.push(message) } } });
  assert.equal(JSON.parse(messages[0]).data.gcCode, "GC12345");
});
