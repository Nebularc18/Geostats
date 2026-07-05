export function normalizeCountry(value: unknown): string | null {
  const country = String(value ?? "").trim().replace(/\s+/g, " ");
  return country ? country : null;
}
