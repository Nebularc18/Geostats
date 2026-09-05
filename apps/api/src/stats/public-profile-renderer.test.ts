import assert from "node:assert/strict";
import test from "node:test";
import { renderPublicExtremesSvg, renderPublicProfileHtml, renderPublicScratchMapSvg } from "./public-profile-renderer";

const worldMapTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 360">
<rect width="720" height="360" fill="#6fc7ef"/>
<path d="M0 0" fill="#e7e7e3" stroke="#555"><title>Sweden: 0</title></path>
<path d="M1 1" fill="#e7e7e3" stroke="#555"><title>United States of America: 0</title></path>
</svg>`;

test("renders a static scratch map with country counts and aliases", () => {
  const svg = renderPublicScratchMapSvg(
    { gcUsername: "Nebularc_" },
    {
      totalFinds: 283,
      countries: [
        { key: "Sweden", count: 244 },
        { key: "United States", count: 1 },
      ],
    },
    worldMapTemplate,
  );

  assert.match(svg, /Nebularc_ Scratch Map/);
  assert.match(svg, /283 finds in 2 countries/);
  assert.match(svg, /fill="#7c3aed"[^>]*><title>Sweden: 244<\/title>/);
  assert.match(
    svg,
    /fill="#fff1a8"[^>]*><title>United States of America: 1<\/title>/,
  );
});

test("escapes profile text in the generated SVG", () => {
  const svg = renderPublicScratchMapSvg(
    { gcUsername: "<unsafe>" },
    { totalFinds: 0, countries: [] },
    worldMapTemplate,
  );

  assert.doesNotMatch(svg, /<unsafe>/);
  assert.match(svg, /&lt;unsafe&gt; Scratch Map/);
});

test("extracts map content after an XML declaration and comment", () => {
  const templateWithPreamble = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generated map -->
${worldMapTemplate}`;
  const svg = renderPublicScratchMapSvg(
    { gcUsername: "Nebularc_" },
    { totalFinds: 1, countries: [{ key: "Sweden", count: 1 }] },
    templateWithPreamble,
  );

  assert.doesNotMatch(svg, /<\?xml|generated map/);
  assert.match(svg, /<title>Sweden: 1<\/title>/);
});

test("renders public profile maps without executable third-party content", () => {
  const html = renderPublicProfileHtml(
    { gcUsername: "User / <unsafe>" },
    { totalFinds: 1, countries: [{ key: "Sweden", count: 1 }] }
  );

  assert.doesNotMatch(html, /<script\b|onmousedown=|maplibre|unpkg\.com|raw\.githubusercontent\.com/i);
  assert.match(html, /Content-Security-Policy[^>]+default-src 'none'/);
  assert.match(html, /src="\/public\/profile-scratch-map-image\/User%20%2F%20%3Cunsafe%3E"/);
  assert.match(html, /<details open><summary>Project-GC Maps<\/summary>/);
  assert.match(html, /<details><summary>Stats<\/summary>/);
});

test("renders reusable extreme badges for the public profile image", () => {
  const svg = renderPublicExtremesSvg(
    { gcUsername: "Nebularc_" },
    {
      northernmost: {
        gcCode: "GCPQ1G",
        name: "Explore Sweden #6 - Treriksröset",
        country: "Sweden",
        elevationMeters: 498,
        found: true
      },
      highestElevation: {
        gcCode: "GC2YA0F",
        name: "The roof of Sweden",
        country: "Sweden",
        elevationMeters: 2104,
        found: false
      },
      oldest: {
        gcCode: "GCOLD",
        name: "Old & <unsafe>",
        hiddenDate: "2000-05-03",
        found: false
      }
    }
  );

  assert.match(svg, /Nebularc_ Extreme Caches/);
  assert.match(svg, />N<\/text>/);
  assert.match(svg, />HIGHEST<\/text>/);
  assert.match(svg, /2104 m/);
  assert.match(svg, /aria-label="Found"/);
  assert.match(svg, /Old &amp; &lt;unsafe&gt;/);
  assert.doesNotMatch(svg, /Old & <unsafe>/);
});
