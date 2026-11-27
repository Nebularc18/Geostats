"use client";

import { useEffect, useRef } from "react";
import maplibregl, { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { boundsFor, isValidMapPoint } from "../lib/map-bounds";

export type MapDisplayMode = "points" | "clusters" | "heatmap";
export type MapBasemapStyle = "dark" | "light";

export interface CacheMapPoint {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty?: number | null;
  terrain?: number | null;
  size?: string | null;
  latitude: number;
  longitude: number;
  country?: string | null;
  region?: string | null;
  county?: string | null;
  hiddenDate?: string | null;
  foundAt?: string;
  placedAt?: string;
  isOwnHide?: boolean;
  isSolvedMystery?: boolean;
  isUnfound?: boolean;
}

export const DARK_VECTOR_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export const osmRasterStyle: StyleSpecification = {
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap contributors"
    }
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      paint: {
        "raster-brightness-max": 0.92,
        "raster-brightness-min": 0.04,
        "raster-saturation": -0.1,
        "raster-contrast": 0.02
      }
    }
  ]
};

const POINT_SOURCE_ID = "cache-points";
const CLUSTER_SOURCE_ID = "cache-points-clustered";
const POINT_SHADOW_LAYER_ID = "cache-point-shadows";
const POINT_LAYER_ID = "cache-points";
const CLUSTER_CIRCLE_LAYER_ID = "cache-clusters";
const CLUSTER_COUNT_LAYER_ID = "cache-cluster-count";
const CLUSTER_UNCLUSTERED_LAYER_ID = "cache-unclustered-points";
const HEATMAP_LAYER_ID = "cache-heatmap";

const CACHE_TYPE_COLOR_PAIRS = [
  ["Traditional Cache", "#4ca64c"],
  ["Multi-cache", "#f5a623"],
  ["Multi-Cache", "#f5a623"],
  ["Mystery Cache", "#337ab7"],
  ["Mystery or Puzzle Cache", "#337ab7"],
  ["Unknown Cache", "#337ab7"],
  ["EarthCache", "#b67f3a"],
  ["Earth Cache", "#b67f3a"],
  ["Letterbox Hybrid", "#8e63b7"],
  ["Wherigo Cache", "#5aa6c8"],
  ["Virtual Cache", "#7f8c8d"],
  ["Webcam Cache", "#7f8c8d"],
  ["Event Cache", "#c44f4f"],
  ["Mega-Event Cache", "#c44f4f"],
  ["Giga-Event Cache", "#c44f4f"],
  ["Cache In Trash Out Event", "#6fa84f"],
  ["Geocaching HQ Cache", "#5b8f2a"],
  ["GPS Adventures Maze Exhibit", "#5b8f2a"],
  ["Project A.P.E. Cache", "#5b8f2a"]
] as const;
const FALLBACK_CACHE_TYPE_COLOR = "#6f7f73";
const OWN_HIDE_COLOR = "#d9468f";
const SOLVED_MYSTERY_COLOR = "#8b5cf6";
const UNFOUND_COLOR = "#f59e0b";

const CACHE_TYPE_COLORS = ["match", ["get", "cacheType"], ...CACHE_TYPE_COLOR_PAIRS.flat(), FALLBACK_CACHE_TYPE_COLOR] as unknown as ExpressionSpecification;
const POINT_COLORS = [
  "case",
  ["==", ["get", "isOwnHide"], true],
  OWN_HIDE_COLOR,
  ["==", ["get", "isSolvedMystery"], true],
  SOLVED_MYSTERY_COLOR,
  ["==", ["get", "isUnfound"], true],
  UNFOUND_COLOR,
  CACHE_TYPE_COLORS
] as unknown as ExpressionSpecification;

type CachePointProperties = {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string;
  difficulty: number | null;
  terrain: number | null;
  size: string;
  location: string;
  dateLabel: string;
  isOwnHide: boolean;
  isSolvedMystery: boolean;
  isUnfound: boolean;
};

type CachePointFeatureCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: CachePointProperties;
  }[];
};

export function getCacheTypeColor(cacheType: string | null, isOwnHide = false, isSolvedMystery = false, isUnfound = false) {
  if (isOwnHide) return OWN_HIDE_COLOR;
  if (isSolvedMystery) return SOLVED_MYSTERY_COLOR;
  if (isUnfound) return UNFOUND_COLOR;
  return CACHE_TYPE_COLOR_PAIRS.find(([type]) => type === cacheType)?.[1] ?? FALLBACK_CACHE_TYPE_COLOR;
}

function pointsToGeoJson(points: CacheMapPoint[]): CachePointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.filter(isValidMapPoint).map((point) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [point.longitude, point.latitude]
      },
      properties: {
        id: point.id,
        gcCode: point.gcCode,
        name: point.name,
        cacheType: point.cacheType ?? "Unknown",
        difficulty: point.difficulty ?? null,
        terrain: point.terrain ?? null,
        size: point.size ?? "Unknown",
        location: [point.county, point.region, point.country].filter(Boolean).join(", "),
        dateLabel: point.isOwnHide
          ? point.placedAt
            ? `Placed ${point.placedAt.slice(0, 10)}`
            : ""
          : point.foundAt
            ? `Found ${point.foundAt.slice(0, 10)}`
            : "",
        isOwnHide: point.isOwnHide === true,
        isSolvedMystery: point.isSolvedMystery === true,
        isUnfound: point.isUnfound === true
      }
    }))
  };
}

export function CacheMap({
  points,
  displayMode = "points",
  basemap = "dark",
  onSelectCache
}: {
  points: CacheMapPoint[];
  displayMode?: MapDisplayMode;
  basemap?: MapBasemapStyle;
  onSelectCache?: (gcCode: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hasFittedRef = useRef(false);
  const onSelectCacheRef = useRef(onSelectCache);
  onSelectCacheRef.current = onSelectCache;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemap === "light" ? osmRasterStyle : DARK_VECTOR_STYLE_URL,
      center: [15.5869, 56.1612],
      zoom: 5,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("click", (event) => {
      if (map.getLayer(CLUSTER_CIRCLE_LAYER_ID) && map.getLayoutProperty(CLUSTER_CIRCLE_LAYER_ID, "visibility") !== "none") {
        const clusterFeatures = map.queryRenderedFeatures(event.point, { layers: [CLUSTER_CIRCLE_LAYER_ID] });
        const cluster = clusterFeatures[0];
        if (cluster && cluster.properties?.cluster_id != null && cluster.geometry.type === "Point") {
          const source = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          void source?.getClusterExpansionZoom(Number(cluster.properties.cluster_id)).then((zoom) => {
            map.easeTo({
              center: cluster.geometry.type === "Point" ? (cluster.geometry.coordinates as [number, number]) : undefined,
              zoom: Math.min(zoom, 15)
            });
          });
          return;
        }
      }

      const clickableLayers = [POINT_LAYER_ID, CLUSTER_UNCLUSTERED_LAYER_ID].filter(
        (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none"
      );
      if (!clickableLayers.length) return;

      const [feature] = map.queryRenderedFeatures(event.point, { layers: clickableLayers });
      if (!feature || !feature.properties) return;

      const coordinates = feature.geometry.type === "Point" ? (feature.geometry.coordinates as number[]) : [];
      if (coordinates.length < 2) return;

      const gcCode = String(feature.properties.gcCode ?? "");
      if (gcCode && onSelectCacheRef.current) {
        onSelectCacheRef.current(gcCode);
        return;
      }
      const isOwnHide = feature.properties.isOwnHide === true;
      const isSolvedMystery = feature.properties.isSolvedMystery === true;
      const isUnfound = feature.properties.isUnfound === true;

      const popupContent = document.createElement("div");
      popupContent.className = "cache-popup";

      const codeLink = document.createElement("a");
      codeLink.className = "cache-popup-code";
      codeLink.href = `https://coord.info/${encodeURIComponent(gcCode)}`;
      codeLink.target = "_blank";
      codeLink.rel = "noreferrer";
      codeLink.textContent = gcCode;

      const name = document.createElement("div");
      name.className = "cache-popup-name";
      name.textContent = String(feature.properties.name ?? "");

      const type = document.createElement("small");
      type.className = "cache-popup-type";
      type.textContent = isOwnHide
        ? `Own hide · ${String(feature.properties.cacheType ?? "Unknown")}`
        : isSolvedMystery
          ? "Solved mystery (final coordinates)"
          : isUnfound
            ? `Unfound · ${String(feature.properties.cacheType ?? "Unknown")}`
            : String(feature.properties.cacheType ?? "Unknown");

      const details = document.createElement("div");
      details.className = "cache-popup-details";
      const difficulty = feature.properties.difficulty;
      const terrain = feature.properties.terrain;
      const size = String(feature.properties.size ?? "Unknown");
      details.textContent = `D ${difficulty ?? "?"} / T ${terrain ?? "?"} · ${size}`;

      popupContent.append(codeLink, name, type, details);

      const dateLabel = String(feature.properties.dateLabel ?? "");
      if (dateLabel) {
        const dateEl = document.createElement("small");
        dateEl.className = "cache-popup-location";
        dateEl.textContent = dateLabel;
        popupContent.append(dateEl);
      }

      const location = String(feature.properties.location ?? "");
      if (location) {
        const locationEl = document.createElement("small");
        locationEl.className = "cache-popup-location";
        locationEl.textContent = location;
        popupContent.append(locationEl);
      }

      if (!isOwnHide && !isSolvedMystery && !isUnfound && gcCode) {
        const logbookLink = document.createElement("a");
        logbookLink.className = "cache-popup-logbook";
        logbookLink.href = `/logbook?q=${encodeURIComponent(gcCode)}`;
        logbookLink.textContent = "View in Logbook →";
        popupContent.append(logbookLink);
      }

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ offset: 14 })
        .setLngLat([Number(coordinates[0]), Number(coordinates[1])])
        .setDOMContent(popupContent)
        .addTo(map);
    });

    map.on("mousemove", (event) => {
      const interactiveLayers = [POINT_LAYER_ID, CLUSTER_CIRCLE_LAYER_ID, CLUSTER_UNCLUSTERED_LAYER_ID].filter(
        (id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none"
      );
      if (!interactiveLayers.length) {
        map.getCanvas().style.cursor = "";
        return;
      }
      const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      hasFittedRef.current = false;
    };
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const activeMap = map;
    let cancelled = false;

    function syncPoints() {
      const geoJson = pointsToGeoJson(points);
      const rawSource = activeMap.getSource(POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const clusterSource = activeMap.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

      if (rawSource) {
        rawSource.setData(geoJson);
      } else {
        activeMap.addSource(POINT_SOURCE_ID, { type: "geojson", data: geoJson });

        activeMap.addLayer({
          id: HEATMAP_LAYER_ID,
          type: "heatmap",
          source: POINT_SOURCE_ID,
          layout: { visibility: displayMode === "heatmap" ? "visible" : "none" },
          paint: {
            "heatmap-weight": 1,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 9, 3],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 9, 24],
            "heatmap-opacity": 0.82,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(33,102,172,0)",
              0.2,
              "#38bdf8",
              0.45,
              "#4ade80",
              0.7,
              "#facc15",
              1,
              "#ef4444"
            ]
          }
        });

        activeMap.addLayer({
          id: POINT_SHADOW_LAYER_ID,
          type: "circle",
          source: POINT_SOURCE_ID,
          layout: { visibility: displayMode === "points" ? "visible" : "none" },
          paint: {
            "circle-radius": 8,
            "circle-color": "rgba(7, 17, 11, 0.72)",
            "circle-blur": 0.15
          }
        });

        activeMap.addLayer({
          id: POINT_LAYER_ID,
          type: "circle",
          source: POINT_SOURCE_ID,
          layout: { visibility: displayMode === "points" ? "visible" : "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4.5, 8, 6.5, 12, 9],
            "circle-color": POINT_COLORS,
            "circle-stroke-color": "#fff7de",
            "circle-stroke-width": 2,
            "circle-opacity": 0.94
          }
        });
      }

      if (clusterSource) {
        clusterSource.setData(geoJson);
      } else {
        activeMap.addSource(CLUSTER_SOURCE_ID, {
          type: "geojson",
          data: geoJson,
          cluster: true,
          clusterMaxZoom: 13,
          clusterRadius: 48
        });

        activeMap.addLayer({
          id: CLUSTER_CIRCLE_LAYER_ID,
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: { visibility: displayMode === "clusters" ? "visible" : "none" },
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#22c55e", 25, "#eab308", 100, "#f97316"],
            "circle-radius": ["step", ["get", "point_count"], 18, 25, 24, 100, 30],
            "circle-stroke-color": "#0b1410",
            "circle-stroke-width": 2
          }
        });

        activeMap.addLayer({
          id: CLUSTER_COUNT_LAYER_ID,
          type: "symbol",
          source: CLUSTER_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: {
            visibility: displayMode === "clusters" ? "visible" : "none",
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Noto Sans Regular"],
            "text-size": 12
          },
          paint: {
            "text-color": "#07110b"
          }
        });

        activeMap.addLayer({
          id: CLUSTER_UNCLUSTERED_LAYER_ID,
          type: "circle",
          source: CLUSTER_SOURCE_ID,
          filter: ["!", ["has", "point_count"]],
          layout: { visibility: displayMode === "clusters" ? "visible" : "none" },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 5, 10, 7.5],
            "circle-color": POINT_COLORS,
            "circle-stroke-color": "#fff7de",
            "circle-stroke-width": 2
          }
        });
      }

      const setVis = (id: string, visible: boolean) => {
        if (activeMap.getLayer(id)) {
          activeMap.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      };
      setVis(POINT_SHADOW_LAYER_ID, displayMode === "points");
      setVis(POINT_LAYER_ID, displayMode === "points");
      setVis(CLUSTER_CIRCLE_LAYER_ID, displayMode === "clusters");
      setVis(CLUSTER_COUNT_LAYER_ID, displayMode === "clusters");
      setVis(CLUSTER_UNCLUSTERED_LAYER_ID, displayMode === "clusters");
      setVis(HEATMAP_LAYER_ID, displayMode === "heatmap");

      const bounds = boundsFor(points);
      if (bounds && !hasFittedRef.current) {
        hasFittedRef.current = true;
        activeMap.fitBounds(bounds, { padding: 56, maxZoom: 10, duration: 700 });
      }
    }

    function syncWhenReady() {
      if (cancelled) return;
      if (!activeMap.isStyleLoaded()) {
        window.setTimeout(syncWhenReady, 50);
        return;
      }
      syncPoints();
    }

    syncWhenReady();
    return () => {
      cancelled = true;
    };
  }, [points, displayMode, basemap]);

  return <div ref={containerRef} className="maplibre-panel" />;
}
