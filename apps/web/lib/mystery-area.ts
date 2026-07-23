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
