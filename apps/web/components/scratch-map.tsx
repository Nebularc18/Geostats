"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import {
  boundaryConfigForLevel,
  countryNamesForBoundary,
  COUNTRY_GEOJSON_URL,
  SWEDEN_COUNTY_GEOJSON_URL,
  SWEDEN_REGION_GEOJSON_URL,
  type ScratchBoundaryConfig
} from "../lib/scratch-boundary-config";

export interface ScratchLocationBucket {
  name: string;
  count: number;
}

export interface ScratchCountryBucket extends ScratchLocationBucket {
  continent: string;
  regions: ScratchLocationBucket[];
  counties: ScratchLocationBucket[];
}

export interface ScratchMapData {
  totalFinds: number;
  truncated: boolean;
  limit: number;
  continents: ScratchLocationBucket[];
  countries: ScratchCountryBucket[];
  maxCountryCount: number;
}

export type ScratchMapLevel = "countries" | "regions" | "counties";
export type ScratchMapView = string;

const COUNTRY_SOURCE_ID = "scratch-countries";
const COUNTRY_FILL_LAYER_ID = "scratch-country-fills";
const COUNTRY_HIT_LAYER_ID = "scratch-country-hit-targets";
const COUNTRY_LINE_LAYER_ID = "scratch-country-lines";
const COUNTRY_SELECTED_LINE_LAYER_ID = "scratch-selected-country";
const COUNTRY_NAME_PROPERTY = "name";
export { SWEDEN_COUNTY_GEOJSON_URL, SWEDEN_REGION_GEOJSON_URL };

type GeoJsonFeature = {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: GeoJSON.Geometry;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type ResolvedBoundaryConfig = {
  level: ScratchMapLevel;
  selectedCountry: string | null;
  config: ScratchBoundaryConfig;
};

type Position = [number, number];

const geoJsonCache = new Map<string, Promise<GeoJsonFeatureCollection>>();

const scratchStyle: StyleSpecification = {
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
        "raster-brightness-max": 0.74,
        "raster-brightness-min": 0.18,
        "raster-saturation": -0.55,
        "raster-contrast": 0.08
      }
    }
  ]
};

const countryBoundaryConfig: ScratchBoundaryConfig = {
  url: COUNTRY_GEOJSON_URL,
  propertyName: COUNTRY_NAME_PROPERTY,
  center: [11, 24],
  zoom: 1.22,
  isDetail: false
};

function mixColor(start: string, end: string, amount: number) {
  const normalized = Math.max(0, Math.min(1, amount));
  const startRgb = start.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const endRgb = end.match(/\w\w/g)?.map((part) => Number.parseInt(part, 16)) ?? [0, 0, 0];
  const mixed = startRgb.map((channel, index) =>
    Math.round(channel + ((endRgb[index] ?? channel) - channel) * normalized)
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function scratchColor(count: number, max: number) {
  if (count <= 0 || max <= 0) {
    return "rgba(237, 244, 232, 0.1)";
  }

  const intensity = Math.log1p(count) / Math.log1p(max);
  return mixColor("#dce88d", "#1f6f3b", intensity);
}

function countryNamesFor(bucket: ScratchCountryBucket) {
  return countryNamesForBoundary(bucket.name);
}

function namesForBucket(bucket: ScratchLocationBucket, level: ScratchMapLevel) {
  if (level === "countries") {
    return countryNamesFor(bucket as ScratchCountryBucket);
  }

  return [bucket.name];
}

function fillExpression(
  buckets: ScratchLocationBucket[],
  max: number,
  propertyName: string,
  level: ScratchMapLevel
): ExpressionSpecification {
  const pairs = buckets.flatMap((bucket) =>
    namesForBucket(bucket, level).flatMap((name) => [name, scratchColor(bucket.count, max)])
  );

  if (pairs.length === 0) {
    return "rgba(237, 244, 232, 0.06)" as unknown as ExpressionSpecification;
  }

  return ["match", ["get", propertyName], ...pairs, "rgba(237, 244, 232, 0.06)"] as unknown as ExpressionSpecification;
}

function selectedFeatureFilter(featureName: string | null, propertyName: string, level: ScratchMapLevel) {
  if (!featureName) {
    return ["==", ["get", propertyName], ""] as maplibregl.FilterSpecification;
  }

  const names = level === "countries" ? countryNamesForBoundary(featureName) : [featureName];
  return ["in", ["get", propertyName], ["literal", names]] as maplibregl.FilterSpecification;
}

function isDetailLevel(level: ScratchMapLevel) {
  return level === "regions" || level === "counties";
}

function bucketForFeature(
  featureName: string,
  buckets: ScratchLocationBucket[],
  level: ScratchMapLevel
) {
  return buckets.find((candidate) => namesForBucket(candidate, level).includes(featureName)) ?? null;
}

function hitTestLayer(map: maplibregl.Map) {
  return map.getLayer(COUNTRY_HIT_LAYER_ID) ? COUNTRY_HIT_LAYER_ID : COUNTRY_FILL_LAYER_ID;
}

function polygonAreaAndCentroid(ring: Position[]) {
  let doubleArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let index = 0; index < ring.length - 1; index += 1) {
    const [currentX, currentY] = ring[index] ?? [0, 0];
    const [nextX, nextY] = ring[index + 1] ?? [0, 0];
    const cross = currentX * nextY - nextX * currentY;
    doubleArea += cross;
    centroidX += (currentX + nextX) * cross;
    centroidY += (currentY + nextY) * cross;
  }

  if (doubleArea === 0) {
    return null;
  }

  return {
    area: Math.abs(doubleArea / 2),
    center: [centroidX / (3 * doubleArea), centroidY / (3 * doubleArea)] as [number, number]
  };
}

function longitudeNear(longitude: number, reference: number) {
  let adjusted = longitude;
  while (adjusted - reference > 180) {
    adjusted -= 360;
  }
  while (adjusted - reference < -180) {
    adjusted += 360;
  }
  return adjusted;
}

function unwrapRing(ring: Position[]) {
  if (ring.length === 0) {
    return ring;
  }

  const unwrapped: Position[] = [[ring[0]![0], ring[0]![1]]];
  ring.slice(1).forEach(([longitude, latitude]) => {
    const previousLongitude = unwrapped.at(-1)?.[0] ?? longitude;
    unwrapped.push([longitudeNear(longitude, previousLongitude), latitude]);
  });
  return unwrapped;
}

function outerRingsFromFeatures(features: GeoJsonFeature[]) {
  return features.flatMap((feature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.type === "MultiPolygon"
          ? feature.geometry.coordinates
          : [];

    return polygons
      .map((polygon) => polygon[0] as Position[] | undefined)
      .filter((ring): ring is Position[] => Boolean(ring && ring.length > 2))
      .map(unwrapRing);
  });
}

function focusedBoundsFromFeatures(features: GeoJsonFeature[]) {
  const bounds = new maplibregl.LngLatBounds();
  const polygons = outerRingsFromFeatures(features)
    .map((ring) => ({ ring, centroid: polygonAreaAndCentroid(ring) }))
    .filter(
      (polygon): polygon is { ring: Position[]; centroid: { area: number; center: [number, number] } } =>
        polygon.centroid !== null
    );
  const largest = polygons.reduce<(typeof polygons)[number] | null>(
    (current, polygon) => (!current || polygon.centroid.area > current.centroid.area ? polygon : current),
    null
  );

  if (!largest) {
    return bounds;
  }

  // Tiny overseas territories can make a country appear world-wide. Keep the
  // meaningful landmasses and unwrap nearby islands around the largest one.
  const minimumArea = largest.centroid.area * 0.005;
  polygons
    .filter((polygon) => polygon.centroid.area >= minimumArea)
    .forEach(({ ring }) => {
      ring.forEach(([longitude, latitude]) => {
        bounds.extend([longitudeNear(longitude, largest.centroid.center[0]), latitude]);
      });
    });

  return bounds;
}

function centerFromFeatureGeometry(features: GeoJsonFeature[]) {
  let bestArea = 0;
  let bestCenter: [number, number] | null = null;
  const bounds = new maplibregl.LngLatBounds();

  features.forEach((feature) => {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.type === "MultiPolygon"
          ? feature.geometry.coordinates
          : [];

    polygons.forEach((polygon) => {
      const outerRing = polygon[0] as Position[] | undefined;
      if (!outerRing) {
        return;
      }

      outerRing.forEach((coordinate) => bounds.extend(coordinate));
      const centroid = polygonAreaAndCentroid(outerRing);
      if (centroid && centroid.area > bestArea) {
        bestArea = centroid.area;
        bestCenter = centroid.center;
      }
    });
  });

  if (bestCenter) {
    return bestCenter;
  }

  if (!bounds.isEmpty()) {
    const center = bounds.getCenter();
    return [center.lng, center.lat] as [number, number];
  }

  return null;
}

const VIEW_CONFIG: Record<string, { center: [number, number]; zoom: number }> = {
  world: { center: [11, 24], zoom: 1.22 },
  Africa: { center: [19, 2], zoom: 2.45 },
  Antarctica: { center: [0, -82], zoom: 1.75 },
  Asia: { center: [89, 34], zoom: 2.05 },
  Europe: { center: [16, 54], zoom: 2.75 },
  "North America": { center: [-101, 46], zoom: 2.25 },
  Oceania: { center: [139, -24], zoom: 2.55 },
  "South America": { center: [-60, -18], zoom: 2.45 }
};

function loadGeoJson(url: string) {
  const existing = geoJsonCache.get(url);
  if (existing) {
    return existing;
  }

  const request = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load map boundary data from ${url}`);
      }
      return (await response.json()) as GeoJsonFeatureCollection;
    })
    .catch((error: unknown) => {
      geoJsonCache.delete(url);
      throw error;
    });
  geoJsonCache.set(url, request);
  return request;
}

export function ScratchMap({
  countries,
  activeCountry,
  countryFocusVersion,
  level,
  maxCountryCount,
  view,
  viewFocusVersion,
  selectedCountry,
  onSelectCountry,
  onUserMove
}: {
  countries: ScratchCountryBucket[];
  activeCountry: ScratchCountryBucket | null;
  countryFocusVersion: number;
  level: ScratchMapLevel;
  maxCountryCount: number;
  view: ScratchMapView | null;
  viewFocusVersion: number;
  selectedCountry: string | null;
  onSelectCountry: (country: string) => void;
  onUserMove: () => void;
}) {
  const [resolvedBoundaryConfig, setResolvedBoundaryConfig] = useState<ResolvedBoundaryConfig>({
    level: "countries",
    selectedCountry: null,
    config: countryBoundaryConfig
  });
  const boundaryConfig = resolvedBoundaryConfig.config;
  const boundaryConfigIsCurrent =
    resolvedBoundaryConfig.level === level && resolvedBoundaryConfig.selectedCountry === selectedCountry;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const bucketsRef = useRef<ScratchLocationBucket[]>(countries);
  const levelRef = useRef<ScratchMapLevel>(level);
  const propertyNameRef = useRef(COUNTRY_NAME_PROPERTY);
  const sourceUrlRef = useRef(COUNTRY_GEOJSON_URL);
  const handledCountryFocusVersionRef = useRef(0);
  const supportsEmptyFeaturePopupRef = useRef(false);
  const popupLocationCacheRef = useRef(new Map<string, [number, number]>());

  useEffect(() => {
    void loadGeoJson(COUNTRY_GEOJSON_URL);
    void loadGeoJson(SWEDEN_REGION_GEOJSON_URL);
    void loadGeoJson(SWEDEN_COUNTY_GEOJSON_URL);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void boundaryConfigForLevel(level, selectedCountry).then((config) => {
      if (!cancelled) {
        setResolvedBoundaryConfig({ level, selectedCountry, config });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [level, selectedCountry]);

  useEffect(() => {
    if (!boundaryConfigIsCurrent) {
      return;
    }

    const interactionLevel = boundaryConfig.isDetail ? level : "countries";
    if (level === "regions" && boundaryConfig.isDetail) {
      bucketsRef.current = activeCountry?.regions ?? [];
    } else if (level === "counties" && boundaryConfig.isDetail) {
      bucketsRef.current = activeCountry?.counties ?? [];
    } else {
      bucketsRef.current = countries;
    }
    levelRef.current = interactionLevel;
    propertyNameRef.current = boundaryConfig.propertyName;
    sourceUrlRef.current = boundaryConfig.url;
    supportsEmptyFeaturePopupRef.current = isDetailLevel(level) && boundaryConfig.isDetail;
  }, [activeCountry, boundaryConfig, boundaryConfigIsCurrent, countries, level, selectedCountry]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: scratchStyle,
      center: [11, 24],
      zoom: 1.22,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const clearMapView = () => onUserMove();
    const clearMapViewOnZoom = (event: maplibregl.MapLibreEvent) => {
      if (event.originalEvent) {
        onUserMove();
      }
    };

    map.on("dragstart", clearMapView);
    map.on("zoomstart", clearMapViewOnZoom);
    map.on("rotatestart", clearMapView);
    map.on("pitchstart", clearMapView);

    map.on("click", async (event) => {
      if (!map.getLayer(COUNTRY_FILL_LAYER_ID)) {
        return;
      }

      const [feature] = map.queryRenderedFeatures(event.point, { layers: [hitTestLayer(map)] });
      const featureName = String(feature?.properties?.[propertyNameRef.current] ?? "").trim();
      if (!feature || !featureName) {
        return;
      }

      const bucket = bucketForFeature(featureName, bucketsRef.current, levelRef.current);
      if (!bucket && !supportsEmptyFeaturePopupRef.current) {
        return;
      }
      const location = bucket ?? { name: featureName, count: 0 };

      if (levelRef.current === "countries") {
        onSelectCountry(location.name);
      }

      const popupCacheKey = `${sourceUrlRef.current}:${propertyNameRef.current}:${featureName}`;
      let popupLocation = popupLocationCacheRef.current.get(popupCacheKey) ?? null;
      if (!popupLocation) {
        const geoJson = await loadGeoJson(sourceUrlRef.current);
        const matchingFeatures = geoJson.features.filter(
          (candidate) => String(candidate.properties?.[propertyNameRef.current] ?? "").trim() === featureName
        );
        popupLocation = centerFromFeatureGeometry(matchingFeatures);
        if (popupLocation) {
          popupLocationCacheRef.current.set(popupCacheKey, popupLocation);
        }
      }
      if (!popupLocation) {
        return;
      }

      const popupContent = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = location.name;
      const count = document.createElement("div");
      count.textContent = `${location.count} finds`;
      popupContent.append(name, count);

      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ offset: 10 })
        .setLngLat(popupLocation)
        .setDOMContent(popupContent)
        .addTo(map);
    });

    map.on("mousemove", (event) => {
      if (!map.getLayer(COUNTRY_FILL_LAYER_ID)) {
        map.getCanvas().style.cursor = "";
        return;
      }

      const [feature] = map.queryRenderedFeatures(event.point, { layers: [hitTestLayer(map)] });
      const featureName = String(feature?.properties?.[propertyNameRef.current] ?? "").trim();
      const bucket = featureName ? bucketForFeature(featureName, bucketsRef.current, levelRef.current) : null;
      map.getCanvas().style.cursor = bucket || (featureName && supportsEmptyFeaturePopupRef.current) ? "pointer" : "";
    });

    mapRef.current = map;

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.off("dragstart", clearMapView);
      map.off("zoomstart", clearMapViewOnZoom);
      map.off("rotatestart", clearMapView);
      map.off("pitchstart", clearMapView);
      map.remove();
      mapRef.current = null;
    };
  }, [onSelectCountry, onUserMove]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !boundaryConfigIsCurrent) {
      return;
    }
    const activeMap = map;
    let cancelled = false;
    const config = boundaryConfig;
    const interactionLevel = config.isDetail ? level : "countries";
    const isSupportedDetailLevel = boundaryConfig.isDetail && (level === "regions" || level === "counties");
    const buckets =
      level === "regions" && boundaryConfig.isDetail
        ? (activeCountry?.regions ?? [])
        : level === "counties" && boundaryConfig.isDetail
          ? (activeCountry?.counties ?? [])
          : countries;
    const maxCount =
      level === "regions" && boundaryConfig.isDetail
        ? Math.max(0, ...buckets.map((bucket) => bucket.count))
        : level === "counties" && boundaryConfig.isDetail
          ? Math.max(0, ...buckets.map((bucket) => bucket.count))
          : maxCountryCount;
    const selectedFeatureName = isSupportedDetailLevel ? null : selectedCountry;

    function focusDetailBoundaries() {
      if (!isSupportedDetailLevel) {
        return;
      }

      void loadGeoJson(config.url).then((geoJson) => {
        if (cancelled || geoJson.features.length === 0) {
          return;
        }

        const bounds = focusedBoundsFromFeatures(geoJson.features);

        if (!bounds.isEmpty()) {
          activeMap.fitBounds(bounds, { padding: 42, maxZoom: 6.1, duration: 600 });
        }
      });
    }

    function syncLayers() {
      if (cancelled || !map) {
        return;
      }

      if (!map.isStyleLoaded()) {
        window.setTimeout(syncLayers, 50);
        return;
      }

      if (!map.getSource(COUNTRY_SOURCE_ID)) {
        map.addSource(COUNTRY_SOURCE_ID, {
          type: "geojson",
          data: config.url
        });

        map.addLayer({
          id: COUNTRY_FILL_LAYER_ID,
          type: "fill",
          source: COUNTRY_SOURCE_ID,
          paint: {
            "fill-color": fillExpression(buckets, maxCount, config.propertyName, interactionLevel),
            "fill-opacity": 0.82
          }
        });

        map.addLayer({
          id: COUNTRY_HIT_LAYER_ID,
          type: "fill",
          source: COUNTRY_SOURCE_ID,
          paint: {
            "fill-color": "#000000",
            "fill-opacity": 0.01
          }
        });

        map.addLayer({
          id: COUNTRY_LINE_LAYER_ID,
          type: "line",
          source: COUNTRY_SOURCE_ID,
          paint: {
            "line-color": "rgba(7, 17, 11, 0.72)",
            "line-width": 0.65
          }
        });

        map.addLayer({
          id: COUNTRY_SELECTED_LINE_LAYER_ID,
          type: "line",
          source: COUNTRY_SOURCE_ID,
          filter: selectedFeatureFilter(selectedFeatureName, config.propertyName, interactionLevel),
          paint: {
            "line-color": "#fff7de",
            "line-width": 2.5
          }
        });
        focusDetailBoundaries();
      } else {
        const source = map.getSource(COUNTRY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData(config.url);
        map.setPaintProperty(
          COUNTRY_FILL_LAYER_ID,
          "fill-color",
          fillExpression(buckets, maxCount, config.propertyName, interactionLevel)
        );
        map.setFilter(
          COUNTRY_SELECTED_LINE_LAYER_ID,
          selectedFeatureFilter(selectedFeatureName, config.propertyName, interactionLevel)
        );
        focusDetailBoundaries();
      }
    }

    syncLayers();

    return () => {
      cancelled = true;
    };
  }, [activeCountry, boundaryConfig, boundaryConfigIsCurrent, countries, level, maxCountryCount, selectedCountry]);

  useEffect(() => {
    const map = mapRef.current;
    const country = selectedCountry;
    if (!map || !country || countryFocusVersion === 0) {
      return;
    }
    if (!boundaryConfigIsCurrent || handledCountryFocusVersionRef.current === countryFocusVersion) {
      return;
    }
    const activeMap = map;
    let cancelled = false;

    const currentLevel = levelRef.current;
    const config = boundaryConfig;
    if (config.isDetail && (currentLevel === "regions" || currentLevel === "counties")) {
      void loadGeoJson(config.url).then((geoJson) => {
        if (cancelled || geoJson.features.length === 0) {
          return;
        }

        const bounds = focusedBoundsFromFeatures(geoJson.features);

        if (!bounds.isEmpty()) {
          activeMap.fitBounds(bounds, { padding: 42, maxZoom: 6.1, duration: 600 });
          handledCountryFocusVersionRef.current = countryFocusVersion;
        }
      });

      return () => {
        cancelled = true;
      };
    }

    void loadGeoJson(COUNTRY_GEOJSON_URL).then((geoJson) => {
      if (cancelled) {
        return;
      }

      const names = countryNamesForBoundary(country);
      const features = geoJson.features.filter((feature) =>
        names.includes(String(feature.properties?.[COUNTRY_NAME_PROPERTY] ?? ""))
      );
      if (features.length === 0) {
        return;
      }

      const bounds = focusedBoundsFromFeatures(features);

      if (!bounds.isEmpty()) {
        activeMap.fitBounds(bounds, { padding: 46, maxZoom: 5.4, duration: 600 });
        handledCountryFocusVersionRef.current = countryFocusVersion;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [boundaryConfig, boundaryConfigIsCurrent, countryFocusVersion, selectedCountry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (!view) {
      return;
    }

    const config = VIEW_CONFIG[view] ?? VIEW_CONFIG.world!;
    map.easeTo({ center: config.center, zoom: config.zoom, duration: 600 });
  }, [view, viewFocusVersion]);

  return <div ref={containerRef} className="maplibre-panel scratch-map-panel" />;
}
