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

export function areaFromCachePageMetadata(title: string, description: string) {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const descriptionMatch = description.match(/\b(?:it(?:'|’)s|it is)\s+located\s+in\s+(.+?),\s+[^.]+(?:\.|$)/i);
  if (descriptionMatch?.[1]) return clean(descriptionMatch[1]);

  const titleMatch = title.match(/\)\s+in\s+(.+?),\s+.+?\s+created\s+by\b/i);
  return titleMatch?.[1] ? clean(titleMatch[1]) : "";
}
