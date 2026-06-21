"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Award,
  CalendarDays,
  Compass,
  Crown,
  Gem,
  Globe2,
  Grid3X3,
  MapPin,
  Mountain,
  PartyPopper,
  Route,
  Star,
  Trophy,
  type LucideIcon
} from "lucide-react";
import type { CacheMapPoint } from "./cache-map";
import { apiFetch } from "../lib/api";
import { boundaryNames, deriveBucketsFromBoundaries } from "../lib/scratch-boundaries";
import {
  boundaryConfigForLevel,
  filterKnownLocationBuckets,
  isUnknownLocationName
} from "../lib/scratch-boundary-config";

type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type DifficultyTerrainCell = { difficulty: number; terrain: number; count: number };
type StatsSummary = {
  totalFinds?: number;
  cacheTypes?: CountBucket[];
  sizes?: CountBucket[];
  countries?: CountBucket[];
  regions?: CountBucket[];
  findsByYear?: CountBucket[];
  foundDateMatrix?: CountBucket[];
  hiddenMonthMatrix?: CountBucket[];
  elevationBuckets?: CountBucket[];
  difficultyTerrain?: DifficultyTerrainCell[];
  wayTo81?: unknown[];
  streaks?: { longest?: number; current?: number };
  summaryNumbers?: { bestDay?: CountBucket | null };
  ftfStats?: { total?: number };
  hideStats?: { totalHides?: number; totalFavoritePoints?: number; hostedEventCaches?: number };
  distanceStats?: { bearingBuckets?: PercentBucket[]; averageDistanceKm?: number | null; maxDistanceKm?: number | null };
  achievementStats?: {
    distinctAttributes?: number;
    maxCacheTypesInDay?: number;
    maxDistanceKm?: number | null;
    longLogsWritten?: number;
    hostedEventCaches?: number;
  };
};

type BadgeDefinition = {
  id: string;
  name: string;
  metric: string;
  current: number | null;
  thresholds: number[];
  icon: LucideIcon;
  lowerIsBetter?: boolean;
};

type CountryBadge = {
  name: string;
  current: number;
  completedRegions: number;
  totalRegions: number | null;
  thresholds: number[];
};

type BadgeSortMode = "level" | "alpha";
type ScratchLocationBucket = { name: string; count: number };
type ScratchCountryBucket = ScratchLocationBucket & {
  continent: string;
  regions: ScratchLocationBucket[];
  counties: ScratchLocationBucket[];
};
type ScratchMapData = {
  countries: ScratchCountryBucket[];
};

const tiers = ["Bronze", "Silver", "Gold", "Platinum", "Ruby", "Sapphire", "Emerald", "Diamond"];
const tierClasses = ["bronze", "silver", "gold", "platinum", "ruby", "sapphire", "emerald", "diamond"];
const countryRegionPercentThresholds = [1, 15, 20, 30, 40, 50, 75, 100];
const countryRegionCountThresholds = [1, 5, 10, 25, 50, 100, 200, 500];

const cacheTypeAliases: Record<string, string[]> = {
  traditional: ["traditional cache"],
  multi: ["multi-cache", "multi cache"],
  mystery: ["mystery cache", "unknown cache", "mystery/unknown cache"],
  letterbox: ["letterbox hybrid"],
  earth: ["earthcache", "earth cache"],
  wherigo: ["wherigo cache"],
  virtual: ["virtual cache"],
  webcam: ["webcam cache"],
  event: ["event cache"],
  cito: ["cache in trash out event", "cito event"],
  mega: ["mega-event cache", "mega event cache"],
  giga: ["giga-event cache", "giga event cache"],
  gpsMaze: ["gps adventures exhibit", "gps maze exhibit", "gps maze"],
  challenge: ["challenge cache"]
};

function countForBucket(buckets: CountBucket[] | undefined, names: string[]) {
  const normalized = new Set(names.map((name) => name.toLowerCase()));
  return (buckets ?? []).reduce((sum, bucket) => {
    return normalized.has(bucket.key.toLowerCase()) ? sum + bucket.count : sum;
  }, 0);
}

function uniqueDifficultyTerrain(cells: DifficultyTerrainCell[] | undefined) {
  return new Set((cells ?? []).map((cell) => `${cell.difficulty}/${cell.terrain}`)).size;
}

function countDifficultyTerrain(cells: DifficultyTerrainCell[] | undefined, difficulty?: number, terrain?: number) {
  return (cells ?? []).reduce((sum, cell) => {
    const matchesDifficulty = difficulty == null || cell.difficulty === difficulty;
    const matchesTerrain = terrain == null || cell.terrain === terrain;
    return matchesDifficulty && matchesTerrain ? sum + cell.count : sum;
  }, 0);
}

function coveredBearingSectors(buckets: PercentBucket[] | undefined) {
  return (buckets ?? []).filter((bucket) => bucket.count > 0).length;
}

function buildBadges(stats: StatsSummary | null): BadgeDefinition[] {
  const typeBuckets = stats?.cacheTypes ?? [];
  const sizeBuckets = stats?.sizes ?? [];
  const hideStats = stats?.hideStats;
  const achievementStats = stats?.achievementStats;

  return [
    {
      id: "long-distance",
      name: "The Long-Distance Cacher",
      metric: "Farthest cache from home",
      current: achievementStats?.maxDistanceKm ?? stats?.distanceStats?.maxDistanceKm ?? null,
      thresholds: [1000, 1200, 1500, 2000, 2900, 4200, 6400, 10000],
      icon: Globe2
    },
    {
      id: "attribute",
      name: "The Attribute Cacher",
      metric: "Distinct attributes",
      current: achievementStats?.distinctAttributes ?? null,
      thresholds: [50, 70, 82, 88, 94, 100, 105, 108],
      icon: Award
    },
    {
      id: "large",
      name: "The Large Cacher",
      metric: "Large caches",
      current: countForBucket(sizeBuckets, ["large"]),
      thresholds: [3, 10, 20, 40, 60, 80, 120, 180],
      icon: Award
    },
    {
      id: "matrix",
      name: "The Matrix Cacher",
      metric: "D/T combinations",
      current: Math.max(stats?.wayTo81?.length ?? 0, uniqueDifficultyTerrain(stats?.difficultyTerrain)),
      thresholds: [25, 35, 50, 60, 70, 78, 80, 81],
      icon: Grid3X3
    },
    {
      id: "jasmer",
      name: "The Jasmer Cacher",
      metric: "Hidden months",
      current: stats?.hiddenMonthMatrix?.length ?? 0,
      thresholds: [36, 72, 144, 216, 283, 298, 308, 313],
      icon: CalendarDays
    },
    {
      id: "diverse",
      name: "The Diverse Cacher",
      metric: "Distinct cache types in a day",
      current: achievementStats?.maxCacheTypesInDay ?? null,
      thresholds: [3, 4, 6, 7, 8, 9, 10, 11],
      icon: PartyPopper
    },
    {
      id: "brainiac",
      name: "The Brainiac",
      metric: "D5 finds",
      current: countDifficultyTerrain(stats?.difficultyTerrain, 5),
      thresholds: [2, 4, 6, 10, 15, 30, 50, 100],
      icon: Crown
    },
    {
      id: "adventurous",
      name: "The Adventurous Cacher",
      metric: "D5/T5 finds",
      current: countDifficultyTerrain(stats?.difficultyTerrain, 5, 5),
      thresholds: [1, 2, 3, 5, 8, 12, 18, 30],
      icon: Mountain
    },
    {
      id: "all-around",
      name: "The All Around Cacher",
      metric: "Bearing degrees",
      current: coveredBearingSectors(stats?.distanceStats?.bearingBuckets),
      thresholds: [90, 120, 180, 270, 300, 330, 350, 360],
      icon: Compass
    },
    {
      id: "traveling",
      name: "The Traveling Cacher",
      metric: "Countries",
      current: stats?.countries?.length ?? 0,
      thresholds: [2, 3, 5, 8, 12, 18, 25, 35],
      icon: Globe2
    },
    {
      id: "veteran",
      name: "The Caching Veteran",
      metric: "Caching years",
      current: stats?.findsByYear?.length ?? 0,
      thresholds: [2, 3, 4, 5, 6, 7, 8, 10],
      icon: Award
    },
    {
      id: "traditional",
      name: "The Traditional Cacher",
      metric: "Traditional caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.traditional),
      thresholds: [400, 1000, 2000, 3000, 5000, 7000, 10000, 14000],
      icon: MapPin
    },
    {
      id: "multi",
      name: "The Multi Cacher",
      metric: "Multi caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.multi),
      thresholds: [50, 100, 200, 300, 500, 800, 1000, 1200],
      icon: Route
    },
    {
      id: "mystery",
      name: "The Mysterious Cacher",
      metric: "Mystery caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.mystery),
      thresholds: [50, 100, 200, 300, 500, 800, 1200, 1800],
      icon: Gem
    },
    {
      id: "letterboxer",
      name: "The Letterboxer",
      metric: "Letterbox Hybrid caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.letterbox),
      thresholds: [5, 6, 7, 8, 10, 15, 25, 50],
      icon: Award
    },
    {
      id: "earth",
      name: "The Earth Cacher",
      metric: "EarthCaches",
      current: countForBucket(typeBuckets, cacheTypeAliases.earth),
      thresholds: [5, 10, 20, 30, 50, 80, 120, 180],
      icon: Globe2
    },
    {
      id: "wherigo",
      name: "The Wherigo Cacher",
      metric: "Wherigo caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.wherigo),
      thresholds: [2, 3, 5, 10, 15, 25, 40, 60],
      icon: Compass
    },
    {
      id: "virtual",
      name: "The Virtual Cacher",
      metric: "Virtual caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.virtual),
      thresholds: [5, 10, 20, 30, 50, 80, 120, 180],
      icon: Globe2
    },
    {
      id: "photogenic",
      name: "The Photogenic Cacher",
      metric: "Webcam caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.webcam),
      thresholds: [2, 3, 5, 8, 12, 18, 25, 40],
      icon: Star
    },
    {
      id: "social",
      name: "The Social Cacher",
      metric: "Event caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.event),
      thresholds: [5, 10, 20, 30, 50, 80, 120, 180],
      icon: PartyPopper
    },
    {
      id: "environmental",
      name: "The Environmental Cacher",
      metric: "CITO events",
      current: countForBucket(typeBuckets, cacheTypeAliases.cito),
      thresholds: [2, 3, 4, 5, 6, 8, 10, 12],
      icon: Globe2
    },
    {
      id: "mega-social",
      name: "The Mega Social Cacher",
      metric: "Mega Event caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.mega),
      thresholds: [1, 2, 3, 4, 5, 6, 8, 10],
      icon: PartyPopper
    },
    {
      id: "giga-social",
      name: "The Giga Social Cacher",
      metric: "Giga Event caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.giga),
      thresholds: [1, 2, 3, 4, 5, 6, 7, 8],
      icon: PartyPopper
    },
    {
      id: "gps-maze",
      name: "The GPS Maze Cacher",
      metric: "GPS Maze caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.gpsMaze),
      thresholds: [1, 2, 3, 4, 5, 6, 7, 8],
      icon: Compass
    },
    {
      id: "odd-sized",
      name: "The Odd-sized Cacher",
      metric: "Other/Unknown size caches",
      current: countForBucket(sizeBuckets, ["other", "not chosen", "unknown", "other/unknown"]),
      thresholds: [75, 125, 200, 300, 450, 600, 800, 1200],
      icon: Award
    },
    {
      id: "micro",
      name: "The Micro Cacher",
      metric: "Micro caches",
      current: countForBucket(sizeBuckets, ["micro"]),
      thresholds: [200, 300, 500, 800, 1200, 1800, 3000, 4500],
      icon: Award
    },
    {
      id: "small",
      name: "The Small Cacher",
      metric: "Small caches",
      current: countForBucket(sizeBuckets, ["small"]),
      thresholds: [150, 200, 300, 500, 800, 1200, 1800, 3000],
      icon: Award
    },
    {
      id: "regular",
      name: "The Regular Cacher",
      metric: "Regular caches",
      current: countForBucket(sizeBuckets, ["regular"]),
      thresholds: [100, 150, 225, 350, 550, 800, 1200, 1600],
      icon: Award
    },
    {
      id: "rugged",
      name: "The Rugged Cacher",
      metric: "T5 finds",
      current: countDifficultyTerrain(stats?.difficultyTerrain, undefined, 5),
      thresholds: [5, 10, 20, 30, 50, 70, 100, 150],
      icon: Mountain
    },
    {
      id: "ftf",
      name: "The FTF Addict",
      metric: "First-to-Finds",
      current: stats?.ftfStats?.total ?? 0,
      thresholds: [15, 20, 30, 50, 80, 120, 180, 300],
      icon: Star
    },
    {
      id: "geocacher",
      name: "The Geocacher",
      metric: "Total finds",
      current: stats?.totalFinds ?? 0,
      thresholds: [500, 1000, 2000, 3000, 5000, 8000, 12000, 18000],
      icon: Trophy
    },
    {
      id: "calendar",
      name: "The Calendar Cacher",
      metric: "Calendar days",
      current: stats?.foundDateMatrix?.length ?? 0,
      thresholds: [90, 150, 220, 280, 330, 350, 365, 366],
      icon: CalendarDays
    },
    {
      id: "daily",
      name: "The Daily Cacher",
      metric: "Longest streak",
      current: stats?.streaks?.longest ?? 0,
      thresholds: [7, 14, 30, 60, 122, 183, 274, 365],
      icon: Route
    },
    {
      id: "busy",
      name: "The Busy Cacher",
      metric: "Best day",
      current: stats?.summaryNumbers?.bestDay?.count ?? 0,
      thresholds: [20, 30, 50, 80, 120, 180, 270, 400],
      icon: Star
    },
    {
      id: "achiever",
      name: "The Achiever",
      metric: "Challenge caches",
      current: countForBucket(typeBuckets, cacheTypeAliases.challenge),
      thresholds: [5, 20, 40, 80, 150, 225, 350, 500],
      icon: Trophy
    },
    {
      id: "trackable",
      name: "The Trackable Lover",
      metric: "Discovered Trackables",
      current: null,
      thresholds: [50, 100, 200, 300, 500, 800, 1200, 1800],
      icon: Award
    },
    {
      id: "author",
      name: "The Author",
      metric: "Long logs written",
      current: achievementStats?.longLogsWritten ?? null,
      thresholds: [30, 40, 50, 60, 70, 80, 90, 100],
      icon: Award
    },
    {
      id: "owner",
      name: "The Cache Owner",
      metric: "Hidden caches",
      current: hideStats?.totalHides ?? 0,
      thresholds: [10, 15, 20, 30, 50, 80, 120, 200],
      icon: Crown
    },
    {
      id: "favorited-owner",
      name: "The Favorited Owner",
      metric: "Favorite points received",
      current: hideStats?.totalFavoritePoints ?? 0,
      thresholds: [25, 40, 60, 90, 150, 210, 320, 500],
      icon: Star
    },
    {
      id: "event-host",
      name: "The Event Host",
      metric: "Hosted event caches",
      current: achievementStats?.hostedEventCaches ?? hideStats?.hostedEventCaches ?? null,
      thresholds: [1, 2, 3, 5, 8, 12, 18, 30],
      icon: PartyPopper
    }
  ];
}

function achievedIndex(badge: { current: number | null; thresholds: number[]; lowerIsBetter?: boolean }) {
  if (badge.current == null) {
    return -1;
  }
  return badge.thresholds.reduce((latest, threshold, index) => {
    const achieved = badge.lowerIsBetter ? badge.current! <= threshold : badge.current! >= threshold;
    return achieved ? index : latest;
  }, -1);
}

function nextThreshold(badge: BadgeDefinition, index: number) {
  return badge.thresholds[index + 1] ?? null;
}

function remainingLabel(badge: BadgeDefinition, index: number) {
  if (badge.current == null) {
    return "Needs data";
  }
  const next = nextThreshold(badge, index);
  if (next == null) {
    return "Done";
  }
  const remaining = badge.lowerIsBetter ? Math.max(0, badge.current - next) : Math.max(0, next - badge.current);
  return String(Math.ceil(remaining));
}

function countCompletedRegions(country: ScratchCountryBucket) {
  return country.regions.filter((region) => !isUnknownLocationName(region.name) && region.count > 0).length;
}

function buildCountryBadges(countries: ScratchCountryBucket[], totalRegionCounts: Map<string, number>): CountryBadge[] {
  return countries
    .filter((country) => !isUnknownLocationName(country.name) && countCompletedRegions(country) > 0)
    .map((country) => {
      const completedRegions = countCompletedRegions(country);
      const totalRegions = totalRegionCounts.get(country.name) ?? null;
      const current = totalRegions && totalRegions > 0 ? (completedRegions / totalRegions) * 100 : completedRegions;
      return {
        name: country.name,
        current,
        completedRegions,
        totalRegions,
        thresholds: totalRegions && totalRegions > 0 ? countryRegionPercentThresholds : countryRegionCountThresholds
      };
    })
    .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));
}

function withDerivedRegions(
  countries: ScratchCountryBucket[],
  derivedRegions: Map<string, ScratchLocationBucket[]>
) {
  return countries.map((country) => {
    const regions = derivedRegions.get(country.name);
    return {
      ...country,
      regions: regions && regions.length > 0 ? regions : filterKnownLocationBuckets(country.regions)
    };
  });
}

function sortByMode<T extends { current: number | null; thresholds: number[]; lowerIsBetter?: boolean }>(
  items: T[],
  mode: BadgeSortMode,
  nameFor: (item: T) => string,
  reversed: boolean
) {
  return [...items].sort((a, b) => {
    const direction = reversed ? -1 : 1;

    if (mode === "alpha") {
      return direction * nameFor(a).localeCompare(nameFor(b));
    }

    const levelDiff = achievedIndex(b) - achievedIndex(a);
    if (levelDiff !== 0) {
      return direction * levelDiff;
    }

    const aVal = a.current ?? -Infinity;
    const bVal = b.current ?? -Infinity;
    const currentDiff = a.lowerIsBetter ? aVal - bVal : bVal - aVal;
    if (currentDiff !== 0) {
      return direction * currentDiff;
    }

    return direction * nameFor(a).localeCompare(nameFor(b));
  });
}

function tierSummary(items: { current: number | null; thresholds: number[]; lowerIsBetter?: boolean }[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const index = achievedIndex(item);
    if (index >= 0) {
      counts.set(tiers[index]!, (counts.get(tiers[index]!) ?? 0) + 1);
    }
  });

  return [...tiers]
    .reverse()
    .map((tier) => ({ tier, count: counts.get(tier) ?? 0 }));
}

export function AchievementBadges({
  id,
  stats: providedStats = null,
  variant = "sidebar"
}: {
  id?: string;
  stats?: StatsSummary | null;
  variant?: "sidebar" | "dashboard";
}) {
  const [stats, setStats] = useState<StatsSummary | null>(providedStats);
  const [scratchCountries, setScratchCountries] = useState<ScratchCountryBucket[]>([]);
  const [countryRegionTotals, setCountryRegionTotals] = useState<Map<string, number>>(() => new Map());
  const [error, setError] = useState(false);
  const [sortMode, setSortMode] = useState<BadgeSortMode>("level");
  const [sortReversed, setSortReversed] = useState(false);

  useEffect(() => {
    if (providedStats) {
      setStats(providedStats);
      return;
    }

    let active = true;
    void apiFetch<{ stats: StatsSummary }>("/stats/summary")
      .then((data) => {
        if (active) {
          setStats(data.stats);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [providedStats]);

  useEffect(() => {
    let active = true;
    void apiFetch<ScratchMapData>("/map/scratch")
      .then(async (data) => {
        if (active) {
          setScratchCountries(data.countries);
        }
        const detailCountries = await Promise.all(
          data.countries
            .filter((country) => !isUnknownLocationName(country.name))
            .map(async (country) => {
              const config = await boundaryConfigForLevel("regions", country.name);
              return config.isDetail ? { name: country.name, url: config.url, propertyName: config.propertyName } : null;
            })
        );
        const supportedDetailCountries = detailCountries.filter((country): country is NonNullable<typeof country> => Boolean(country));

        if (supportedDetailCountries.length === 0) {
          if (active) {
            setCountryRegionTotals(new Map());
          }
          return;
        }

        try {
          const pointsData = await apiFetch<{ points: CacheMapPoint[] }>("/map/caches");
          const derivedRegions = await Promise.all(
            supportedDetailCountries.map(async (country) => [
              country.name,
              await deriveBucketsFromBoundaries(pointsData.points, country.url, country.propertyName)
            ] as const)
          );
          const regionTotals = await Promise.all(
            supportedDetailCountries.map(async (country) => [
              country.name,
              (await boundaryNames(country.url, country.propertyName)).length
            ] as const)
          );
          if (active) {
            setScratchCountries(
              withDerivedRegions(
                data.countries,
                new Map(derivedRegions)
              )
            );
            setCountryRegionTotals(new Map(regionTotals));
          }
        } catch {
          if (active) {
            setScratchCountries(data.countries);
            setCountryRegionTotals(new Map());
          }
        }
      })
      .catch(() => {
        if (active) {
          setScratchCountries([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const badges = useMemo(() => buildBadges(stats), [stats]);
  const countryBadges = useMemo(
    () => buildCountryBadges(scratchCountries, countryRegionTotals),
    [countryRegionTotals, scratchCountries]
  );
  const sortedBadges = useMemo(
    () => sortByMode(badges, sortMode, (badge) => badge.name, sortReversed),
    [badges, sortMode, sortReversed]
  );
  const sortedCountryBadges = useMemo(
    () => sortByMode(countryBadges, sortMode, (badge) => badge.name, sortReversed),
    [countryBadges, sortMode, sortReversed]
  );
  const achievedCount = badges.filter((badge) => achievedIndex(badge) >= 0).length;
  const countryAchievementCount = countryBadges.filter((badge) => achievedIndex(badge) >= 0).length;
  const countryTierSummary = tierSummary(countryBadges);
  const achievementTierSummary = tierSummary(badges);

  if (error) {
    return null;
  }

  return (
    <section
      id={id}
      className={variant === "dashboard" ? "sidebar-badges dashboard-badges panel" : "sidebar-badges"}
      aria-label="Achievement badges"
    >
      <div className="sidebar-badges-heading">
        <span>
          <small>Badges</small>
          <strong>
            {countryAchievementCount + achievedCount}/{countryBadges.length + badges.length}
          </strong>
        </span>
        <div className="badge-sort-controls" aria-label="Sort badges">
          <button className={sortMode === "level" ? "active" : ""} type="button" onClick={() => setSortMode("level")}>
            {sortReversed ? "Lowest level" : "Highest level"}
          </button>
          <button className={sortMode === "alpha" ? "active" : ""} type="button" onClick={() => setSortMode("alpha")}>
            {sortReversed ? "Z-A" : "A-Z"}
          </button>
          <button
            className={sortReversed ? "active" : ""}
            type="button"
            onClick={() => setSortReversed((current) => !current)}
          >
            {sortReversed ? "Normal" : "Reverse"}
          </button>
        </div>
      </div>
      <div className="country-badges-heading">
        <span>
          <small>Country badges</small>
        </span>
        <Globe2 size={16} />
      </div>
      <div className="badge-summary-strip">
        {countryTierSummary.map(({ tier, count }) => (
          <span key={tier}>
            {count} {tier.toLowerCase()}
          </span>
        ))}
      </div>
      <div className="country-badge-list">
        {sortedCountryBadges.map((badge) => {
          const index = achievedIndex(badge);
          const tier = index >= 0 ? tiers[index] : "Locked";
          const tierClass = index >= 0 ? tierClasses[index] : "locked";
          return (
            <article key={badge.name} className="country-badge-row" style={{ "--badge-progress": Math.max(0, index + 1) / tiers.length } as CSSProperties}>
              <span className={`badge-icon ${tierClass}`} aria-hidden="true">
                <Globe2 size={16} />
              </span>
              <span>
                <strong>{badge.name}</strong>
                <small>
                  {tier} -{" "}
                  {badge.totalRegions
                    ? `${badge.completedRegions.toLocaleString()}/${badge.totalRegions.toLocaleString()} regions`
                    : `${badge.completedRegions.toLocaleString()} regions`}
                </small>
              </span>
            </article>
          );
        })}
      </div>
      <div className="achievement-badges-heading">
        <span>
          <small>Achievement badges</small>
          <strong>
            {achievedCount}/{badges.length}
          </strong>
        </span>
        <Gem size={16} />
      </div>
      <div className="badge-summary-strip">
        {achievementTierSummary.map(({ tier, count }) => (
          <span key={tier}>
            {count} {tier.toLowerCase()}
          </span>
        ))}
      </div>
      <div className="badge-list">
        {sortedBadges.map((badge) => {
          const Icon = badge.icon;
          const index = achievedIndex(badge);
          const tier = index >= 0 ? tiers[index] : "Locked";
          const tierClass = index >= 0 ? tierClasses[index] : "locked";
          const current = badge.current == null ? "--" : Math.round(badge.current).toLocaleString();
          return (
            <article key={badge.id} className="badge-row" style={{ "--badge-progress": Math.max(0, index + 1) / tiers.length } as CSSProperties}>
              <div className="badge-row-main">
                <span className={`badge-icon ${tierClass}`} aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{badge.name}</strong>
                  <small>
                    {tier} - {badge.metric}
                  </small>
                </span>
              </div>
              <div className="badge-cell-grid" aria-hidden="true">
                {badge.thresholds.map((threshold, thresholdIndex) => (
                  <span
                    key={`${badge.id}-${threshold}`}
                    className={[
                      thresholdIndex <= index ? "earned" : "",
                      thresholdIndex === index ? "current" : ""
                    ].filter(Boolean).join(" ")}
                    title={`${tiers[thresholdIndex]}: ${threshold}`}
                  />
                ))}
              </div>
              <div className="badge-row-numbers">
                <span>
                  <small>Current</small>
                  <strong>{current}</strong>
                </span>
                <span>
                  <small>Remaining</small>
                  <strong>{remainingLabel(badge, index)}</strong>
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
