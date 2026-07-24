import assert from "node:assert/strict";
import test from "node:test";
import { locationFromPageSources } from "./mystery-page-location.ts";

test("prefers the cache Place over an unrelated JSON-LD organization address", () => {
  const result = locationFromPageSources({
    jsonLd: [
      {
        "@type": "Organization",
        address: {
          addressCountry: "United States",
          addressRegion: "Washington",
          addressLocality: "Seattle"
        }
      },
      {
        "@type": "Place",
        name: "GC12345",
        address: {
          addressCountry: { name: "Sweden" },
          addressRegion: "Stockholm County",
          addressLocality: "Vaxholm"
        }
      }
    ],
    breadcrumbs: [],
    locationTexts: []
  });

  assert.deepEqual(result, {
    country: "Sweden",
    region: "Stockholm County",
    county: "Stockholm County",
    locality: "Vaxholm",
    locationHierarchy: ["Sweden", "Stockholm County", "Vaxholm"]
  });
});

test("fills a partial JSON-LD address from broad-to-narrow breadcrumbs", () => {
  const result = locationFromPageSources({
    jsonLd: [{ "@type": "Place", address: { addressCountry: "Sweden" } }],
    breadcrumbs: [["Sweden", "Svealand", "Stockholm County"]],
    locationTexts: []
  });

  assert.deepEqual(result, {
    country: "Sweden",
    region: "Svealand",
    county: "Stockholm County",
    locality: "",
    locationHierarchy: ["Sweden", "Svealand", "Stockholm County"]
  });
});

test("normalizes narrow-to-broad location text into a broad-to-narrow hierarchy", () => {
  const result = locationFromPageSources({
    jsonLd: [],
    breadcrumbs: [],
    locationTexts: ["Vaxholm, Stockholm County, Sweden"]
  });

  assert.deepEqual(result, {
    country: "Sweden",
    region: "",
    county: "Stockholm County",
    locality: "Vaxholm",
    locationHierarchy: ["Sweden", "Stockholm County", "Vaxholm"]
  });
});

test("uses metadata only after structured and visible page sources", () => {
  const result = locationFromPageSources({
    jsonLd: [],
    breadcrumbs: [["Sweden", "Stockholm County"]],
    locationTexts: [],
    metaRegion: "Wrong meta region",
    metadata: { country: "Wrong country", county: "Wrong county" }
  });

  assert.equal(result.country, "Sweden");
  assert.equal(result.county, "Stockholm County");
});
