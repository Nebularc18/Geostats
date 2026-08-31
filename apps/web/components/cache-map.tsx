"use client";

import { useEffect, useRef } from "react";
import maplibregl, { ExpressionSpecification, LngLatBoundsLike, StyleSpecification } from "maplibre-gl";

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
}

const osmRasterStyle: StyleSpecification = {
  version: 8,
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
        "raster-brightness-max": 0.86,
        "raster-brightness-min": 0.08,
        "raster-saturation": -0.22,
        "raster-contrast": 0.02
      }
    }
  ]
};

const POINT_SOURCE_ID = "cache-points";
const POINT_SHADOW_LAYER_ID = "cache-point-shadows";
const POINT_LAYER_ID = "cache-points";
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
const CACHE_TYPE_COLORS = ["match", ["get", "cacheType"], ...CACHE_TYPE_COLOR_PAIRS.flat(), FALLBACK_CACHE_TYPE_COLOR] as unknown as ExpressionSpecification;
const POINT_COLORS = ["case", ["==", ["get", "isOwnHide"], true], OWN_HIDE_COLOR, CACHE_TYPE_COLORS] as unknown as ExpressionSpecification;

type CachePointProperties = {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string;
  difficulty: number | null;
  terrain: number | null;
  size: string;
  location: string;
  isOwnHide: boolean;
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

export function getCacheTypeColor(cacheType: string | null, isOwnHide = false) {
  if (isOwnHide) {
    return OWN_HIDE_COLOR;
  }
  return CACHE_TYPE_COLOR_PAIRS.find(([type]) => type === cacheType)?.[1] ?? FALLBACK_CACHE_TYPE_COLOR;
}

function isValidPoint(point: CacheMapPoint) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

function pointsToGeoJson(points: CacheMapPoint[]): CachePointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.filter(isValidPoint).map((point) => ({
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
        isOwnHide: point.isOwnHide === true
      }
    }))
  };
}

function boundsFor(points: CacheMapPoint[]): LngLatBoundsLike | null {
  const validPoints = points.filter(isValidPoint);
  if (validPoints.length === 0) {
    return null;
  }

  const west = Math.min(...validPoints.map((point) => point.longitude));
  const east = Math.max(...validPoints.map((point) => point.longitude));
  const south = Math.min(...validPoints.map((point) => point.latitude));
  const north = Math.max(...validPoints.map((point) => point.latitude));
  return [
    [west, south],
    [east, north]
  ];
}

export function CacheMap({ points }: { points: CacheMapPoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmRasterStyle,
      center: [15.5869, 56.1612],
      zoom: 5,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("click", (event) => {
      if (!map.getLayer(POINT_LAYER_ID)) {
        return;
      }

      const [feature] = map.queryRenderedFeatures(event.point, {
        layers: [POINT_LAYER_ID]
      });
      if (!feature || !feature.properties) {
        return;
      }

      const coordinates = feature.geometry.type === "Point" ? (feature.geometry.coordinates as number[]) : [];
      if (coordinates.length < 2) {
        return;
      }

      const popupContent = document.createElement("div");
      const code = document.createElement("strong");
      code.textContent = String(feature.properties.gcCode ?? "");
      const name = document.createElement("div");
      name.textContent = String(feature.properties.name ?? "");
      const type = document.createElement("small");
      type.textContent =
        feature.properties.isOwnHide === true ? `Own hide - ${String(feature.properties.cacheType ?? "Unknown")}` : String(feature.properties.cacheType ?? "Unknown");
      const details = document.createElement("div");
      const difficulty = feature.properties.difficulty;
      const terrain = feature.properties.terrain;
      const size = String(feature.properties.size ?? "Unknown");
      details.textContent = `D ${difficulty ?? "?"} / T ${terrain ?? "?"} - ${size}`;
      const location = document.createElement("small");
      location.textContent = String(feature.properties.location ?? "");
      popupContent.append(code, name, type, details);
      if (location.textContent) {
        popupContent.append(location);
      }

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ offset: 14 })
        .setLngLat([Number(coordinates[0]), Number(coordinates[1])])
        .setDOMContent(popupContent)
        .addTo(map);
    });

    map.on("mousemove", (event) => {
      if (!map.getLayer(POINT_LAYER_ID)) {
        map.getCanvas().style.cursor = "";
        return;
      }

      const features = map.queryRenderedFeatures(event.point, {
        layers: [POINT_LAYER_ID]
      });
      map.getCanvas().style.cursor = features.length > 0 ? "pointer" : "";
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const activeMap = map;
    let cancelled = false;

    function syncPoints() {
      const geoJson = pointsToGeoJson(points);
      const source = activeMap.getSource(POINT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

      if (source) {
        source.setData(geoJson);
      } else {
        activeMap.addSource(POINT_SOURCE_ID, {
          type: "geojson",
          data: geoJson
        });

        activeMap.addLayer({
          id: POINT_SHADOW_LAYER_ID,
          type: "circle",
          source: POINT_SOURCE_ID,
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
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 4.5, 8, 6.5, 12, 9],
            "circle-color": POINT_COLORS,
            "circle-stroke-color": "#fff7de",
            "circle-stroke-width": 2,
            "circle-opacity": 0.94
          }
        });
      }

      const bounds = boundsFor(points);
      if (bounds) {
        activeMap.fitBounds(bounds, {
          padding: 56,
          maxZoom: 10,
          duration: 700
        });
      }
    }

    function syncWhenReady() {
      if (cancelled) {
        return;
      }

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
  }, [points]);

  return <div ref={containerRef} className="maplibre-panel" />;
}
