export type MapPointCoordinates = {
  latitude: number;
  longitude: number;
};

export function isValidMapPoint(point: MapPointCoordinates) {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

export function boundsFor(points: MapPointCoordinates[]): [[number, number], [number, number]] | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;

  for (const point of points) {
    if (!isValidMapPoint(point)) {
      continue;
    }
    west = Math.min(west, point.longitude);
    east = Math.max(east, point.longitude);
    south = Math.min(south, point.latitude);
    north = Math.max(north, point.latitude);
  }

  if (!Number.isFinite(west)) {
    return null;
  }

  return [
    [west, south],
    [east, north]
  ];
}
