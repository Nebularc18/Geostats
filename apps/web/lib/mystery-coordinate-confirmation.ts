type Coordinate = {
  latitude: number;
  longitude: number;
};

type CoordinateDocument = {
  querySelector(selector: string): { textContent?: string | null } | null;
};

/**
 * Kept self-contained because the userscript route serializes this function.
 */
export function cachePageShowsCoordinate(document: CoordinateDocument, expected: Coordinate): boolean {
  const selectors = [
    "#uxLatLon",
    "[data-testid='coordinates']",
    ".coordinates",
    "[class*='Coordinates']",
    "[class*='coordinates']"
  ];
  let value = "";
  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      value = text;
      break;
    }
  }

  const normalized = value.replace(/(\d),(\d)/g, "$1.$2");
  const dmm = normalized.match(/([NS])\s*(\d{1,2})[^\d]+(\d{1,2}(?:\.\d+)?)\s*['’′]?\s+([EW])\s*(\d{1,3})[^\d]+(\d{1,2}(?:\.\d+)?)/i);
  let actual: Coordinate | null = null;
  if (dmm) {
    actual = {
      latitude: (Number(dmm[2]) + Number(dmm[3]) / 60) * (dmm[1].toUpperCase() === "S" ? -1 : 1),
      longitude: (Number(dmm[5]) + Number(dmm[6]) / 60) * (dmm[4].toUpperCase() === "W" ? -1 : 1)
    };
  } else {
    const decimal = normalized.match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
    if (decimal) actual = { latitude: Number(decimal[1]), longitude: Number(decimal[2]) };
  }

  if (!actual) return false;
  return Math.abs(actual.latitude - expected.latitude) < 0.00001 && Math.abs(actual.longitude - expected.longitude) < 0.00001;
}
