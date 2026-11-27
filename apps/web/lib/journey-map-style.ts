import type { StyleSpecification } from "maplibre-gl";

// Dark OpenMapTiles basemap matching Geostats' dark UI: keeps trackable routes
// prominent at continental zooms, then reveals streets and places as you zoom in.
export const journeyMapStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    geography: { type: "vector", url: "https://tiles.openfreemap.org/planet" }
  },
  layers: [
    { id: "land", type: "background", paint: { "background-color": "#1f2b24" } },
    {
      id: "wood",
      type: "fill",
      source: "geography",
      "source-layer": "landcover",
      minzoom: 8,
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": "#263b2e", "fill-opacity": 0.6 }
    },
    {
      id: "water",
      type: "fill",
      source: "geography",
      "source-layer": "water",
      paint: { "fill-color": "#071522" }
    },
    {
      id: "rivers",
      type: "line",
      source: "geography",
      "source-layer": "waterway",
      minzoom: 7,
      paint: { "line-color": "#123048", "line-width": 1.1 }
    },
    {
      id: "streets",
      type: "line",
      source: "geography",
      "source-layer": "transportation",
      minzoom: 8,
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"],
        true,
        false
      ],
      paint: {
        "line-color": "#314338",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 15, 2.5]
      }
    },
    {
      id: "boundaries",
      type: "line",
      source: "geography",
      "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": "#4f6858", "line-width": 1.2, "line-dasharray": [3, 1.5] }
    },
    {
      id: "towns",
      type: "symbol",
      source: "geography",
      "source-layer": "place",
      minzoom: 6,
      filter: ["match", ["get", "class"], ["town", "village"], true, false],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-padding": 8
      },
      paint: { "text-color": "#a8bbb0", "text-halo-color": "#0f1712", "text-halo-width": 1.3 }
    },
    {
      id: "cities",
      type: "symbol",
      source: "geography",
      "source-layer": "place",
      minzoom: 3,
      filter: ["==", ["get", "class"], "city"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
        "text-padding": 10
      },
      paint: { "text-color": "#dce9e1", "text-halo-color": "#0f1712", "text-halo-width": 1.5 }
    },
    {
      id: "countries",
      type: "symbol",
      source: "geography",
      "source-layer": "place",
      maxzoom: 8,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Bold"],
        "text-transform": "uppercase",
        "text-size": 12,
        "text-padding": 3
      },
      paint: { "text-color": "#9eb7a9", "text-halo-color": "#0f1712", "text-halo-width": 1.5 }
    }
  ]
};

// OpenStreetMap raster fallback used when the user toggles OSM or if vector
// tiles are blocked/unavailable on their network.
export const journeyOsmStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }]
};
