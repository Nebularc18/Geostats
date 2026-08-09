type MapPointKind = { isOwnHide?: boolean };

export const SCRATCH_WORLD_REGION = {
  latitude: 0,
  longitude: 0,
  latitudeDelta: 170,
  longitudeDelta: 340
} as const;

export function hasNativeMapSupport(platform: string, androidGoogleMapsApiKey?: string) {
  return platform !== "android" || Boolean(androidGoogleMapsApiKey?.trim());
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
