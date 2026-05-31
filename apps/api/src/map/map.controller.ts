import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthUser } from "@geostats/shared";
import { AuthGuard } from "../auth/auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { PrismaService } from "../common/prisma.service";

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
    ["Spain", "Europe"]
  ].map(([country, continent]) => [country.toLowerCase(), continent])
);

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
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  constructor(private readonly prisma: PrismaService) {}

  @Get("caches")
  async caches(@CurrentUser() user: AuthUser) {
    const finds = await this.prisma.find.findMany({
      where: { userId: user.id },
      select: {
        foundAt: true,
        cache: {
          select: {
            id: true,
            gcCode: true,
            name: true,
            cacheType: true,
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

    return {
      truncated,
      limit: MAP_CACHE_LIMIT,
      points: visibleFinds.map((find) => ({
        id: find.cache.id,
        gcCode: find.cache.gcCode,
        name: find.cache.name,
        cacheType: find.cache.cacheType,
        latitude: Number(find.cache.latitude),
        longitude: Number(find.cache.longitude),
        foundAt: find.foundAt.toISOString()
      }))
    };
  }

  @Get("scratch")
  async scratch(@CurrentUser() user: AuthUser) {
    const finds = await this.prisma.find.findMany({
      where: { userId: user.id },
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
    const countries = new Map<string, CountryBucket & { regionMap: Map<string, number>; countyMap: Map<string, number> }>();

    for (const find of visibleFinds) {
      const latitude = Number(find.cache.latitude);
      const longitude = Number(find.cache.longitude);
      const country = locationName(find.cache.country);
      const region = locationName(find.cache.region);
      const county = locationName(find.cache.county);
      const continent = continentFor(latitude, longitude, find.cache.country);

      increment(continents, continent);

      const existing =
        countries.get(country) ??
        {
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
