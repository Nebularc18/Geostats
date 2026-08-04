export type MysteryPageLocation = {
  country: string;
  region: string;
  county: string;
  locality: string;
  locationHierarchy: string[];
};

type MysteryPageLocationSources = {
  jsonLd: unknown[];
  breadcrumbs: string[][];
  locationTexts: string[];
  metaRegion?: string;
  metadata?: Partial<MysteryPageLocation>;
};

export function locationFromPageSources(sources: MysteryPageLocationSources): MysteryPageLocation {
  const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
  const unique = (values: string[]) => values.filter((value, index) => value && values.indexOf(value) === index);
  const isOwnerMetadata = (values: string[]) =>
    values.some((value) => /^(?:a\s+)?cache\s+by\b|\bmessage\s+this\s+owner\b|\bhidden\s*:/i.test(value));
  const empty = (): MysteryPageLocation => ({
    country: "",
    region: "",
    county: "",
    locality: "",
    locationHierarchy: []
  });
  const fromAddress = (address: Record<string, unknown>) => {
    const region = clean(address.addressRegion);
    const county = clean(address.addressCounty) || region;
    const locality = clean(address.addressLocality);
    const rawCountry = address.addressCountry;
    const country = clean(
      rawCountry && typeof rawCountry === "object"
        ? (rawCountry as Record<string, unknown>).name
        : rawCountry
    );
    return {
      country,
      region,
      county,
      locality,
      locationHierarchy: unique([country, region, county, locality])
    };
  };
  const typeScore = (types: string[]) => {
    if (types.some((type) => /^(?:place|touristattraction|geocache)$/i.test(type))) return 300;
    if (types.some((type) => /^postaladdress$/i.test(type))) return 200;
    if (types.some((type) => /^(?:organization|person)$/i.test(type))) return -200;
    return 0;
  };
  const structuredCandidates: Array<{ location: MysteryPageLocation; score: number; order: number }> = [];
  let order = 0;
  const visit = (value: unknown, inheritedTypes: string[] = []) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inheritedTypes));
      return;
    }
    const record = value as Record<string, unknown>;
    const ownTypes = (Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]])
      .filter((type): type is string => typeof type === "string");
    const types = ownTypes.length ? ownTypes : inheritedTypes;
    const address = record.address && typeof record.address === "object" && !Array.isArray(record.address)
      ? record.address as Record<string, unknown>
      : ["addressCountry", "addressRegion", "addressCounty", "addressLocality"].some((key) => key in record)
        ? record
        : null;
    if (address) {
      const location = fromAddress(address);
      const completeness = [location.country, location.region, location.county, location.locality].filter(Boolean).length;
      if (completeness) structuredCandidates.push({
        location,
        score: typeScore(types) + completeness,
        order: order++
      });
    }
    Object.values(record).forEach((nested) => visit(nested, types));
  };
  sources.jsonLd.forEach((document) => visit(document));
  structuredCandidates.sort((first, second) => second.score - first.score || first.order - second.order);

  const result = structuredCandidates[0]?.location ?? empty();
  const breadcrumb = [...sources.breadcrumbs]
    .map((parts) => unique(parts.map(clean)))
    .filter((parts) => !isOwnerMetadata(parts))
    .sort((first, second) => second.length - first.length)[0] ?? [];
  if (breadcrumb.length) {
    if (breadcrumb.length > result.locationHierarchy.length) result.locationHierarchy = breadcrumb;
    result.country ||= breadcrumb[0] ?? "";
    result.region ||= breadcrumb.length > 2 ? breadcrumb[1] ?? "" : "";
    result.county ||= breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 1] ?? "" : "";
  }

  const textParts = sources.locationTexts
    .map((text) => unique(clean(text)
      .replace(/^(?:located\s+)?in\s+/i, "")
      .split(/\s*(?:>|›|»|→|,)\s*/)
      .map(clean)))
    .sort((first, second) => second.length - first.length)[0] ?? [];
  if (textParts.length > 1) {
    const textHierarchy = [...textParts].reverse();
    result.country ||= textHierarchy[0] ?? "";
    result.region ||= textHierarchy.length > 3 ? textHierarchy[1] ?? "" : "";
    result.county ||= textHierarchy.length > 2
      ? textHierarchy[textHierarchy.length - 2] ?? ""
      : textHierarchy[1] ?? "";
    result.locality ||= textHierarchy.length > 2 ? textHierarchy[textHierarchy.length - 1] ?? "" : "";
    if (textHierarchy.length > result.locationHierarchy.length) result.locationHierarchy = textHierarchy;
  }

  const metaRegion = clean(sources.metaRegion);
  result.region ||= metaRegion;
  result.county ||= metaRegion;
  result.country ||= clean(sources.metadata?.country);
  result.region ||= clean(sources.metadata?.region);
  result.county ||= clean(sources.metadata?.county);
  result.locality ||= clean(sources.metadata?.locality);
  if (!result.locationHierarchy.length) {
    result.locationHierarchy = unique([result.country, result.region, result.county, result.locality]);
  }
  return result;
}
