import assert from "node:assert/strict";
import test from "node:test";
import { renderPublicScratchMapSvg } from "./public-profile-renderer";

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
