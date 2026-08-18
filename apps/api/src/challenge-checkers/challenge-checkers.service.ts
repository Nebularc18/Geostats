import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { countableFindWhere, Prisma } from "@geostats/db";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { ChallengeRule, evaluateChallenge, proofText } from "./challenge-checker.evaluator";
import { BoundaryGeometry, GeographicBoundariesService, pointInBoundary } from "./geographic-boundaries";

type CheckerInput = { name?: unknown; gcCode?: unknown; description?: unknown; rules?: unknown };

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
      const cacheType = cleanOptionalText(rule.cacheType, "cacheType", 80);
      if (!cacheType) throw new BadRequestException("cacheType is required");
      return { type: rule.type, cacheType, minimum };
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
    throw new BadRequestException("Unsupported challenge rule type");
  });
}

@Injectable()
export class ChallengeCheckersService {
  constructor(private readonly prisma: PrismaService, private readonly boundaries: GeographicBoundariesService) {}

  async list(userId: string) {
    const [checkers, user] = await Promise.all([
      this.prisma.challengeChecker.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
    ]);
    return { checkers, username: user?.username ?? "user" };
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
    return this.run(checker);
  }

  async runPublic(slug: string) {
    const checker = await this.prisma.challengeChecker.findFirst({
      where: { publicSlug: slug, publishedAt: { not: null } }
    });
    if (!checker) throw new NotFoundException("Published checker not found");
    return this.run(checker);
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
    return this.run(checker);
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

  private async run(checker: { id: string; userId: string; name: string; gcCode: string | null; description: string | null; rules: Prisma.JsonValue; publicSlug: string | null; publishedAt: Date | null; updatedAt: Date }) {
    const profile = await this.prisma.geocachingProfile.findUnique({ where: { userId: checker.userId } });
    const username = profile?.gcUsername ?? "Geocacher";
    const finds = await this.prisma.find.findMany({
      where: countableFindWhere(checker.userId, username.trim().toLowerCase()),
      include: { cache: true },
      orderBy: { foundAt: "asc" }
    });
    const rules = parseRules(checker.rules);
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
    const result = evaluateChallenge(rules, finds, {
      timeZone: profile?.timeZone ?? "Europe/Stockholm",
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
      checkedAt: new Date().toISOString(),
      dataUpdatedAt: latestImport?.updatedAt.toISOString() ?? null,
      ...result,
      proofText: proofText(username, checker.name, result)
    };
  }
}
