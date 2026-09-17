"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { boundsFor, isValidMapPoint } from "../lib/map-bounds";
import { journeyMapStyle } from "../lib/journey-map-style";

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
const SELECTION_SOURCE_ID = "trackable-selection";
const ROUTE_LAYER_ID = "trackable-routes";
const POINT_LABEL_LAYER_ID = "trackable-point-labels";
const selectionColor: maplibregl.ExpressionSpecification = [
  "match", ["get", "role"], "Previous", "#8854ad", "Next", "#16836b", "#e8a34c"
];


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
  showFullRoute?: boolean;
  points: TrackableMapPoint[];
  focusPointId?: string | null;
  highlightPointIds?: string[];
  onPointSelect?: (pointId: string) => void;
};

export function TrackableMap({ points, focusPointId = null, highlightPointIds = [], onPointSelect, showFullRoute = false }: TrackableMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pointsRef = useRef<TrackableMapPoint[] | null>(null);
  const onPointSelectRef = useRef(onPointSelect);
  const neighbours = useMemo(() => {
    const ordered = [...points].sort((a, b) => a.trackableId.localeCompare(b.trackableId) || a.sequence - b.sequence || Date.parse(a.loggedAt) - Date.parse(b.loggedAt));
    return new Map(ordered.map((point, index) => [
      point.id,
      ordered.slice(Math.max(0, index - 1), index + 2).filter((entry) => entry.trackableId === point.trackableId)
    ]));
  }, [points]);

  useEffect(() => {
    onPointSelectRef.current = onPointSelect;
  }, [onPointSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: journeyMapStyle,
      center: [15.5869, 56.1612],
      zoom: 5,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("click", (event) => {
      if (!map.getSource(POINT_SOURCE_ID)) return;
      const selected = map.getLayer("trackable-selected-stop") ? map.queryRenderedFeatures(event.point, { layers: ["trackable-selected-stop"] })[0] : undefined;
      if (selected?.properties?.id) {
        onPointSelectRef.current?.(String(selected.properties.id));
        return;
      }
      const feature = map.getLayer(POINT_LABEL_LAYER_ID) ? map.queryRenderedFeatures(event.point, { layers: [POINT_LABEL_LAYER_ID] })[0] : undefined;
      if (!feature?.properties) return;
      const coordinates = feature.geometry.type === "Point" ? feature.geometry.coordinates as number[] : [];
      if (coordinates.length < 2) return;
      const properties = feature.properties as Record<string, unknown>;
      const pointId = String(properties.id ?? "");
      if (pointId) onPointSelectRef.current?.(pointId);
    });
    map.on("mousemove", (event) => {
      const layers = [POINT_LABEL_LAYER_ID, "trackable-selected-stop"].filter((id) => Boolean(map.getLayer(id)));
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
      if (routeSource) {
        if (pointsChanged) routeSource.setData(routeFeatures(points));
      } else {
        const routeData = routeFeatures(points);
        map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeData });
        map.addLayer({ id: ROUTE_LAYER_ID, type: "line", source: ROUTE_SOURCE_ID, layout: { "visibility": "none", "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#527ee5", "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2, 7, 3, 12, 3], "line-opacity": 0.5 } });
      }
      if (pointSource) pointSource.setData(pointData);
      else {
        map.addSource(POINT_SOURCE_ID, { type: "geojson", data: pointData });
        // One shared, stretchable badge texture for every numbered stop.
        // Keep numbered stops at every zoom. Badge edges may overlap, while text
        // collision detection avoids drawing thousands of unreadable numbers.
        if (!map.hasImage("trackable-number-badge")) {
          const canvas = document.createElement("canvas");
          canvas.width = 24;
          canvas.height = 18;
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#292824";
          context.strokeStyle = "#a8a697";
          context.lineWidth = 1;
          context.beginPath();
          context.roundRect(0.5, 0.5, 23, 17, 2);
          context.fill();
          context.stroke();
          map.addImage("trackable-number-badge", context.getImageData(0, 0, 24, 18), {
            stretchX: [[3, 21]], stretchY: [[3, 15]], content: [1, 1, 23, 17]
          });
          context.fillStyle = "#246645";
          context.strokeStyle = "#87f3ae";
          context.fill();
          context.stroke();
          map.addImage("trackable-matched-badge", context.getImageData(0, 0, 24, 18), {
            stretchX: [[3, 21]], stretchY: [[3, 15]], content: [1, 1, 23, 17]
          });
        }
        map.addLayer({
          id: POINT_LABEL_LAYER_ID,
          type: "symbol",
          source: POINT_SOURCE_ID,
          layout: {
            "icon-image": ["case", ["==", ["get", "highlighted"], "true"], "trackable-matched-badge", "trackable-number-badge"],
            "icon-text-fit": "both",
            "icon-text-fit-padding": [1, 2, 1, 2],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "symbol-z-order": "viewport-y",
            "text-field": ["get", "sequence"],
            "text-font": ["Open Sans Regular"],
            "text-size": 11,
            "text-padding": 0,
            "text-allow-overlap": false,
            "text-ignore-placement": false
          },
          paint: {
            "text-color": "#fffdf0",
            "text-halo-color": "#10251b",
            "text-halo-width": 0,
            "text-halo-blur": 0.05,
            "text-opacity": 1
          }
        });
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
    if (!map) return;
    let timer: number | undefined;
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      if (!map.isStyleLoaded() || !map.getLayer(POINT_LABEL_LAYER_ID)) {
        timer = window.setTimeout(sync, 50);
        return;
      }
      const entries = focusPointId ? neighbours.get(focusPointId) ?? [] : [];
      const selected = entries.find((point) => point.id === focusPointId);
      const nearbyPoints = pointFeatures(entries, new Set());
      for (const feature of nearbyPoints.features) {
        const point = entries.find((entry) => entry.id === feature.properties.id)!;
        const role = point.id === focusPointId ? "Selected" : point.sequence < (selected?.sequence ?? 0) ? "Previous" : "Next";
        feature.properties.label = role + " · " + (point.cacheName || point.gcCode || point.locationName || "Stop " + point.sequence);
        feature.properties.role = role;
      }
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [
          ...entries.filter((point) => selected && point.id !== selected.id).flatMap((point) => {
            const role = point.sequence < selected!.sequence ? "Previous" : "Next";
            return routeFeatures([point, selected!]).features.map((feature) => ({
              ...feature, properties: { ...feature.properties, role }
            }));
          }),
          ...nearbyPoints.features
        ]
      };
      const source = map.getSource(SELECTION_SOURCE_ID) as GeoJSONSource | undefined;
      if (source) source.setData(data);
      else {
        map.addSource(SELECTION_SOURCE_ID, { type: "geojson", data });
        map.addLayer({ id: "trackable-selected-legs", type: "line", source: SELECTION_SOURCE_ID, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "Next"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#16836b", "line-width": 4, "line-opacity": 0.95 } }, POINT_LABEL_LAYER_ID);
        map.addLayer({ id: "trackable-previous-leg", type: "line", source: SELECTION_SOURCE_ID, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "role"], "Previous"]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#8854ad", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": 0.95 } }, POINT_LABEL_LAYER_ID);
        map.addLayer({ id: "trackable-selected-stop", type: "circle", source: SELECTION_SOURCE_ID, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", ["==", ["get", "role"], "Selected"], 10, 7], "circle-color": selectionColor, "circle-stroke-color": "#fffdf0", "circle-stroke-width": 2 } });
        map.addLayer({ id: "trackable-selected-labels", type: "symbol", source: SELECTION_SOURCE_ID, filter: ["==", ["geometry-type"], "Point"], layout: { "text-field": ["get", "label"], "text-font": ["Open Sans Bold"], "text-size": 12, "text-anchor": "top", "text-offset": [0, 1.2], "text-max-width": 18, "text-variable-anchor": ["top", "bottom", "left", "right"], "text-radial-offset": 1.2 }, paint: { "text-color": selectionColor, "text-halo-color": "#fffdf0", "text-halo-width": 2 } });
        map.addLayer({ id: "trackable-selected-arrows", type: "symbol", source: SELECTION_SOURCE_ID, filter: ["==", ["geometry-type"], "LineString"], layout: { "symbol-placement": "line", "symbol-spacing": 120, "text-field": "▶", "text-font": ["Open Sans Regular"], "text-size": 13, "text-keep-upright": false }, paint: { "text-color": selectionColor, "text-halo-color": "#fffdf0", "text-halo-width": 1 } });
      }
      map.setLayoutProperty(ROUTE_LAYER_ID, "visibility", showFullRoute ? "visible" : "none");
      map.setPaintProperty(ROUTE_LAYER_ID, "line-opacity", selected ? 0.3 : 0.5);
    };
    sync();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [focusPointId, neighbours, showFullRoute]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();
    if (!focusPointId) {
      const valid = points.filter((point) => isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN }));
      const bounds = boundsFor(valid.map((point) => ({ latitude: point.latitude!, longitude: point.longitude! })));
      if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 500 });
      return;
    }
    const point = points.find((candidate) => candidate.id === focusPointId);
    if (!point || !isValidMapPoint({ latitude: point.latitude ?? NaN, longitude: point.longitude ?? NaN })) return;
    let cancelled = false;
    let fallbackTimer: number | undefined;
    const focus = () => {
      if (cancelled) return;
      const valid = (neighbours.get(point.id) ?? [point]).filter((entry) => isValidMapPoint({ latitude: entry.latitude ?? NaN, longitude: entry.longitude ?? NaN }));
      const bounds = boundsFor(valid.map((entry) => ({ latitude: entry.latitude!, longitude: entry.longitude! })));
      if (bounds) map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 650 });
    };
    if (map.isStyleLoaded()) focus();
    else fallbackTimer = window.setTimeout(focus, 100);
    return () => {
      cancelled = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    };
  }, [focusPointId, points, neighbours]);

  return <div ref={containerRef} className="maplibre-panel" />;
}
