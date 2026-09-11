// Canonical geocache-type catalog shared by every import path and checker.
//
// This is the single source of truth for cache-type naming. Import sources
// spell the same type differently — Groundspeak GPX uses full names such as
// "Unknown Cache" while GSAK's g_CacheType() stores short display names such
// as "Mystery" — so writers must store canonicalCacheTypeName(value) in
// caches.cache_type and readers must match through cacheTypeIdentity().
// Adding a new spelling? Add it here once and every path picks it up.

export type CacheTypeOption = {
  id: string;
  label: string;
  aliases: readonly string[];
  imported: boolean;
};

type CanonicalCacheType = Omit<CacheTypeOption, "imported">;

const CANONICAL_CACHE_TYPES: readonly CanonicalCacheType[] = [
  { id: "2", label: "Traditional Cache", aliases: ["Traditional"] },
  { id: "3", label: "Multi-Cache", aliases: ["Multi-cache", "Multi Cache", "Multi"] },
  { id: "4", label: "Virtual Cache", aliases: ["Virtual"] },
  { id: "5", label: "Letterbox Hybrid", aliases: ["Letterbox"] },
  { id: "6", label: "Event Cache", aliases: ["Event"] },
  { id: "8", label: "Mystery Cache", aliases: ["Mystery", "Unknown", "Puzzle", "Puzzle Cache", "Unknown Cache", "Unknown (Mystery) Cache", "Mystery/Unknown Cache", "Mystery or Puzzle Cache", "Mystery/Puzzle Cache"] },
  { id: "9", label: "Project A.P.E. Cache", aliases: ["Project Ape", "Project APE"] },
  { id: "11", label: "Webcam Cache", aliases: ["Webcam"] },
  { id: "12", label: "Locationless Cache", aliases: ["Locationless (Reverse) Cache", "Locationless"] },
  { id: "13", label: "Cache In Trash Out Event", aliases: ["CITO Event", "CITO"] },
  { id: "137", label: "EarthCache", aliases: ["Earth", "Earth Cache", "Earthcache"] },
  { id: "453", label: "Mega-Event Cache", aliases: ["Mega Event Cache", "Mega-Event", "Mega event"] },
  { id: "1304", label: "GPS Adventures Maze Exhibit", aliases: ["GPS Adventures Exhibit", "GPS Maze Exhibit", "Maze Exhibit"] },
  { id: "1858", label: "Wherigo Cache", aliases: ["Wherigo"] },
  { id: "3653", label: "Community Celebration Event", aliases: ["Community Celebration", "L&F Event", "L and F Event", "Lost and Found Event Cache", "Lost and Found Event"] },
  { id: "3773", label: "Geocaching HQ Cache", aliases: ["Groundspeak HQ", "Groundspeak HQ Cache", "Geocaching HQ", "HQ", "HQ Cache"] },
  { id: "3774", label: "Geocaching HQ Celebration", aliases: ["L&F Celebration", "L and F Celebration", "HQ Celebration", "Groundspeak Lost and Found Celebration", "Lost and Found Celebration"] },
  { id: "4738", label: "Geocaching HQ Block Party", aliases: ["Groundspeak Block Party", "Block Party"] },
  { id: "7005", label: "Giga-Event Cache", aliases: ["Giga Event Cache", "Giga-Event", "Giga event"] }
];

function normalized(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const CACHE_TYPE_BY_ID = new Map(CANONICAL_CACHE_TYPES.map((entry) => [entry.id, entry]));
const CACHE_TYPE_BY_ALIAS = new Map<string, CanonicalCacheType>();
for (const entry of CANONICAL_CACHE_TYPES) {
  for (const alias of [entry.label, ...entry.aliases]) CACHE_TYPE_BY_ALIAS.set(normalized(alias), entry);
}

export function cacheTypeIdentity(value: string): { id: string; label: string } {
  if (value.trim().startsWith("custom:")) {
    const id = value.trim();
    return { id, label: id.slice("custom:".length) };
  }
  const canonical = CACHE_TYPE_BY_ID.get(value.trim()) ?? CACHE_TYPE_BY_ALIAS.get(normalized(value));
  if (canonical) return { id: canonical.id, label: canonical.label };
  const label = value.trim();
  return { id: `custom:${normalized(label)}`, label };
}

export function cacheTypeOptions(importedValues: Array<string | null | undefined>): CacheTypeOption[] {
  const importedIds = new Set<string>();
  const custom = new Map<string, CacheTypeOption>();
  for (const value of importedValues) {
    if (!value?.trim()) continue;
    const identity = cacheTypeIdentity(value);
    importedIds.add(identity.id);
    if (identity.id.startsWith("custom:") && !custom.has(identity.id)) {
      custom.set(identity.id, { ...identity, aliases: [], imported: true });
    }
  }
  return [
    ...CANONICAL_CACHE_TYPES.map((entry) => ({ ...entry, imported: importedIds.has(entry.id) })),
    ...custom.values()
  ];
}

export function cacheTypeLabel(id: string, fallback?: string) {
  return CACHE_TYPE_BY_ID.get(id)?.label ?? fallback?.trim() ?? id.replace(/^custom:/, "");
}

/**
 * Canonical storage form for caches.cache_type. Known spellings (GPX full
 * names, GSAK short names, Project-GC labels) collapse to one label so rows
 * created through different import paths stay linked; anything else is kept
 * trimmed so no information is lost. Null/blank stays null.
 */
export function canonicalCacheTypeName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return cacheTypeIdentity(trimmed).label;
}
