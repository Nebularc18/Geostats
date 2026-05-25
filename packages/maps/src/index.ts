export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function isValidCoordinate(point: LatLng): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function boundsFromPoints(points: LatLng[]): Bounds | null {
  const valid = points.filter(isValidCoordinate);
  if (valid.length === 0) {
    return null;
  }

  return valid.reduce<Bounds>(
    (bounds, point) => ({
      north: Math.max(bounds.north, point.latitude),
      south: Math.min(bounds.south, point.latitude),
      east: Math.max(bounds.east, point.longitude),
      west: Math.min(bounds.west, point.longitude)
    }),
    {
      north: valid[0]!.latitude,
      south: valid[0]!.latitude,
      east: valid[0]!.longitude,
      west: valid[0]!.longitude
    }
  );
}
