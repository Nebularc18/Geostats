"use client";

import { useEffect, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { boundsFor, isValidMapPoint } from "../lib/map-bounds";
import { osmRasterStyle } from "./cache-map";

export type TrackableMapPoint = {
  id: string;
  trackableId: string;
  trackingCode: string;
  name: string;
  logType: string;
  loggedAt: string;
  dateEstimated: boolean;
  sequence: number;
  sequenceTotal: number;
  gcCode: string | null;
  cacheName: string | null;
  locationName: string | null;
  holderName: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
};

const ROUTE_SOURCE_ID = "trackable-routes";
const POINT_SOURCE_ID = "trackable-points";
const ROUTE_CASING_LAYER_ID = "trackable-route-casing";
const ROUTE_LAYER_ID = "trackable-routes";
const ROUTE_ARROW_LAYER_ID = "trackable-route-arrows";
const POINT_SHADOW_LAYER_ID = "trackable-point-shadows";
const POINT_LAYER_ID = "trackable-points";
const POINT_LABEL_LAYER_ID = "trackable-point-labels";
const POINT_CLUSTER_LAYER_ID = "trackable-point-clusters";
const POINT_CLUSTER_COUNT_LAYER_ID = "trackable-point-cluster-count";
const ENDPOINT_SOURCE_ID = "trackable-endpoints";
const ENDPOINT_SHADOW_LAYER_ID = "trackable-endpoint-shadows";
const ENDPOINT_LAYER_ID = "trackable-endpoints";
const ENDPOINT_LABEL_LAYER_ID = "trackable-endpoint-labels";

const pointColor = [
  "match",
  ["get", "logType"],
  "DROPPED",
  "#f5a623",
  "VISITED",
  "#4ca64c",
  "DISCOVERED",
  "#337ab7",
  "RETRIEVED",
  "#d9468f",
  "GRABBED",
  "#d9468f",
  "MISSING",
  "#c44f4f",
  "#6f7f73"
] as unknown as maplibregl.ExpressionSpecification;

const routeProgressColor = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "#52d2a1",
  0.45,
  "#58a4e8",
  0.75,
  "#a17bd5",
  1,
  "#f07b73"
] as unknown as maplibregl.ExpressionSpecification;

type PointFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Record<string, string>;
  }>;
};

type RouteFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "LineString"; coordinates: Array<[number, number]> };
    properties: { trackableId: string; trackingCode: string };
  }>;
};

type EndpointFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Record<string, string>;
  }>;
};

function pointProperties(point: TrackableMapPoint, highlighted = false): Record<string, string> {
  return {
    id: point.id,
    trackableId: point.trackableId,
    trackingCode: point.trackingCode,
    name: point.name,
    logType: point.logType,
    loggedAt: point.loggedAt,
    dateEstimated: point.dateEstimated ? "true" : "false",
    sequence: String(point.sequence),
    sequenceTotal: String(point.sequenceTotal),
    gcCode: point.gcCode ?? "",
    cacheName: point.cacheName ?? "",
    locationName: point.locationName ?? "",
    holderName: point.holderName ?? "",
    notes: point.notes ?? "",
    highlighted: highlighted ? "true" : "false"
  };
}

function pointFeatures(points: TrackableMapPoint[], highlightedPointIds: Set<string>): PointFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.filter((point) => isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN })).map((point) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [point.longitude!, point.latitude!] },
      properties: pointProperties(point, highlightedPointIds.has(point.id))
    }))
  };
}

function endpointFeatures(points: TrackableMapPoint[]): EndpointFeatureCollection {
  const groups = new Map<string, TrackableMapPoint[]>();
  for (const point of points) {
    if (!isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN })) continue;
    const group = groups.get(point.trackableId);
    if (group) group.push(point);
    else groups.set(point.trackableId, [point]);
  }
  const features: EndpointFeatureCollection["features"] = [];
  for (const entries of groups.values()) {
    const ordered = [...entries].sort((left, right) => left.sequence - right.sequence || Date.parse(left.loggedAt) - Date.parse(right.loggedAt));
    const first = ordered[0];
    const last = ordered.at(-1);
    if (!first) continue;
    const endpoints = first.id === last?.id ? [{ point: first, kind: "START / END" }] : [{ point: first, kind: "START" }, { point: last!, kind: "END" }];
    for (const endpoint of endpoints) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [endpoint.point.longitude!, endpoint.point.latitude!] },
        properties: { ...pointProperties(endpoint.point), endpoint: endpoint.kind, endpointLabel: endpoint.kind === "START / END" ? "S/E" : endpoint.kind[0]! }
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function routeFeatures(points: TrackableMapPoint[]): RouteFeatureCollection {
  const groups = new Map<string, TrackableMapPoint[]>();
  for (const point of points) {
    const group = groups.get(point.trackableId);
    if (group) group.push(point);
    else groups.set(point.trackableId, [point]);
  }
  const features: RouteFeatureCollection["features"] = [];
  for (const [trackableId, entries] of groups) {
    const ordered = [...entries].sort((left, right) => left.sequence - right.sequence || Date.parse(left.loggedAt) - Date.parse(right.loggedAt));
    let segment: TrackableMapPoint[] = [];
    const addSegment = () => {
      if (segment.length > 1) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: segment.map((point) => [point.longitude!, point.latitude!] as [number, number]) },
          properties: { trackableId, trackingCode: segment[0]?.trackingCode ?? "" }
        });
      }
      segment = [];
    };
    for (const point of ordered) {
      if (isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN })) segment.push(point);
      else addSegment();
    }
    addSegment();
  }
  return { type: "FeatureCollection", features };
}

function showTrackablePopup(
  map: maplibregl.Map,
  popupRef: { current: maplibregl.Popup | null },
  properties: Record<string, unknown>,
  coordinates: [number, number]
) {
  const content = document.createElement("div");
  content.className = "trackable-popup";
  const title = document.createElement("strong");
  title.className = "trackable-popup-title";
  const endpoint = String(properties.endpoint ?? "");
  const trackingCode = String(properties.trackingCode ?? "");
  const logType = String(properties.logType ?? "");
  title.textContent = endpoint ? `${endpoint} · ${trackingCode}` : `${trackingCode} · ${logType}`;
  const sequence = document.createElement("div");
  sequence.className = "trackable-popup-sequence";
  sequence.textContent = `Stop ${String(properties.sequence ?? "?")} of ${String(properties.sequenceTotal ?? "?")}`;
  const location = document.createElement("div");
  location.className = "trackable-popup-location";
  const cacheCode = String(properties.gcCode ?? "").trim();
  const cacheName = String(properties.cacheName ?? "").trim();
  const locationName = String(properties.locationName ?? "").trim();
  const namedCache = cacheName && (!cacheCode || cacheName.toUpperCase() !== cacheCode.toUpperCase());
  const namedLocation = !namedCache && locationName && (!cacheCode || locationName.toUpperCase() !== cacheCode.toUpperCase());
  const displayName = namedCache ? cacheName : namedLocation ? locationName : "";
  location.textContent = displayName
    ? cacheCode ? `${displayName} · ${cacheCode}` : displayName
    : cacheCode || "Cache name unavailable";
  const date = document.createElement("small");
  date.className = "trackable-popup-date";
  const timestamp = Date.parse(String(properties.loggedAt ?? ""));
  date.textContent = String(properties.dateEstimated) === "true"
    ? "Date not supplied by KML (file order shown)"
    : Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString() : "";
  const notes = document.createElement("small");
  notes.className = "trackable-popup-notes";
  notes.textContent = String(properties.notes ?? "");
  content.append(title, sequence, location, date);
  if (notes.textContent) content.append(notes);
  popupRef.current?.remove();
  popupRef.current = new maplibregl.Popup({ offset: 14 })
    .setLngLat(coordinates)
    .setDOMContent(content)
    .addTo(map);
}

export type TrackableMapProps = {
  points: TrackableMapPoint[];
  focusPointId?: string | null;
  highlightPointIds?: string[];
  onPointSelect?: (pointId: string) => void;
};

export function TrackableMap({ points, focusPointId = null, highlightPointIds = [], onPointSelect }: TrackableMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pointsRef = useRef<TrackableMapPoint[] | null>(null);
  const onPointSelectRef = useRef(onPointSelect);

  useEffect(() => {
    onPointSelectRef.current = onPointSelect;
  }, [onPointSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
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
      if (!map.getSource(POINT_SOURCE_ID)) return;
      const [cluster] = map.getLayer(POINT_CLUSTER_LAYER_ID)
        ? map.queryRenderedFeatures(event.point, { layers: [POINT_CLUSTER_LAYER_ID] })
        : [];
      if (cluster?.properties) {
        const coordinates = cluster.geometry.type === "Point" ? cluster.geometry.coordinates as number[] : [];
        const clusterId = Number(cluster.properties.cluster_id);
        const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource;
        if (coordinates.length >= 2 && Number.isFinite(clusterId)) {
          void pointSource.getClusterExpansionZoom(clusterId)
            .then((zoom) => map.easeTo({ center: [Number(coordinates[0]), Number(coordinates[1])], zoom: Math.min(zoom + 0.5, 16), duration: 500 }))
            .catch(() => undefined);
        }
        return;
      }
      const [endpoint, point] = [
        map.getLayer(ENDPOINT_LAYER_ID) ? map.queryRenderedFeatures(event.point, { layers: [ENDPOINT_LAYER_ID] })[0] : undefined,
        map.getLayer(POINT_LAYER_ID) ? map.queryRenderedFeatures(event.point, { layers: [POINT_LAYER_ID] })[0] : undefined
      ];
      const feature = endpoint ?? point;
      if (!feature?.properties) return;
      const coordinates = feature.geometry.type === "Point" ? feature.geometry.coordinates as number[] : [];
      if (coordinates.length < 2) return;
      const properties = feature.properties as Record<string, unknown>;
      showTrackablePopup(map, popupRef, properties, [Number(coordinates[0]), Number(coordinates[1])]);
      const pointId = String(properties.id ?? "");
      if (pointId) onPointSelectRef.current?.(pointId);
    });
    map.on("mousemove", (event) => {
      const layers = [POINT_CLUSTER_LAYER_ID, ENDPOINT_LAYER_ID, POINT_LAYER_ID].filter((id) => Boolean(map.getLayer(id)));
      map.getCanvas().style.cursor = layers.length > 0 && map.queryRenderedFeatures(event.point, { layers }).length > 0 ? "pointer" : "";
    });
    mapRef.current = map;
    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      pointsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      if (!map.isStyleLoaded()) {
        window.setTimeout(sync, 50);
        return;
      }
      const pointsChanged = pointsRef.current !== points;
      const pointData = pointFeatures(points, new Set(highlightPointIds));
      const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
      const routeSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;
      const endpointSource = map.getSource(ENDPOINT_SOURCE_ID) as GeoJSONSource | undefined;
      if (routeSource) {
        if (pointsChanged) routeSource.setData(routeFeatures(points));
      } else {
        const routeData = routeFeatures(points);
        map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeData, lineMetrics: true });
        map.addLayer({ id: ROUTE_CASING_LAYER_ID, type: "line", source: ROUTE_SOURCE_ID, paint: { "line-color": "#10251b", "line-width": 9, "line-opacity": 0.9, "line-blur": 0.2 } });
        map.addLayer({ id: ROUTE_LAYER_ID, type: "line", source: ROUTE_SOURCE_ID, paint: { "line-gradient": routeProgressColor, "line-width": 4.5, "line-opacity": 0.98 } });
        map.addLayer({
          id: ROUTE_ARROW_LAYER_ID,
          type: "symbol",
          source: ROUTE_SOURCE_ID,
          minzoom: 5,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 120,
            "text-field": "▶",
            "text-font": ["Open Sans Regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 10, 14, 16, 18],
            "text-keep-upright": false,
            "text-allow-overlap": true
          },
          paint: { "text-color": "#f6f8ff", "text-halo-color": "#10251b", "text-halo-width": 1.5, "text-opacity": 0.95 }
        });
      }
      if (pointSource) pointSource.setData(pointData);
      else {
        map.addSource(POINT_SOURCE_ID, { type: "geojson", data: pointData, cluster: true, clusterMaxZoom: 9, clusterRadius: 45 });
        map.addLayer({ id: POINT_SHADOW_LAYER_ID, type: "circle", source: POINT_SOURCE_ID, filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 8, "circle-color": "rgba(7, 17, 11, 0.82)", "circle-blur": 0.15 } });
        map.addLayer({ id: POINT_LAYER_ID, type: "circle", source: POINT_SOURCE_ID, filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["case", ["==", ["get", "highlighted"], "true"], 10, 7], "circle-color": pointColor, "circle-stroke-color": ["case", ["==", ["get", "highlighted"], "true"], "#65d995", "#fffdf0"] as unknown as maplibregl.ExpressionSpecification, "circle-stroke-width": ["case", ["==", ["get", "highlighted"], "true"], 3, 2], "circle-opacity": 0.98 } });
        map.addLayer({
          id: POINT_CLUSTER_LAYER_ID,
          type: "circle",
          source: POINT_SOURCE_ID,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": ["step", ["get", "point_count"], "#65d995", 25, "#f5c84b", 100, "#e08363"] as unknown as maplibregl.ExpressionSpecification,
            "circle-radius": ["step", ["get", "point_count"], 16, 25, 20, 100, 26],
            "circle-stroke-color": "#10251b",
            "circle-stroke-width": 2
          }
        });
        map.addLayer({
          id: POINT_CLUSTER_COUNT_LAYER_ID,
          type: "symbol",
          source: POINT_SOURCE_ID,
          filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Regular"], "text-size": 12 },
          paint: { "text-color": "#10251b", "text-halo-color": "#fffdf0", "text-halo-width": 1 }
        });
        map.addLayer({
          id: POINT_LABEL_LAYER_ID,
          type: "symbol",
          source: POINT_SOURCE_ID,
          minzoom: 9,
          filter: ["!", ["has", "point_count"]],
          layout: {
            "text-field": ["get", "sequence"],
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 9, 12, 12, 14, 16, 16],
            "text-anchor": "bottom",
            "text-offset": [0, -0.45],
            "text-padding": 3,
            "text-allow-overlap": false,
            "text-ignore-placement": false
          },
          paint: {
            "text-color": "#fffdf0",
            "text-halo-color": "#10251b",
            "text-halo-width": 3,
            "text-halo-blur": 0.05,
            "text-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.95, 10, 1]
          }
        });
      }
      if (endpointSource) {
        if (pointsChanged) endpointSource.setData(endpointFeatures(points));
      } else {
        const endpointData = endpointFeatures(points);
        map.addSource(ENDPOINT_SOURCE_ID, { type: "geojson", data: endpointData });
        map.addLayer({ id: ENDPOINT_SHADOW_LAYER_ID, type: "circle", source: ENDPOINT_SOURCE_ID, paint: { "circle-radius": 13, "circle-translate": [14, -14], "circle-color": "rgba(7, 17, 11, 0.86)", "circle-blur": 0.1 } });
        map.addLayer({ id: ENDPOINT_LAYER_ID, type: "circle", source: ENDPOINT_SOURCE_ID, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 8, 10, 11, 16, 13], "circle-translate": [14, -14], "circle-color": ["match", ["get", "endpoint"], "START", "#65d995", "END", "#ff927d", "#ffe033"] as unknown as maplibregl.ExpressionSpecification, "circle-stroke-color": "#fffdf0", "circle-stroke-width": 2.5 } });
        map.addLayer({ id: ENDPOINT_LABEL_LAYER_ID, type: "symbol", source: ENDPOINT_SOURCE_ID, layout: { "text-field": ["get", "endpointLabel"], "text-font": ["Open Sans Regular"], "text-size": 10, "text-allow-overlap": true }, paint: { "text-color": "#10251b", "text-halo-color": "#fffdf0", "text-halo-width": 1, "text-translate": [14, -14] } });
      }
      if (pointsChanged) {
        const validPoints = points.filter((point) => isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN }));
        const bounds = boundsFor(validPoints.map((point) => ({ latitude: point.latitude!, longitude: point.longitude! })));
        if (bounds) map.fitBounds(bounds, { padding: 56, maxZoom: 10, duration: 700 });
      }
      pointsRef.current = points;
    };
    sync();
    return () => {
      cancelled = true;
    };
  }, [highlightPointIds, points]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPointId) return;
    const point = points.find((candidate) => candidate.id === focusPointId);
    if (!point || !isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN })) return;
    let cancelled = false;
    let fallbackTimer: number | undefined;
    const focus = () => {
      if (cancelled) return;
      const coordinates: [number, number] = [point.longitude!, point.latitude!];
      let shown = false;
      const show = () => {
        if (cancelled || shown) return;
        shown = true;
        showTrackablePopup(map, popupRef, pointProperties(point), coordinates);
      };
      map.once("moveend", show);
      map.flyTo({ center: coordinates, zoom: Math.min(Math.max(map.getZoom(), 12), 16), duration: 650 });
      fallbackTimer = window.setTimeout(show, 900);
    };
    if (map.isStyleLoaded()) focus();
    else fallbackTimer = window.setTimeout(focus, 100);
    return () => {
      cancelled = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [focusPointId, points]);

  return <div ref={containerRef} className="maplibre-panel" />;
}
