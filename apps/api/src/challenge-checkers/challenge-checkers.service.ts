import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { countableFindWhere, Prisma } from "@geostats/db";
import { randomBytes } from "node:crypto";
import timezoneAt from "tz-lookup";
import { PrismaService } from "../common/prisma.service";
import { attributesFromRaw, ChallengeRule, evaluateChallenge, ProjectGcFindFilter, proofText } from "./challenge-checker.evaluator";
import { cacheTypeIdentity, cacheTypeOptions } from "./cache-type-catalog";
import { BoundaryGeometry, GeographicBoundariesService, pointInBoundary } from "./geographic-boundaries";
import { importProjectGcNumberScript, projectGcFilterLabel } from "./project-gc-importer";

type CheckerInput = { name?: unknown; gcCode?: unknown; description?: unknown; rules?: unknown };
export const MAX_PUBLIC_CHALLENGE_FINDS = 50_000;

export function resolveDisplayTimeZone(profile: { homeLatitude?: unknown; homeLongitude?: unknown; timeZone?: string | null } | null) {
  const fallback = profile?.timeZone ?? "Europe/Stockholm";
  if (profile?.homeLatitude == null || profile.homeLongitude == null) return fallback;
  const latitude = Number(profile.homeLatitude);
  const longitude = Number(profile.homeLongitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return fallback;
  try { return timezoneAt(latitude, longitude); } catch { return fallback; }
}

function cleanOptionalText(value: unknown, label: string, maximum: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new BadRequestException(`${label} must be at most ${maximum} characters`);
  }
  return value.trim();
}

function parseRules(value: unknown): ChallengeRule[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new BadRequestException("rules must contain between 1 and 10 rules");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new BadRequestException("Each rule must be an object");
    const rule = candidate as Record<string, unknown>;
    const minimum = Number(rule.minimum);
    if (!Number.isInteger(minimum) || minimum < 1 || minimum > 1_000_000) {
      throw new BadRequestException("Each rule minimum must be a positive integer");
    }
    if (rule.type === "TOTAL_FINDS") return { type: rule.type, minimum };
    if (rule.type === "CACHE_TYPE") {
      const cacheTypeValue = cleanOptionalText(rule.cacheTypeId, "cacheTypeId", 120) ?? cleanOptionalText(rule.cacheType, "cacheType", 80);
      if (!cacheTypeValue) throw new BadRequestException("cacheTypeId is required");
      const identity = cacheTypeIdentity(cacheTypeValue);
      const label = cleanOptionalText(rule.cacheTypeLabel, "cacheTypeLabel", 100) ?? identity.label;
      return { type: rule.type, cacheTypeId: identity.id, cacheTypeLabel: label, minimum };
    }
    if (rule.type === "LOCATION") {
      if (!(["country", "region", "county"] as unknown[]).includes(rule.field)) {
        throw new BadRequestException("Location field must be country, region, or county");
      }
      const locationValue = cleanOptionalText(rule.value, "location value", 120);
      if (!locationValue) throw new BadRequestException("Location value is required");
      const field = rule.field as "country" | "region" | "county";
      const country = cleanOptionalText(rule.country, "country", 120) ?? (field === "country" ? locationValue : null);
      const region = cleanOptionalText(rule.region, "region", 120) ?? (field === "region" ? locationValue : null);
      return { type: rule.type, field, value: locationValue, country: country ?? undefined, region: region ?? undefined, minimum };
    }
    if (rule.type === "CALENDAR_DAYS") {
      if (minimum > 366) throw new BadRequestException("Calendar-day minimum cannot exceed 366");
      return { type: rule.type, minimum };
    }
    if (rule.type === "DIFFICULTY_TERRAIN") {
      if (minimum > 81) throw new BadRequestException("Difficulty/terrain minimum cannot exceed 81");
      return { type: rule.type, minimum };
    }
    if (rule.type === "CACHE_SIZE") {
      const size = cleanOptionalText(rule.size, "size", 80);
      if (!size) throw new BadRequestException("size is required");
      return { type: rule.type, size, minimum };
    }
    if (rule.type === "FIND_STREAK") {
      if (minimum > 365) throw new BadRequestException("Find-streak minimum cannot exceed 365");
      return { type: rule.type, minimum };
    }
    if (rule.type === "PLACED_MONTHS") return { type: rule.type, minimum };
    if (rule.type === "MONTH_OF_YEAR") {
      const month = Number(rule.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException("month must be between 1 and 12");
      return { type: rule.type, month, minimum };
    }
    if (rule.type === "WEEKDAY") {
      const weekday = Number(rule.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new BadRequestException("weekday must be between 0 and 6");
      return { type: rule.type, weekday, minimum };
    }
    if (rule.type === "DIFFICULTY_RATING" || rule.type === "TERRAIN_RATING") {
      const rating = Number(rule.rating);
      if (!Number.isFinite(rating) || rating < 1 || rating > 5 || rating * 2 !== Math.round(rating * 2)) {
        throw new BadRequestException("rating must be between 1 and 5 in half-point steps");
      }
      return { type: rule.type, rating, minimum };
    }
    if (rule.type === "FAVORITE_POINTS") {
      const minimumFavoritePoints = Number(rule.minimumFavoritePoints);
      if (!Number.isInteger(minimumFavoritePoints) || minimumFavoritePoints < 1 || minimumFavoritePoints > 1_000_000) {
        throw new BadRequestException("minimumFavoritePoints must be a positive integer");
      }
      return { type: rule.type, minimumFavoritePoints, minimum };
    }
    if (rule.type === "ATTRIBUTE") {
      const attributeId = cleanOptionalText(rule.attributeId, "attributeId", 40);
      const attributeLabel = cleanOptionalText(rule.attributeLabel, "attributeLabel", 120);
      if (!attributeId || !attributeLabel) throw new BadRequestException("attributeId and attributeLabel are required");
      return { type: rule.type, attributeId, attributeLabel, minimum };
    }
    if (rule.type === "PROJECT_GC_NUMBER") {
      if (!Array.isArray(rule.filters) || rule.filters.length < 1 || rule.filters.length > 50) throw new BadRequestException("Imported Project-GC rule must contain filters");
      const filters = rule.filters.map((filter) => validateStoredProjectGcFilter(filter));
      return { type: rule.type, minimum, filters, filterLabel: projectGcFilterLabel(filters) };
    }
    throw new BadRequestException("Unsupported challenge rule type");
  });
}

function validateStoredProjectGcFilter(value: unknown): ProjectGcFindFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Invalid imported Project-GC filter");
  const filter = value as Record<string, unknown>;
  const allowed = new Set(["countries", "regions", "counties", "cacheTypeIds", "excludedCacheTypeIds", "sizes", "difficulties", "terrains", "minVisitDate", "maxVisitDate", "minHiddenDate", "maxHiddenDate", "minLatitude", "maxLatitude", "minLongitude", "maxLongitude"]);
  if (Object.keys(filter).some((key) => !allowed.has(key))) throw new BadRequestException("Invalid imported Project-GC filter field");
  const textArrays = ["countries", "regions", "counties", "cacheTypeIds", "excludedCacheTypeIds", "sizes"];
  const numberArrays = ["difficulties", "terrains"];
  for (const key of textArrays) if (filter[key] !== undefined && (!Array.isArray(filter[key]) || !(filter[key] as unknown[]).every((item) => typeof item === "string" && item.length <= 120))) throw new BadRequestException(`Invalid ${key} filter`);
  for (const key of numberArrays) if (filter[key] !== undefined && (!Array.isArray(filter[key]) || !(filter[key] as unknown[]).every((item) => typeof item === "number" && Number.isFinite(item)))) throw new BadRequestException(`Invalid ${key} filter`);
  for (const key of ["minVisitDate", "maxVisitDate", "minHiddenDate", "maxHiddenDate"]) if (filter[key] !== undefined && (typeof filter[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(filter[key] as string))) throw new BadRequestException(`Invalid ${key} filter`);
  for (const key of ["minLatitude", "maxLatitude", "minLongitude", "maxLongitude"]) if (filter[key] !== undefined && (typeof filter[key] !== "number" || !Number.isFinite(filter[key]))) throw new BadRequestException(`Invalid ${key} filter`);
  return filter as ProjectGcFindFilter;
}

@Injectable()
export class ChallengeCheckersService {
  constructor(private readonly prisma: PrismaService, private readonly boundaries: GeographicBoundariesService) {}

  async list(userId: string) {
    const [checkers, user] = await Promise.all([
      this.prisma.challengeChecker.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
    ]);
    return { checkers: checkers.map((checker) => ({ ...checker, rules: parseRules(checker.rules) })), username: user?.username ?? "user" };
  }

  async locationsForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId }, select: { gcUsername: true } });
    const finds = await this.prisma.find.findMany({
      where: countableFindWhere(userId, profile?.gcUsername?.trim().toLowerCase() ?? null),
      select: { cache: { select: { country: true, region: true, county: true } } }
    });
    const countries = new Map<string, Map<string, Set<string>>>();
    const usable = (value: string | null | undefined) => {
      const cleaned = value?.trim();
      return cleaned && !["none", "unknown", "n/a", "null"].includes(cleaned.toLocaleLowerCase()) ? cleaned : null;
    };
    for (const find of finds) {
      const country = usable(find.cache.country);
      if (!country) continue;
      let regions = countries.get(country);
      if (!regions) { regions = new Map(); countries.set(country, regions); }
      const region = usable(find.cache.region);
      if (!region) continue;
      let counties = regions.get(region);
      if (!counties) { counties = new Set(); regions.set(region, counties); }
      const county = usable(find.cache.county);
      if (county) counties.add(county);
    }
    const compare = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: "base" });
    return [...countries.entries()].sort(([left], [right]) => compare(left, right)).map(([name, regions]) => ({
      name,
      regions: [...regions.entries()].sort(([left], [right]) => compare(left, right)).map(([regionName, counties]) => ({
        name: regionName,
        counties: [...counties].sort(compare)
      }))
    }));
  }

  async catalogForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId }, select: { gcUsername: true } });
    const finds = await this.prisma.find.findMany({
      where: countableFindWhere(userId, profile?.gcUsername?.trim().toLowerCase() ?? null),
      select: {
        cache: {
          select: {
            cacheType: true,
            size: true,
            userData: { where: { userId }, take: 1, select: { raw: true } }
          }
        }
      }
    });
    const compare = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
    const sizes = [...new Set([
      "Micro", "Small", "Regular", "Large", "Other", "Virtual",
      ...finds.map((find) => find.cache.size?.trim()).filter((value): value is string => Boolean(value))
    ])].sort(compare);
    const attributeMap = new Map<string, string>();
    for (const find of finds) {
      for (const attribute of attributesFromRaw(find.cache.userData[0]?.raw)) attributeMap.set(attribute.id, attribute.label);
    }
    const attributes = [...attributeMap].map(([id, label]) => ({ id, label })).sort((left, right) => compare(left.label, right.label));
    return { cacheTypes: cacheTypeOptions(finds.map((find) => find.cache.cacheType)), sizes, attributes };
  }

  importProjectGc(input: Record<string, unknown>) {
    return importProjectGcNumberScript(input.script, input.config);
  }

  async locationCatalogForUser(userId: string, countryValue: unknown, regionValue: unknown) {
    const country = cleanOptionalText(countryValue, "country", 120);
    if (!country) throw new BadRequestException("country is required");
    const available = await this.locationsForUser(userId);
    if (!available.some((item) => item.name === country)) throw new BadRequestException("Country is not present in imported finds");
    const importedCountry = available.find((item) => item.name === country)!;
    const region = cleanOptionalText(regionValue, "region", 120);
    const compare = (left: string, right: string) => left.localeCompare(right, undefined, { sensitivity: "base" });
    const unique = (values: string[]) => [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()].sort(compare);
    if (region) {
      const importedCounties = importedCountry.regions.find((item) => item.name === region)?.counties ?? [];
      let canonicalCounties: string[] = [];
      try { canonicalCounties = await this.boundaries.counties(country, region); } catch { /* Imported metadata remains usable offline. */ }
      return { regions: [], counties: unique(canonicalCounties.length ? canonicalCounties : importedCounties) };
    }
    let canonicalRegions: string[] = [];
    try { canonicalRegions = await this.boundaries.regions(country); } catch { /* Imported metadata remains usable offline. */ }
    return { regions: unique(canonicalRegions.length ? canonicalRegions : importedCountry.regions.map((item) => item.name)), counties: [] };
  }

  async create(userId: string, input: CheckerInput) {
    const name = cleanOptionalText(input.name, "name", 120);
    if (!name) throw new BadRequestException("name is required");
    const gcCode = cleanOptionalText(input.gcCode, "gcCode", 20)?.toUpperCase();
    if (!gcCode) throw new BadRequestException("gcCode is required");
    if (!/^GC[A-Z0-9]+$/.test(gcCode)) throw new BadRequestException("gcCode must be a valid GC code");
    const description = cleanOptionalText(input.description, "description", 1000);
    const rules = parseRules(input.rules);
    try {
      return await this.prisma.challengeChecker.create({
        data: { userId, name, gcCode, description, rules: rules as unknown as Prisma.InputJsonValue }
      });
    } catch (error) {
      this.rethrowDuplicateCache(error);
      throw error;
    }
  }

  async update(userId: string, id: string, input: CheckerInput) {
    await this.owned(userId, id);
    const data: Prisma.ChallengeCheckerUpdateInput = {};
    if (input.name !== undefined) {
      const name = cleanOptionalText(input.name, "name", 120);
      if (!name) throw new BadRequestException("name is required");
      data.name = name;
    }
    if (input.gcCode !== undefined) {
      const gcCode = cleanOptionalText(input.gcCode, "gcCode", 20)?.toUpperCase();
      if (!gcCode) throw new BadRequestException("gcCode is required");
      if (!/^GC[A-Z0-9]+$/.test(gcCode)) throw new BadRequestException("gcCode must be a valid GC code");
      data.gcCode = gcCode;
    }
    if (input.description !== undefined) data.description = cleanOptionalText(input.description, "description", 1000);
    if (input.rules !== undefined) data.rules = parseRules(input.rules) as unknown as Prisma.InputJsonValue;
    try {
      return await this.prisma.challengeChecker.update({ where: { id }, data });
    } catch (error) {
      this.rethrowDuplicateCache(error);
      throw error;
    }
  }

  async remove(userId: string, id: string) {
    await this.owned(userId, id);
    await this.prisma.challengeChecker.delete({ where: { id } });
    return { deleted: true };
  }

  async setPublished(userId: string, id: string, published: unknown) {
    if (typeof published !== "boolean") throw new BadRequestException("published must be a boolean");
    const checker = await this.owned(userId, id);
    return this.prisma.challengeChecker.update({
      where: { id },
      data: {
        publicSlug: published ? checker.publicSlug ?? randomBytes(16).toString("base64url") : checker.publicSlug,
        publishedAt: published ? new Date() : null
      }
    });
  }

  async runOwned(userId: string, id: string) {
    const checker = await this.owned(userId, id);
    return this.run(checker, false);
  }

  async runPublic(slug: string) {
    const checker = await this.prisma.challengeChecker.findFirst({
      where: { publicSlug: slug, publishedAt: { not: null } }
    });
    if (!checker) throw new NotFoundException("Published checker not found");
    return this.run(checker, true);
  }

  async runPublicForCache(username: string, gcCodeValue: string) {
    const gcCode = gcCodeValue.trim().toUpperCase();
    const checker = await this.prisma.challengeChecker.findFirst({
      where: {
        gcCode,
        publishedAt: { not: null },
        user: { username }
      }
    });
    if (!checker) throw new NotFoundException("Published checker not found");
    return this.run(checker, true);
  }

  private async owned(userId: string, id: string) {
    const checker = await this.prisma.challengeChecker.findFirst({ where: { id, userId } });
    if (!checker) throw new NotFoundException("Challenge checker not found");
    return checker;
  }

  private rethrowDuplicateCache(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictException("You already have a challenge checker for this cache");
    }
  }

  private async run(checker: { id: string; userId: string; name: string; gcCode: string | null; description: string | null; rules: Prisma.JsonValue; publicSlug: string | null; publishedAt: Date | null; updatedAt: Date }, publicRun: boolean) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId: checker.userId } });
    const username = profile?.gcUsername ?? "Geocacher";
    const finds = await this.prisma.find.findMany({
      where: countableFindWhere(checker.userId, username.trim().toLowerCase()),
      include: { cache: { include: { userData: { where: { userId: checker.userId }, take: 1 } } } },
      orderBy: { foundAt: "asc" },
      ...(publicRun ? { take: MAX_PUBLIC_CHALLENGE_FINDS + 1 } : {})
    });
    if (publicRun && finds.length > MAX_PUBLIC_CHALLENGE_FINDS) {
      throw new PayloadTooLargeException(`Published challenge checks support at most ${MAX_PUBLIC_CHALLENGE_FINDS} finds`);
    }
    const rules = parseRules(checker.rules);
    const checkerFinds = finds.map((find) => ({ ...find, cache: { ...find.cache, raw: find.cache.userData?.[0]?.raw } }));
    const geometries = new Map<ChallengeRule, BoundaryGeometry>();
    await Promise.all(rules.map(async (rule) => {
      if (rule.type === "LOCATION" && rule.field !== "country" && rule.country) {
        try {
          const geometry = await this.boundaries.geometry(rule.country, rule.field, rule.value, rule.region);
          if (geometry) geometries.set(rule, geometry);
        } catch {
          // Remote boundary data is optional; evaluation can still use imported location metadata.
        }
      }
    }));
    const result = evaluateChallenge(rules, checkerFinds, {
      locationMatch: (rule, find) => {
        const geometry = geometries.get(rule);
        const latitude = Number(find.cache.latitude);
        const longitude = Number(find.cache.longitude);
        if (geometry && Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return pointInBoundary([longitude, latitude], geometry);
        }
        const same = (left: unknown, right: string) => String(left ?? "").trim().localeCompare(right, undefined, { sensitivity: "base" }) === 0;
        return same(find.cache[rule.field], rule.value) &&
          (!rule.country || same(find.cache.country, rule.country)) &&
          (!rule.region || same(find.cache.region, rule.region));
      }
    });
    const latestImport = await this.prisma.import.findFirst({
      where: { userId: checker.userId, status: "COMPLETED" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { updatedAt: true }
    });
    return {
      checker: {
        id: checker.id,
        name: checker.name,
        gcCode: checker.gcCode,
        description: checker.description,
        rules,
        publicSlug: checker.publicSlug,
        publishedAt: checker.publishedAt,
        updatedAt: checker.updatedAt
      },
      username,
      timeZone: resolveDisplayTimeZone(profile),
      checkedAt: new Date().toISOString(),
      dataUpdatedAt: latestImport?.updatedAt.toISOString() ?? null,
      ...result,
      proofText: proofText(username, checker.name, result)
    };
  }
}
