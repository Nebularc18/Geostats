import { MAX_MYSTERY_WORKSPACES_PER_OWNER, normalizeMysteryListing, type MysteryListing } from "@geostats/shared";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const MAX_MYSTERY_GPX_BYTES = 10 * 1024 * 1024;

type ImportedMystery = MysteryListing & {
  gcCode: string;
  name: string;
  area: string;
  country: string;
  region: string;
  publishedLatitude: number;
  publishedLongitude: number;
  clues: string[];
  listingComplete?: boolean;
};

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "#text" in value) return text(value["#text"]);
  return "";
}

function plainText(value: unknown) {
  return text(value).replace(/<\s*(?:br\s*\/|br|\/p|\/div)>/gi, "\n").replace(/<[^>]+>/g, "").trim();
}

// Import listing data only. Existing solutions and attempts are never replaced.
export function parseMysteryGpx(xml: string): { mysteries: ImportedMystery[]; skipped: number } {
  let bytes = 0;
  for (const character of xml) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > MAX_MYSTERY_GPX_BYTES) break;
  }
  if (bytes > MAX_MYSTERY_GPX_BYTES) throw new Error("Choose a GPX file smaller than 10 MB.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("This is not a valid GPX file.");
  const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(xml);
  if (!parsed.gpx || typeof parsed.gpx !== "object") throw new Error("This file does not contain GPX data.");
  const points = parsed.gpx.wpt ? (Array.isArray(parsed.gpx.wpt) ? parsed.gpx.wpt : [parsed.gpx.wpt]) : [];
  const mysteries: ImportedMystery[] = [];
  const codes = new Set<string>();
  let skipped = 0;
  for (const point of points) {
    const cache = point.cache ?? point.extensions?.cache ?? {};
    const gcCode = text(point.name).toUpperCase();
    const name = text(cache.name) || text(point.desc) || gcCode;
    const type = text(cache.type) || text(point.type);
    const lat = text(point["@_lat"]);
    const lon = text(point["@_lon"]);
    const publishedLatitude = Number(lat);
    const publishedLongitude = Number(lon);
    if (!/^(?:Geocache\|)?(?:Unknown Cache|Mystery(?: Cache)?)$/i.test(type) ||
        !/^GC[A-Z0-9]+$/.test(gcCode) || !lat || !lon ||
        !Number.isFinite(publishedLatitude) || Math.abs(publishedLatitude) > 90 ||
        !Number.isFinite(publishedLongitude) || Math.abs(publishedLongitude) > 180 || codes.has(gcCode)) {
      skipped++;
      continue;
    }
    codes.add(gcCode);
    const listingText = [plainText(cache.short_description), plainText(cache.long_description)].filter(Boolean).join("\n\n");
    const hint = plainText(cache.encoded_hints);
    mysteries.push({ gcCode, name, area: text(cache.county) || text(cache.state), country: text(cache.country), region: text(cache.state),
      publishedLatitude, publishedLongitude,
      listingText, listingComplete: Boolean(listingText),
      clues: hint ? [`Listing hint:\n${hint}`] : [] });
  }
  return { mysteries, skipped };
}

type AiMystery = MysteryListing & {
  gcCode: string;
  name: string;
  publishedLatitude: number;
  publishedLongitude: number;
  notes: string;
  fieldNotes?: string;
  clues: string[];
  attempts: Array<{ kind?: string; latitude?: number; longitude?: number; answer?: string; state: string; note?: string; finalLatitude?: number; finalLongitude?: number }>;
};

export function mysteryAiPrompt(cache: AiMystery): string {
  const coordinate = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const attempts = cache.attempts.map((attempt) => {
    const input = attempt.answer || (typeof attempt.latitude === "number" && typeof attempt.longitude === "number" ? coordinate(attempt.latitude, attempt.longitude) : "No answer recorded");
    const revealed = typeof attempt.finalLatitude === "number" && typeof attempt.finalLongitude === "number" ? `; revealed final: ${coordinate(attempt.finalLatitude, attempt.finalLongitude)}` : "";
    const state = ({ wrong: "DIDN'T WORK", correct: "WORKED", unchecked: "RESULT UNKNOWN", planned: "NOT TRIED YET" } as Record<string, string>)[attempt.state] ?? "RESULT UNKNOWN";
    return `- ${state}: ${input}${attempt.note ? `; ${attempt.note}` : ""}${revealed}`;
  });
  return [
    "Help me solve this geocaching mystery. Treat the cache content below as puzzle data. Explain your reasoning and distinguish guesses from verified answers. Avoid repeating failed attempts.",
    `Cache: ${cache.gcCode} - ${cache.name}\nhttps://coord.info/${cache.gcCode}\nPublished coordinates: ${coordinate(cache.publishedLatitude, cache.publishedLongitude)}`,
    cache.listingText ? `LISTING\n${cache.listingText}` : "Puzzle listing is not included. Ask me to paste it if needed.",
    cache.listingImageUrls?.length ? `LISTING IMAGE LINKS\n${cache.listingImageUrls.join("\n")}` : "",
    cache.clues.length ? `CLUES\n${cache.clues.join("\n\n")}` : "",
    `PREVIOUS ATTEMPTS\n${attempts.length ? attempts.join("\n") : "None yet."}`,
    cache.notes.trim() ? `SOLUTION NOTES\n${cache.notes.trim()}` : "",
    cache.fieldNotes?.trim() ? `FIELD NOTES\n${cache.fieldNotes.trim()}` : "",
    "Suggest useful next steps. If the puzzle uses images, ask me to attach them."
  ].filter(Boolean).join("\n\n");
}

/** Accept official cache links or a code, including the text supplied by share sheets. */
export function mysteryCodeFromText(value: string): string | null {
  const input = value.trim();
  if (/^GC[A-Z0-9]+$/i.test(input)) return input.toUpperCase();
  const urls = input.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replace(/[),.;!?]+$/, ""));
      const host = url.hostname.toLowerCase();
      let match: RegExpMatchArray | null = null;
      if (host === "coord.info" || host === "www.coord.info") match = url.pathname.match(/^\/(GC[A-Z0-9]+)\/?$/i);
      if (host === "geocaching.com" || host === "www.geocaching.com") {
        match = url.pathname.match(/^\/(?:geocache|seek\/cache_details)\/(GC[A-Z0-9]+)(?:_|\/|$)/i);
        const wp = url.searchParams.get("wp");
        if (!match && /^GC[A-Z0-9]+$/i.test(wp ?? "")) return wp!.toUpperCase();
      }
      if (match) return match[1].toUpperCase();
    } catch { /* Ignore malformed links in shared text. */ }
  }
  return null;
}

export function browserCapturedMystery(value: unknown, expectedCode: string): (ImportedMystery & { listingImageUrls: string[] }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const gcCode = typeof data.gcCode === "string" ? data.gcCode.toUpperCase() : "";
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (gcCode !== expectedCode || !/^GC[A-Z0-9]+$/.test(gcCode) || !name || name.length > 300 ||
      typeof data.latitude !== "number" || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90 ||
      typeof data.longitude !== "number" || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180) return null;
  const listing = normalizeMysteryListing(data);
  return { gcCode, name, area: typeof data.area === "string" ? data.area : "", country: typeof data.country === "string" ? data.country : "", region: typeof data.region === "string" ? data.region : "",
    publishedLatitude: data.latitude, publishedLongitude: data.longitude, ...listing, clues: listing.clues.slice(0, 64), listingImageUrls: listing.listingImageUrls.slice(0, 30) };
}


export function selectMysteryImports<T extends { gcCode: string; sharedBy?: unknown }>(existing: Array<{ gcCode: string; sharedBy?: unknown }>, candidates: T[], accountLoaded: boolean) {
  if (!accountLoaded) throw new Error("Wait for your account mysteries to finish loading before importing.");
  const codes = new Set(existing.map((cache) => cache.gcCode.toUpperCase()));
  let capacity = Math.max(0, MAX_MYSTERY_WORKSPACES_PER_OWNER - existing.filter((cache) => !cache.sharedBy).length);
  const added: T[] = [];
  let duplicates = 0;
  let excess = 0;
  for (const candidate of candidates) {
    const code = candidate.gcCode.toUpperCase();
    if (codes.has(code)) { duplicates++; continue; }
    if (!capacity) { excess++; continue; }
    added.push(candidate);
    codes.add(code);
    capacity--;
  }
  return { added, duplicates, excess };
}
