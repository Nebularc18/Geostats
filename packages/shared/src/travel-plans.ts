export const MAX_TRAVEL_STOPS = 100;
export const MAX_TRAVEL_DIRECTIONS_STOPS = 8;

export type TravelPlace = { label: string; latitude: number; longitude: number };
export type TravelStop = Pick<TravelPlace, "latitude" | "longitude"> & {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  distanceKm: number;
};

export type TravelPlan = {
  id: string;
  name: string;
  createdAt: string;
  mode: "nearby" | "route";
  origin: TravelPlace;
  destination?: TravelPlace;
  route?: { distanceMeters: number; durationSeconds: number };
  radiusKm: number;
  caches: TravelStop[];
};

export type AccountTravelPlan = TravelPlan & { version: number };

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
}

function numberIn(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

export function validTravelPlanId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

function coordinate(value: Record<string, unknown>) {
  const latitude = numberIn(value.latitude, -90, 90);
  const longitude = numberIn(value.longitude, -180, 180);
  return latitude === null || longitude === null ? null : { latitude, longitude };
}

function place(value: unknown): TravelPlace | null {
  const row = record(value);
  const point = row && coordinate(row);
  const label = boundedText(row?.label, 1000);
  return point && label ? { ...point, label } : null;
}

function stop(value: unknown): TravelStop | null {
  const row = record(value);
  const point = row && coordinate(row);
  const name = boundedText(row?.name, 1000);
  const gcCode = boundedText(row?.gcCode, 20)?.toUpperCase();
  const distanceKm = numberIn(row?.distanceKm, 0, 100);
  if (!point || !name || !gcCode || !/^GC[A-Z0-9]+$/.test(gcCode) || distanceKm === null || !validTravelPlanId(row?.id)) return null;
  return { ...point, id: row.id, name, gcCode, distanceKm, cacheType: boundedText(row.cacheType, 120) };
}

export function normalizeTravelPlan(value: unknown): TravelPlan | null {
  const plan = record(value);
  if (!plan || !validTravelPlanId(plan.id) || (plan.mode !== "nearby" && plan.mode !== "route")) return null;
  const name = boundedText(plan.name, 80);
  const createdAt = typeof plan.createdAt === "string" ? Date.parse(plan.createdAt) : NaN;
  const radiusKm = numberIn(plan.radiusKm, 0.5, 100);
  const origin = place(plan.origin);
  const destination = plan.mode === "route" ? place(plan.destination) : null;
  if (!name || !Number.isFinite(createdAt) || !origin || radiusKm === null || (plan.mode === "route" && !destination)) return null;
  if (!Array.isArray(plan.caches) || !plan.caches.length || plan.caches.length > MAX_TRAVEL_STOPS) return null;
  const caches = plan.caches.map(stop);
  if (caches.some((item) => item === null)) return null;
  const stops = caches as TravelStop[];
  if (new Set(stops.map(({ gcCode }) => gcCode)).size !== stops.length ||
    new Set(stops.map(({ id }) => id)).size !== stops.length) return null;
  const route = record(plan.route);
  const distanceMeters = numberIn(route?.distanceMeters, 0, Number.MAX_SAFE_INTEGER);
  const durationSeconds = numberIn(route?.durationSeconds, 0, Number.MAX_SAFE_INTEGER);
  return {
    id: plan.id, name, createdAt: new Date(createdAt).toISOString(), radiusKm, mode: plan.mode, origin, caches: stops,
    ...(destination && { destination }),
    ...(distanceMeters !== null && durationSeconds !== null && { route: { distanceMeters, durationSeconds } })
  };
}

export function normalizeAccountTravelPlan(value: unknown): AccountTravelPlan | null {
  const plan = normalizeTravelPlan(value);
  const version = record(value)?.version;
  return plan && typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? { ...plan, version } : null;
}

export function travelPlanDirectionsUrl(plan: Pick<TravelPlan, "mode" | "origin" | "destination" | "caches">) {
  if (!plan.caches.length) return "";
  const coordinateText = ({ latitude, longitude }: Pick<TravelPlace, "latitude" | "longitude">) => `${latitude},${longitude}`;
  const routeEnd = plan.mode === "route" ? plan.destination : undefined;
  const destination = routeEnd ?? plan.caches.at(-1)!;
  const stops = (routeEnd ? plan.caches : plan.caches.slice(0, -1)).slice(0, MAX_TRAVEL_DIRECTIONS_STOPS);
  const options = [
    ["api", "1"], ["origin", coordinateText(plan.origin)], ["destination", coordinateText(destination)], ["travelmode", "driving"]
  ];
  if (stops.length) options.push(["waypoints", stops.map(coordinateText).join("|")]);
  return `https://www.google.com/maps/dir/?${options.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&")}`;
}

export function moveTravelStop(caches: TravelStop[], index: number, delta: -1 | 1) {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= caches.length || target >= caches.length) return caches;
  const next = [...caches];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function travelPlanGpx(plan: TravelPlan) {
  const xml = (text: string) => text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const waypoints = plan.caches.map((cache) =>
    `  <wpt lat="${cache.latitude}" lon="${cache.longitude}"><name>${xml(cache.gcCode)}</name><desc>${xml(cache.name)}</desc></wpt>`
  );
  const route = plan.caches.map((cache) =>
    `    <rtept lat="${cache.latitude}" lon="${cache.longitude}"><name>${xml(cache.gcCode)}</name></rtept>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Geostats" xmlns="http://www.topografix.com/GPX/1/1">',
    ...waypoints, `  <rte><name>${xml(plan.name)}</name>`, ...route, "  </rte>", "</gpx>", ""
  ].join("\n");
}
