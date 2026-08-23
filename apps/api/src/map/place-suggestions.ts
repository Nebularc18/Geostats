export type PlaceSuggestion = {
  label: string;
  latitude: number;
  longitude: number;
  kind: string;
};

type PhotonFeature = {
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function placeSuggestionsFromPhoton(body: unknown): PlaceSuggestion[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const features = (body as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();

  return features.flatMap((rawFeature): PlaceSuggestion[] => {
    if (!rawFeature || typeof rawFeature !== "object" || Array.isArray(rawFeature)) return [];
    const feature = rawFeature as PhotonFeature;
    const longitude = Number(feature.geometry?.coordinates?.[0]);
    const latitude = Number(feature.geometry?.coordinates?.[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const properties = feature.properties ?? {};
    const name = text(properties.name);
    if (!name) return [];
    const parts = [
      name,
      [text(properties.street), text(properties.housenumber)].filter(Boolean).join(" "),
      text(properties.city),
      text(properties.district),
      text(properties.county),
      text(properties.state),
      text(properties.country)
    ].filter((part, index, values) => part && values.findIndex((value) => value.toLocaleLowerCase() === part.toLocaleLowerCase()) === index);
    const label = parts.join(", ");
    const key = label.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      label,
      latitude,
      longitude,
      kind: text(properties.type) || text(properties.osm_value) || "place"
    }];
  });
}
