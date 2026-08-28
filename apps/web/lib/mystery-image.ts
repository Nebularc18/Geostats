export function normalizeMysteryImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
