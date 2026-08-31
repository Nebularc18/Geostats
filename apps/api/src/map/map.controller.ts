import { BadRequestException, Body, ConflictException, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { countableFindWhere, Prisma } from "@geostats/db";
import { normalizedGcUsername } from "@geostats/stats";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsNumberString, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";
import { TravelSearchService } from "./travel-search.service";

class TravelMysteryCacheDto {
  @IsString()
  @MaxLength(100)
  id!: string;

  @IsString()
  @MaxLength(20)
  gcCode!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  county?: string;
}

class TravelPlaceDto {
  @IsString()
  @MaxLength(300)
  label!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

class PlaceSuggestionQueryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  q!: string;
}

class TravelSearchDto {
  @IsIn(["nearby", "route"])
  mode!: "nearby" | "route";

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  origin!: string;

  @ValidateIf((input: TravelSearchDto) => input.mode === "route")
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  destination?: string;

  @IsNumber()
  @Min(0.5)
  @Max(100)
  radiusKm!: number;

  @IsOptional()
  @IsBoolean()
  includeFound?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TravelMysteryCacheDto)
  mysteryCaches?: TravelMysteryCacheDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => TravelPlaceDto)
  originPlace?: TravelPlaceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TravelPlaceDto)
  destinationPlace?: TravelPlaceDto;
}

class MapPointsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cacheType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string;

  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  difficultyMin?: string;

  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  difficultyMax?: string;

  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  terrainMin?: string;

  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  terrainMax?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(40)
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(40)
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;

  @IsOptional()
  @IsDateString()
  @MaxLength(40)
  snapshot?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  snapshotRevision?: string;
}

const MAP_CACHE_LIMIT = 5000;
const UNKNOWN_LOCATION = "Unknown";
const COUNTRY_CONTINENTS = new Map(
  [
    ["Algeria", "Africa"],
    ["Burkina Faso", "Africa"],
    ["Cabo Verde", "Africa"],
    ["Cape Verde", "Africa"],
    ["Chad", "Africa"],
    ["Djibouti", "Africa"],
    ["Egypt", "Africa"],
    ["Eritrea", "Africa"],
    ["Ethiopia", "Africa"],
    ["Gambia", "Africa"],
    ["Guinea-Bissau", "Africa"],
    ["Libya", "Africa"],
    ["Mali", "Africa"],
    ["Mauritania", "Africa"],
    ["Morocco", "Africa"],
    ["Niger", "Africa"],
    ["Senegal", "Africa"],
    ["Somalia", "Africa"],
    ["Sudan", "Africa"],
    ["The Gambia", "Africa"],
    ["Tunisia", "Africa"],
    ["Western Sahara", "Africa"],
    ["Armenia", "Asia"],
    ["Bahrain", "Asia"],
    ["Georgia", "Asia"],
    ["Iran", "Asia"],
    ["Iraq", "Asia"],
    ["Israel", "Asia"],
    ["Jordan", "Asia"],
    ["Kuwait", "Asia"],
    ["Lebanon", "Asia"],
    ["Saudi Arabia", "Asia"],
    ["Palestine", "Asia"],
    ["Qatar", "Asia"],
    ["Oman", "Asia"],
    ["Syria", "Asia"],
    ["Turkey", "Asia"],
    ["United Arab Emirates", "Asia"],
    ["UAE", "Asia"],
    ["Yemen", "Asia"],
    ["Cyprus", "Europe"],
    ["Gibraltar", "Europe"],
    ["Greece", "Europe"],
    ["Malta", "Europe"],
    ["Portugal", "Europe"],
    ["Spain", "Europe"],
    ["Russia", "Europe"]
  ].map(([country, continent]) => [country.toLowerCase(), continent])
);

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function mapSnapshot(value?: string) {
  const snapshot = value ? new Date(value) : new Date();
  if (!Number.isFinite(snapshot.getTime())) {
    throw new BadRequestException("snapshot must be an ISO date");
  }
  return snapshot;
}

const MAP_DAY_MS = 24 * 60 * 60 * 1000;

function mapNumber(value: string | undefined, label: string) {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${label} must be a number`);
  }
  return parsed;
}

function mapDate(value: string | undefined, label: string) {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(`${label} must be an ISO date`);
  }
  return parsed;
}

function mapDateRange(query: MapPointsQueryDto) {
  const from = mapDate(query.dateFrom, "dateFrom");
  const to = mapDate(query.dateTo, "dateTo");
  if (!from && !to) {
    return undefined;
  }
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: new Date(to.getTime() + MAP_DAY_MS - 1) } : {})
  };
}

function mapCacheWhere(query: MapPointsQueryDto): Prisma.CacheWhereInput | undefined {
  const filters: Prisma.CacheWhereInput[] = [];
  const text = query.query?.trim();
  if (text) {
    filters.push({
      OR: [
        { gcCode: { contains: text, mode: "insensitive" } },
        { name: { contains: text, mode: "insensitive" } }
      ]
    });
  }

  const exactFields = [
    ["cacheType", query.cacheType],
    ["size", query.size],
    ["country", query.country],
    ["region", query.region]
  ] as const;
  for (const [field, value] of exactFields) {
    const trimmed = value?.trim();
    if (trimmed) {
      filters.push({ [field]: trimmed });
    }
  }

  const difficultyMin = mapNumber(query.difficultyMin, "difficultyMin");
  const difficultyMax = mapNumber(query.difficultyMax, "difficultyMax");
  if (difficultyMin !== undefined || difficultyMax !== undefined) {
    filters.push({
      difficulty: {
        ...(difficultyMin !== undefined ? { gte: difficultyMin } : {}),
        ...(difficultyMax !== undefined ? { lte: difficultyMax } : {})
      }
    });
  }

  const terrainMin = mapNumber(query.terrainMin, "terrainMin");
  const terrainMax = mapNumber(query.terrainMax, "terrainMax");
  if (terrainMin !== undefined || terrainMax !== undefined) {
    filters.push({
      terrain: {
        ...(terrainMin !== undefined ? { gte: terrainMin } : {}),
        ...(terrainMax !== undefined ? { lte: terrainMax } : {})
      }
    });
  }

  if (filters.length === 0) {
    return undefined;
  }
  return filters.length === 1 ? filters[0] : { AND: filters };
}

function findMapWhere(base: Prisma.FindWhereInput, query: MapPointsQueryDto, snapshot: Date): Prisma.FindWhereInput {
  const conditions: Prisma.FindWhereInput[] = [base, { createdAt: { lte: snapshot } }];
  const cache = mapCacheWhere(query);
  const dateRange = mapDateRange(query);
  if (cache) {
    conditions.push({ cache });
  }
  if (dateRange) {
    conditions.push({ foundAt: dateRange });
  }
  return { AND: conditions };
}

function hideMapWhere(base: Prisma.HideWhereInput, query: MapPointsQueryDto, snapshot: Date): Prisma.HideWhereInput {
  const conditions: Prisma.HideWhereInput[] = [base, { createdAt: { lte: snapshot } }];
  const cache = mapCacheWhere(query);
  const dateRange = mapDateRange(query);
  if (cache) {
    conditions.push({ cache });
  }
  if (dateRange) {
    conditions.push({ placedAt: dateRange });
  }
  return { AND: conditions };
}

type LocationBucket = {
  name: string;
  count: number;
};

type CountryBucket = LocationBucket & {
  continent: string;
  regions: LocationBucket[];
  counties: LocationBucket[];
};

function locationName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNKNOWN_LOCATION;
}

function increment(map: Map<string, number>, name: string) {
  map.set(name, (map.get(name) ?? 0) + 1);
}

function sortedBuckets(map: Map<string, number>): LocationBucket[] {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function continentFor(latitude: number, longitude: number, country?: string | null) {
  const countryContinent = country ? COUNTRY_CONTINENTS.get(country.trim().toLowerCase()) : null;
  if (countryContinent) {
    return countryContinent;
  }

  if (latitude < -60) {
    return "Antarctica";
  }

  if (latitude >= -35 && latitude <= 38 && longitude >= -20 && longitude <= 55) {
    return "Africa";
  }

  if (latitude >= 12 && latitude <= 72 && longitude >= -25 && longitude <= 45) {
    return "Europe";
  }

  if (latitude >= -12 && latitude <= 82 && longitude >= 26 && longitude <= 180) {
    return "Asia";
  }

  if (latitude >= -56 && latitude <= 13 && longitude >= -82 && longitude <= -34) {
    return "South America";
  }

  if (latitude >= 5 && latitude <= 84 && longitude >= -170 && longitude <= -50) {
    return "North America";
  }

  if (latitude >= -50 && latitude <= 0 && longitude >= 110 && longitude <= 180) {
    return "Oceania";
  }

  return "Unknown";
}

@Controller("map")
@UseGuards(AuthGuard)
export class MapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly travelSearch: TravelSearchService
  ) {}

  private async countableFindWhereForUser(userId: string) {
    const profile = await this.prisma.geocachingProfile.findUnique({
      where: { userId },
      select: { gcUsername: true }
    });
    return countableFindWhere(userId, normalizedGcUsername(profile));
  }

  private async mapSnapshotRevision(userId: string) {
    // A cursor spans separate requests, so a timestamp alone cannot freeze a
    // history while an import transaction is committing. Detect changed rows
    // and make the client restart from a fresh snapshot instead.
    const [latestImport, findCount, hideCount] = await Promise.all([
      this.prisma.import.findFirst({
        where: { userId },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        select: { id: true, updatedAt: true, createdAt: true }
      }),
      this.prisma.find.count({ where: { userId } }),
      this.prisma.hide.count({ where: { userId } })
    ]);
    const importRevision = latestImport
      ? `${latestImport.id}:${latestImport.updatedAt.toISOString()}:${latestImport.createdAt.toISOString()}`
      : "none";
    return `${importRevision}:${findCount}:${hideCount}`;
  }

  private async validateMapSnapshot(userId: string, query: MapPointsQueryDto, cursor: string | undefined) {
    const requestedRevision = query.snapshotRevision?.trim() || undefined;
    const revision = await this.mapSnapshotRevision(userId);
    if (cursor && !query.snapshot) {
      throw new BadRequestException("snapshot is required for pagination");
    }
    if (cursor && !requestedRevision) {
      throw new BadRequestException("snapshot revision is required for pagination");
    }
    if (requestedRevision && requestedRevision !== revision) {
      throw new ConflictException("map snapshot expired");
    }
    return revision;
  }

  @Get("place-suggestions")
  async placeSuggestions(@CurrentUser() user: AuthUser, @Query() query: PlaceSuggestionQueryDto) {
    return this.travelSearch.suggestPlaces(user.id, query.q);
  }

  @Get("travel-pool")
  async travelPool(@CurrentUser() user: AuthUser) {
    return this.travelSearch.poolSummary(user.id);
  }

  @Post("travel-search")
  async travel(@CurrentUser() user: AuthUser, @Body() body: TravelSearchDto) {
    return this.travelSearch.search(user.id, {
      mode: body.mode,
      origin: body.origin.trim(),
      destination: body.destination?.trim(),
      radiusKm: body.radiusKm,
      includeFound: body.includeFound ?? false,
      mysteryCaches: body.mysteryCaches ?? [],
      originPlace: body.originPlace,
      destinationPlace: body.destinationPlace
    });
  }

  @Get("caches")
  async caches(@CurrentUser() user: AuthUser, @Query() query: MapPointsQueryDto = {}) {
    const cursor = query.cursor?.trim() || undefined;
    const snapshotRevision = await this.validateMapSnapshot(user.id, query, cursor);
    const snapshot = mapSnapshot(query.snapshot);
    const where = findMapWhere(await this.countableFindWhereForUser(user.id), query, snapshot);
    const totalCount = cursor ? undefined : await this.prisma.find.count({ where });
    let finds: any[];
    try {
      finds = await this.prisma.find.findMany({
        where,
        select: {
          id: true,
          foundAt: true,
          cache: {
            select: {
              id: true,
              gcCode: true,
              name: true,
              cacheType: true,
              difficulty: true,
              terrain: true,
              size: true,
              latitude: true,
              longitude: true,
              country: true,
              region: true,
              county: true,
              hiddenDate: true
            }
          }
        },
        // Imports can update foundAt, so use immutable creation order for the cursor.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAP_CACHE_LIMIT + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
    } catch (error) {
      if (isPrismaError(error, "P2025")) {
        throw new BadRequestException("invalid cursor");
      }
      throw error;
    }
    if (await this.mapSnapshotRevision(user.id) !== snapshotRevision) {
      throw new ConflictException("map snapshot expired");
    }
    const truncated = finds.length > MAP_CACHE_LIMIT;
    const visibleFinds = truncated ? finds.slice(0, MAP_CACHE_LIMIT) : finds;

    return {
      truncated,
      limit: MAP_CACHE_LIMIT,
      snapshot: snapshot.toISOString(),
      snapshotRevision,
      totalCount,
      nextCursor: truncated ? visibleFinds.at(-1)?.id ?? null : null,
      points: visibleFinds.map((find) => ({
        id: find.cache.id,
        gcCode: find.cache.gcCode,
        name: find.cache.name,
        cacheType: find.cache.cacheType,
        difficulty: find.cache.difficulty === null ? null : Number(find.cache.difficulty),
        terrain: find.cache.terrain === null ? null : Number(find.cache.terrain),
        size: find.cache.size,
        latitude: Number(find.cache.latitude),
        longitude: Number(find.cache.longitude),
        country: find.cache.country,
        region: find.cache.region,
        county: find.cache.county,
        hiddenDate: find.cache.hiddenDate?.toISOString() ?? null,
        foundAt: find.foundAt.toISOString()
      }))
    };
  }

  @Get("hides")
  async hides(@CurrentUser() user: AuthUser, @Query() query: MapPointsQueryDto = {}) {
    const cursor = query.cursor?.trim() || undefined;
    const snapshotRevision = await this.validateMapSnapshot(user.id, query, cursor);
    const snapshot = mapSnapshot(query.snapshot);
    const where = hideMapWhere({ userId: user.id }, query, snapshot);
    const totalCount = cursor ? undefined : await this.prisma.hide.count({ where });
    let hides: any[];
    try {
      hides = await this.prisma.hide.findMany({
        where,
        select: {
          id: true,
          placedAt: true,
          cache: {
            select: {
              id: true,
              gcCode: true,
              name: true,
              cacheType: true,
              difficulty: true,
              terrain: true,
              size: true,
              latitude: true,
              longitude: true,
              country: true,
              region: true,
              county: true,
              hiddenDate: true
            }
          }
        },
        // Imports can update placedAt, so use immutable creation order for the cursor.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAP_CACHE_LIMIT + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
      });
    } catch (error) {
      if (isPrismaError(error, "P2025")) {
        throw new BadRequestException("invalid cursor");
      }
      throw error;
    }
    if (await this.mapSnapshotRevision(user.id) !== snapshotRevision) {
      throw new ConflictException("map snapshot expired");
    }
    const truncated = hides.length > MAP_CACHE_LIMIT;
    const visibleHides = truncated ? hides.slice(0, MAP_CACHE_LIMIT) : hides;

    return {
      truncated,
      limit: MAP_CACHE_LIMIT,
      snapshot: snapshot.toISOString(),
      snapshotRevision,
      totalCount,
      nextCursor: truncated ? visibleHides.at(-1)?.id ?? null : null,
      points: visibleHides.map((hide) => ({
        id: hide.cache.id,
        gcCode: hide.cache.gcCode,
        name: hide.cache.name,
        cacheType: hide.cache.cacheType,
        difficulty: hide.cache.difficulty === null ? null : Number(hide.cache.difficulty),
        terrain: hide.cache.terrain === null ? null : Number(hide.cache.terrain),
        size: hide.cache.size,
        latitude: Number(hide.cache.latitude),
        longitude: Number(hide.cache.longitude),
        country: hide.cache.country,
        region: hide.cache.region,
        county: hide.cache.county,
        hiddenDate: hide.cache.hiddenDate?.toISOString() ?? null,
        placedAt: hide.placedAt?.toISOString() ?? "",
        isOwnHide: true
      }))
    };
  }

  @Get("scratch")
  async scratch(@CurrentUser() user: AuthUser) {
    const finds = await this.prisma.find.findMany({
      where: await this.countableFindWhereForUser(user.id),
      select: {
        cache: {
          select: {
            country: true,
            region: true,
            county: true,
            latitude: true,
            longitude: true
          }
        }
      },
      orderBy: { foundAt: "desc" },
      take: MAP_CACHE_LIMIT + 1
    });
    const truncated = finds.length > MAP_CACHE_LIMIT;
    const visibleFinds = truncated ? finds.slice(0, MAP_CACHE_LIMIT) : finds;

    const continents = new Map<string, number>();
    const countries = new Map<
      string,
      CountryBucket & {
        regionMap: Map<string, number>;
        countyMap: Map<string, number>;
      }
    >();

    for (const find of visibleFinds) {
      const latitude = Number(find.cache.latitude);
      const longitude = Number(find.cache.longitude);
      const country = locationName(find.cache.country);
      const region = locationName(find.cache.region);
      const county = locationName(find.cache.county);
      const continent = continentFor(latitude, longitude, find.cache.country);

      increment(continents, continent);

      const existing = countries.get(country) ?? {
        name: country,
        continent,
        count: 0,
        regions: [],
        counties: [],
        regionMap: new Map<string, number>(),
        countyMap: new Map<string, number>()
      };

      existing.count += 1;
      increment(existing.regionMap, region);
      increment(existing.countyMap, county);
      countries.set(country, existing);
    }

    const countryBuckets: CountryBucket[] = [...countries.values()]
      .map((country) => ({
        name: country.name,
        continent: country.continent,
        count: country.count,
        regions: sortedBuckets(country.regionMap),
        counties: sortedBuckets(country.countyMap)
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    return {
      totalFinds: visibleFinds.length,
      truncated,
      limit: MAP_CACHE_LIMIT,
      continents: sortedBuckets(continents),
      countries: countryBuckets,
      maxCountryCount: Math.max(0, ...countryBuckets.map((country) => country.count))
    };
  }
}
