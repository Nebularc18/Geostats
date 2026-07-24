const OWNER_METADATA_PATTERNS = [
  /^a\s+cache\s+by\b/i,
  /\bmessage\s+this\s+owner\b/i,
  /\bhidden\s*:\s*/i
];

export function normalizeMysteryArea(value: unknown) {
  if (typeof value !== "string") return "";
  const area = value.replace(/\s+/g, " ").trim();
  return OWNER_METADATA_PATTERNS.some((pattern) => pattern.test(area)) ? "" : area;
}

export function locationFromCachePageMetadata(title: string, description: string) {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const descriptionMatch = description.match(/\b(?:it(?:'|’)s|it is)\s+located\s+in\s+(.+?),\s+([^.]+?)(?:\.|$)/i);
  if (descriptionMatch?.[1]) {
    return {
      county: clean(descriptionMatch[1]),
      country: clean(descriptionMatch[2] ?? "")
    };
  }

  const titleMatch = title.match(/\)\s+in\s+(.+?),\s+(.+?)\s+created\s+by\b/i);
  return {
    county: titleMatch?.[1] ? clean(titleMatch[1]) : "",
    country: titleMatch?.[2] ? clean(titleMatch[2]) : ""
  };
}

export function areaFromCachePageMetadata(title: string, description: string) {
  return locationFromCachePageMetadata(title, description).county;
}
