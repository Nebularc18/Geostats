import type { StyleSpecification } from "maplibre-gl";

// A small OpenMapTiles basemap: keep the journey prominent at continental zooms,
// then reveal streets and places as the user zooms in. TileJSON supplies attribution.
export const journeyMapStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    geography: { type: "vector", url: "https://tiles.openfreemap.org/planet" }
  },
  layers: [
    { id: "land", type: "background", paint: { "background-color": "#dddddd" } },
    { id: "wood", type: "fill", source: "geography", "source-layer": "landcover", minzoom: 8,
      filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": "#cbd8c8", "fill-opacity": 0.5 } },
    { id: "water", type: "fill", source: "geography", "source-layer": "water",
      paint: { "fill-color": "#9bd2f2" } },
    { id: "rivers", type: "line", source: "geography", "source-layer": "waterway", minzoom: 7,
      paint: { "line-color": "#9bd2f2", "line-width": 1 } },
    { id: "streets", type: "line", source: "geography", "source-layer": "transportation", minzoom: 8,
      filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], true, false],
      paint: { "line-color": "#f4f4f4", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 15, 2.5] } },
    { id: "boundaries", type: "line", source: "geography", "source-layer": "boundary",
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": "#b8b8b8", "line-width": 1, "line-dasharray": [3, 1] } },
    { id: "towns", type: "symbol", source: "geography", "source-layer": "place", minzoom: 6,
      filter: ["match", ["get", "class"], ["town", "village"], true, false],
      layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Open Sans Regular"], "text-size": 11, "text-padding": 8 },
      paint: { "text-color": "#555555", "text-halo-color": "#eeeeee", "text-halo-width": 1 } },
    { id: "cities", type: "symbol", source: "geography", "source-layer": "place", minzoom: 3,
      filter: ["==", ["get", "class"], "city"],
      layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Open Sans Semibold"], "text-size": 12, "text-padding": 10 },
      paint: { "text-color": "#454545", "text-halo-color": "#eeeeee", "text-halo-width": 1 } },
    { id: "countries", type: "symbol", source: "geography", "source-layer": "place", maxzoom: 8,
      filter: ["==", ["get", "class"], "country"],
      layout: { "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]], "text-font": ["Open Sans Semibold"], "text-transform": "uppercase", "text-size": 12, "text-padding": 3 },
      paint: { "text-color": "#51515b", "text-halo-color": "#eeeeee", "text-halo-width": 1 } }
  ]
};
