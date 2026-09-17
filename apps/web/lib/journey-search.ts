export function parseStopNumber(query: string): number | null {
  const match = query.trim().match(/^(?:stop\s*|#\s*)?(\d+|\d{1,3}(?:[.,\s]\d{3})+)$/i);
  if (!match) return null;
  const number = Number(match[1]!.replace(/[.,\s]/g, ""));
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function matchesJourneySearch(point: {
  sequence: number;
  gcCode: string | null;
  cacheName: string | null;
  locationName: string | null;
}, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const number = parseStopNumber(needle);
  if (number !== null) return point.sequence === number;
  return [point.gcCode, point.cacheName, point.locationName]
    .some((value) => value?.toLocaleLowerCase().includes(needle));
}
