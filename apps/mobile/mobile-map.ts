type MapPointKind = { isOwnHide?: boolean };
export type ScratchMapLevel = "countries" | "regions" | "counties";

export const SCRATCH_WORLD_REGION = {
  latitude: 0,
  longitude: 0,
  latitudeDelta: 170,
  longitudeDelta: 340
} as const;

export function hasNativeMapSupport(platform: string, androidGoogleMapsApiKey?: string) {
  return platform !== "android" || Boolean(androidGoogleMapsApiKey?.trim());
}

/**
 * Keeps the native Polygon view count and vertex count bounded while allowing
 * complete country and municipality layers to render. Detail layers use fewer
 * points per ring because coverage is more useful than coastline precision at
 * a phone-sized map scale.
 */
export function scratchMapGeometryBudget(level: ScratchMapLevel, platform: string) {
  const android = platform === "android";
  if (level === "countries") {
    return { maxPolygons: android ? 360 : 520, maxVertices: android ? 52_000 : 90_000, maxPointsPerRing: android ? 140 : 220, maxHighlightedPointsPerRing: android ? 900 : 1_600 };
  }
  if (level === "counties") {
    return { maxPolygons: android ? 360 : 520, maxVertices: android ? 12_000 : 24_000, maxPointsPerRing: android ? 28 : 46, maxHighlightedPointsPerRing: android ? 80 : 140 };
  }
  return { maxPolygons: android ? 180 : 280, maxVertices: android ? 12_000 : 24_000, maxPointsPerRing: android ? 72 : 110, maxHighlightedPointsPerRing: android ? 220 : 360 };
}

function evenlySample<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => items[Math.floor((index * items.length) / limit)]!);
}

/**
 * Applies the native marker budget without allowing either finds or own hides
 * to consume every slot in a combined map.
 */
export function selectNativeMapPoints<T extends MapPointKind>(points: T[], limit: number) {
  if (limit <= 0) return [];
  if (points.length <= limit) return points;

  const finds = points.filter((point) => !point.isOwnHide);
  const hides = points.filter((point) => point.isOwnHide);
  if (finds.length === 0 || hides.length === 0) return evenlySample(points, limit);

  const proportionalHideSlots = Math.round((limit * hides.length) / points.length);
  const hideSlots = Math.min(hides.length, Math.max(1, Math.min(limit - 1, proportionalHideSlots)));
  const findSlots = Math.min(finds.length, limit - hideSlots);
  const unusedSlots = limit - hideSlots - findSlots;

  return [
    ...evenlySample(finds, findSlots + unusedSlots),
    ...evenlySample(hides, hideSlots)
  ];
}
