export type MysteryListing = {
  listingText?: string;
  listingTextUpdatedAt?: string;
  listingImageUrls?: string[];
};

export const MAX_MYSTERY_SNAPSHOT_BYTES = 256 * 1024;

export function mysterySnapshotByteLength(value: unknown) {
  let bytes = 0;
  for (const character of JSON.stringify(value)) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isListingImageUrl(item: unknown): item is string {
  if (typeof item !== "string") return false;
  try { const url = new URL(item); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}

export function normalizeMysteryListing(value: { listingText?: unknown; listingImageUrls?: unknown; clues?: unknown }) {
  const hasListingText = typeof value.listingText === "string";
  const descriptions = new Set<string>();
  const shortDescriptions = new Set<string>();
  const imageUrls = Array.isArray(value.listingImageUrls) ? [...value.listingImageUrls] : [];
  const clues: string[] = [];
  for (const clue of Array.isArray(value.clues) ? value.clues : []) {
    if (typeof clue !== "string") continue;
    const legacy = !hasListingText && /^(Short description|Puzzle listing|Puzzle images):\r?\n([\s\S]+)$/.exec(clue);
    if (!legacy || !legacy[2].trim()) clues.push(clue);
    else if (legacy[1] === "Short description") shortDescriptions.add(legacy[2]);
    else if (legacy[1] === "Puzzle listing") descriptions.add(legacy[2]);
    else {
      const links = legacy[2].split(/\r?\n/);
      if (links.every(isListingImageUrl)) imageUrls.push(...links);
      else clues.push(clue);
    }
  }
  const listingText = typeof value.listingText === "string" ? value.listingText : [
    ...[...shortDescriptions].filter((short) => ![...descriptions].some((description) => description === short || description.startsWith(`${short}\n\n`))),
    ...descriptions
  ].join("\n\n");
  const listingImageUrls = [...new Set(imageUrls.filter(isListingImageUrl))];
  return { listingText, listingImageUrls, clues };
}
