export interface StatsCache {
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  hiddenDate?: Date | string | null;
  ownerName?: string | null;
  elevationMeters?: number | null;
  raw?: unknown;
}

export interface StatsFind {
  foundAt: Date | string;
  isFtf?: boolean;
  cache: StatsCache;
}

export interface StatsHide {
  placedAt?: Date | string | null;
  receivedLogCount: number;
  cache: StatsCache;
}

export interface HideLog {
  date: string;
  finder: string;
  type: string;
  text: string | null;
  gcCode: string;
  cacheName: string;
}

export interface StatsOptions {
  homeLatitude?: number | null;
  homeLongitude?: number | null;
}

export interface CountBucket {
  key: string;
  count: number;
}

const monthLabels = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];
const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function monthName(monthIndex: number): string {
  return monthLabels[monthIndex] ?? "Unknown";
}

function weekdayName(dayIndex: number): string {
  return weekdayLabels[dayIndex] ?? "Unknown";
}

export interface PercentBucket extends CountBucket {
  percent: number;
}

export interface AverageByYear {
  year: string;
  amount: number;
  average: number;
}

export interface DifficultyTerrainCell {
  difficulty: number;
  terrain: number;
  count: number;
}

export interface Milestone {
  count: number;
  date: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
}

export interface FirstMilestone {
  count: number;
  date: string;
  label: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
}

export interface MilestoneStats {
  countMilestones: Milestone[];
  firstByCountry: FirstMilestone[];
  firstByHomeCountryRegion: FirstMilestone[];
  firstByType: FirstMilestone[];
  firstBySize: FirstMilestone[];
  firstByDifficultyTerrain: FirstMilestone[];
  homeCountry: string | null;
}

export interface StreakStats {
  longest: number;
  current: number;
}

export interface DistanceStats {
  distanceBuckets: PercentBucket[];
  bearingBuckets: PercentBucket[];
  averageDistanceKm: number | null;
}

export interface SummaryNumbers {
  totalFinds: number;
  cachingDays: number;
  totalDays: number;
  findsPerCachingDay: number;
  findsPerDay: number;
  findsPerWeek: number;
  findsPerMonth: number;
  last365Finds: number;
  last365CachingDays: number;
  last365FindsPerCachingDay: number;
  last365FindsPerDay: number;
  last365FindsPerWeek: number;
  last365FindsPerMonth: number;
  bestDay: CountBucket | null;
  bestMonth: CountBucket | null;
}

export interface WayTo81Entry {
  index: number;
  date: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number;
  terrain: number;
}

export interface FtfStats {
  total: number;
  percentOfFinds: number;
  averageIntervalDays: number | null;
  averageDistanceKm: number | null;
  first: FtfRow | null;
  latest: FtfRow | null;
  slowest: FtfRow | null;
  nearest: FtfRow | null;
  furthest: FtfRow | null;
  mostNorthern: FtfRow | null;
  mostSouthern: FtfRow | null;
  mostEastern: FtfRow | null;
  mostWestern: FtfRow | null;
  highest: FtfRow | null;
  lowest: FtfRow | null;
  centroid: { latitude: number; longitude: number; distanceFromHomeKm: number | null } | null;
  archivedCount: number;
  archivedPercent: number;
  bestDay: CountBucket | null;
  bestMonth: CountBucket | null;
  consecutiveMonths: { count: number; start: string; end: string } | null;
  byYear: CountBucket[];
  byMonth: CountBucket[];
  byCalendarMonth: PercentBucket[];
  byWeekday: PercentBucket[];
  byType: PercentBucket[];
  bySize: PercentBucket[];
  byDifficulty: PercentBucket[];
  byTerrain: PercentBucket[];
  averageDifficulty: number;
  averageTerrain: number;
  byCountry: CountBucket[];
  byRegion: CountBucket[];
  byDifficultyTerrain: DifficultyTerrainCell[];
  foundDateMatrix: CountBucket[];
  firstByLocation: FtfFirstRow[];
  firstByType: FtfFirstRow[];
  wayTo81: FtfWayTo81Entry[];
  rows: FtfRow[];
}

export interface FtfRow {
  date: string;
  dateTime: string;
  intervalDays: number | null;
  distanceKm: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  size: string | null;
  difficulty: number | null;
  terrain: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  latitude: number | null;
  longitude: number | null;
  elevationMeters: number | null;
  archived: boolean;
}

export interface FtfFirstRow {
  index: number;
  date: string;
  dateTime: string;
  label: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
}

export interface FtfWayTo81Entry {
  index: number;
  date: string;
  dateTime: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number;
  terrain: number;
}

export interface HideStats {
  totalHides: number;
  activeHides: number;
  archivedHides: number;
  totalReceivedLogs: number;
  totalUniqueFinders: number;
  totalFavoritePoints: number;
  averageLogsPerHide: number;
  receivedLogsByYear: CountBucket[];
  receivedLogsByMonth: CountBucket[];
  cumulativeReceivedLogsByMonth: CountBucket[];
  receivedLogsByCalendarMonth: PercentBucket[];
  receivedLogsByWeekday: PercentBucket[];
  receivedFoundDateMatrix: CountBucket[];
  placedHiddenDateMatrix: CountBucket[];
  hidesByYear: CountBucket[];
  hidesByMonth: CountBucket[];
  hidesByType: PercentBucket[];
  hidesBySize: PercentBucket[];
  hidesByDifficulty: PercentBucket[];
  hidesByTerrain: PercentBucket[];
  hidesByCountry: CountBucket[];
  hidesByRegion: CountBucket[];
  hidesByDifficultyTerrain: DifficultyTerrainCell[];
  finderBuckets: PercentBucket[];
  hideSummaryRows: Array<{ label: string; value: string }>;
  logsReceived: Array<{
    hidden: string | null;
    lastFound: string | null;
    finds: number;
    daysPerFind: number | null;
    favoritePoints: number;
    gcCode: string;
    name: string;
    cacheType: string | null;
  }>;
  topLoggedHides: Array<{
    gcCode: string;
    name: string;
    count: number;
    cacheType: string | null;
    placedAt: string | null;
  }>;
}

export interface StatsSnapshot {
  statsVersion: number;
  totalFinds: number;
  findsByYear: CountBucket[];
  findsByMonth: CountBucket[];
  findsByDay: CountBucket[];
  cumulativeFindsByMonth: CountBucket[];
  findsByCalendarMonth: PercentBucket[];
  findsByWeekday: PercentBucket[];
  findsByPlacedYear: PercentBucket[];
  findsToTodayByYear: PercentBucket[];
  averageDifficultyByYear: AverageByYear[];
  averageTerrainByYear: AverageByYear[];
  foundDateMatrix: CountBucket[];
  hiddenDateMatrix: CountBucket[];
  hiddenMonthMatrix: CountBucket[];
  elevationBuckets: CountBucket[];
  ownerBuckets: PercentBucket[];
  wayTo81: WayTo81Entry[];
  ftfStats: FtfStats;
  distanceStats: DistanceStats | null;
  hideStats: HideStats;
  summaryNumbers: SummaryNumbers;
  cacheTypes: CountBucket[];
  difficultyTerrain: DifficultyTerrainCell[];
  sizes: CountBucket[];
  countries: CountBucket[];
  regions: CountBucket[];
  counties: CountBucket[];
  milestones: Milestone[];
  milestoneStats: MilestoneStats;
  streaks: StreakStats;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthDayKey(date: Date): string {
  return date.toISOString().slice(5, 10);
}

function increment(map: Map<string, number>, key: string | null | undefined): void {
  const normalized = key?.trim() || "Unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function buckets(map: Map<string, number>): CountBucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function percentBuckets(map: Map<string, number>, total: number): PercentBucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count, percent: total > 0 ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function ftfRow(
  find: StatsFind,
  previousDate: Date | null,
  options: StatsOptions
): FtfRow {
  const foundAt = toDate(find.foundAt);
  const latitude = find.cache.latitude == null ? null : Number(find.cache.latitude);
  const longitude = find.cache.longitude == null ? null : Number(find.cache.longitude);
  const hasDistance =
    options.homeLatitude != null &&
    options.homeLongitude != null &&
    latitude != null &&
    longitude != null &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);
  return {
    date: dateKey(foundAt),
    dateTime: foundAt.toISOString(),
    intervalDays: previousDate === null ? null : Math.max(0, daysBetweenInclusive(previousDate, foundAt) - 1),
    distanceKm: hasDistance ? haversineKm(options.homeLatitude!, options.homeLongitude!, latitude, longitude) : null,
    gcCode: find.cache.gcCode,
    name: find.cache.name,
    cacheType: find.cache.cacheType,
    size: find.cache.size,
    difficulty: find.cache.difficulty,
    terrain: find.cache.terrain,
    country: find.cache.country,
    region: find.cache.region,
    county: find.cache.county,
    latitude,
    longitude,
    elevationMeters: find.cache.elevationMeters ?? null,
    archived: isArchived(find.cache)
  };
}

function monthIndex(key: string): number {
  const [year, month] = key.split("-").map(Number);
  return year * 12 + month - 1;
}

function longestConsecutiveMonths(months: CountBucket[]): { count: number; start: string; end: string } | null {
  if (months.length === 0) {
    return null;
  }
  const sortedMonths = [...months].sort((a, b) => a.key.localeCompare(b.key));
  let bestStart = sortedMonths[0].key;
  let bestEnd = sortedMonths[0].key;
  let bestCount = 1;
  let currentStart = sortedMonths[0].key;
  let currentEnd = sortedMonths[0].key;
  let currentCount = 1;

  for (let index = 1; index < sortedMonths.length; index += 1) {
    const previous = sortedMonths[index - 1].key;
    const current = sortedMonths[index].key;
    if (monthIndex(current) === monthIndex(previous) + 1) {
      currentEnd = current;
      currentCount += 1;
    } else {
      currentStart = current;
      currentEnd = current;
      currentCount = 1;
    }

    if (currentCount > bestCount) {
      bestStart = currentStart;
      bestEnd = currentEnd;
      bestCount = currentCount;
    }
  }

  return { count: bestCount, start: bestStart, end: bestEnd };
}

function firstFtfRows(
  finds: StatsFind[],
  labelForFind: (find: StatsFind) => string | null | undefined
): FtfFirstRow[] {
  const seen = new Set<string>();
  const rows: FtfFirstRow[] = [];
  for (const find of finds) {
    const label = labelForFind(find)?.trim();
    if (!label || seen.has(label)) {
      continue;
    }
    seen.add(label);
    const foundAt = toDate(find.foundAt);
    rows.push({
      index: rows.length + 1,
      date: dateKey(foundAt),
      dateTime: foundAt.toISOString(),
      label,
      gcCode: find.cache.gcCode,
      name: find.cache.name,
      cacheType: find.cache.cacheType
    });
  }
  return rows;
}

function fixedPercentBuckets(values: string[], map: Map<string, number>, total: number): PercentBucket[] {
  return values.map((key) => {
    const count = map.get(key) ?? 0;
    return { key, count, percent: total > 0 ? (count / total) * 100 : 0 };
  });
}

function calculateFtfStats(finds: StatsFind[], options: StatsOptions = {}): FtfStats {
  const ftfs = finds.filter((find) => find.isFtf);
  const byYear = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byDay = new Map<string, number>();
  const byCalendarMonth = new Map<string, number>();
  const byWeekday = new Map<string, number>();
  const byType = new Map<string, number>();
  const bySize = new Map<string, number>();
  const byDifficulty = new Map<string, number>();
  const byTerrain = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byFoundDate = new Map<string, number>();
  const dt = new Map<string, DifficultyTerrainCell>();
  const wayTo81: FtfWayTo81Entry[] = [];
  const seenDifficultyTerrain = new Set<string>();
  let previousWayTo81Date: Date | null = null;
  let totalDifficulty = 0;
  let difficultyCount = 0;
  let totalTerrain = 0;
  let terrainCount = 0;

  for (const find of ftfs) {
    const foundAt = toDate(find.foundAt);
    increment(byYear, String(foundAt.getUTCFullYear()));
    increment(byMonth, foundAt.toISOString().slice(0, 7));
    increment(byDay, dateKey(foundAt));
    increment(byFoundDate, monthDayKey(foundAt));
    increment(byCalendarMonth, String(foundAt.getUTCMonth()));
    increment(byWeekday, String(foundAt.getUTCDay()));
    increment(byType, find.cache.cacheType);
    increment(bySize, find.cache.size);
    increment(byCountry, find.cache.country);
    increment(byRegion, find.cache.region);

    if (find.cache.difficulty) {
      increment(byDifficulty, find.cache.difficulty.toFixed(1));
      totalDifficulty += find.cache.difficulty;
      difficultyCount += 1;
    }

    if (find.cache.terrain) {
      increment(byTerrain, find.cache.terrain.toFixed(1));
      totalTerrain += find.cache.terrain;
      terrainCount += 1;
    }

    if (find.cache.difficulty && find.cache.terrain) {
      const key = `${find.cache.difficulty}/${find.cache.terrain}`;
      const current = dt.get(key) ?? {
        difficulty: find.cache.difficulty,
        terrain: find.cache.terrain,
        count: 0
      };
      current.count += 1;
      dt.set(key, current);

      if (!seenDifficultyTerrain.has(key)) {
        const intervalDays =
          previousWayTo81Date === null ? null : Math.max(0, daysBetweenInclusive(previousWayTo81Date, foundAt) - 1);
        wayTo81.push({
          index: wayTo81.length + 1,
          date: dateKey(foundAt),
          dateTime: foundAt.toISOString(),
          intervalDays,
          gcCode: find.cache.gcCode,
          name: find.cache.name,
          cacheType: find.cache.cacheType,
          difficulty: find.cache.difficulty,
          terrain: find.cache.terrain
        });
        seenDifficultyTerrain.add(key);
        previousWayTo81Date = foundAt;
      }
    }
  }

  let previousDate: Date | null = null;
  const rows = ftfs.map((find) => {
    const row = ftfRow(find, previousDate, options);
    previousDate = toDate(find.foundAt);
    return row;
  });
  const rowsWithDistance = rows.filter((row) => row.distanceKm != null);
  const rowsWithCoordinates = rows.filter((row) => row.latitude != null && row.longitude != null);
  const rowsWithElevation = rows.filter((row) => row.elevationMeters != null);
  const intervals = rows.map((row) => row.intervalDays).filter((value): value is number => value != null);
  const averageIntervalDays = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : null;
  const averageDistanceKm = rowsWithDistance.length
    ? rowsWithDistance.reduce((sum, row) => sum + row.distanceKm!, 0) / rowsWithDistance.length
    : null;
  const latitudeAverage = rowsWithCoordinates.length
    ? rowsWithCoordinates.reduce((sum, row) => sum + row.latitude!, 0) / rowsWithCoordinates.length
    : null;
  const longitudeAverage = rowsWithCoordinates.length
    ? rowsWithCoordinates.reduce((sum, row) => sum + row.longitude!, 0) / rowsWithCoordinates.length
    : null;
  const centroid =
    latitudeAverage == null || longitudeAverage == null
      ? null
      : {
          latitude: latitudeAverage,
          longitude: longitudeAverage,
          distanceFromHomeKm:
            options.homeLatitude != null && options.homeLongitude != null
              ? haversineKm(options.homeLatitude, options.homeLongitude, latitudeAverage, longitudeAverage)
              : null
        };
  const sortedMonths = buckets(byMonth).sort((a, b) => a.key.localeCompare(b.key));
  const bestMonth = sortedMonths.reduce<CountBucket | null>(
    (best, bucket) => (!best || bucket.count > best.count ? bucket : best),
    null
  );
  const ratingValues = ["1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0"];
  const archivedCount = rows.filter((row) => row.archived).length;
  const mostNorthern = [...rowsWithCoordinates].sort((a, b) => b.latitude! - a.latitude!)[0] ?? null;
  const mostSouthern = [...rowsWithCoordinates].sort((a, b) => a.latitude! - b.latitude!)[0] ?? null;
  const mostEastern = [...rowsWithCoordinates].sort((a, b) => b.longitude! - a.longitude!)[0] ?? null;
  const mostWestern = [...rowsWithCoordinates].sort((a, b) => a.longitude! - b.longitude!)[0] ?? null;

  return {
    total: ftfs.length,
    percentOfFinds: finds.length > 0 ? (ftfs.length / finds.length) * 100 : 0,
    averageIntervalDays,
    averageDistanceKm,
    first: rows[0] ?? null,
    latest: rows.at(-1) ?? null,
    slowest: rows.reduce<FtfRow | null>((best, row) => (row.intervalDays != null && (!best || row.intervalDays > (best.intervalDays ?? -1)) ? row : best), null),
    nearest: [...rowsWithDistance].sort((a, b) => a.distanceKm! - b.distanceKm!)[0] ?? null,
    furthest: [...rowsWithDistance].sort((a, b) => b.distanceKm! - a.distanceKm!)[0] ?? null,
    mostNorthern,
    mostSouthern,
    mostEastern,
    mostWestern,
    highest: [...rowsWithElevation].sort((a, b) => b.elevationMeters! - a.elevationMeters!)[0] ?? null,
    lowest: [...rowsWithElevation].sort((a, b) => a.elevationMeters! - b.elevationMeters!)[0] ?? null,
    centroid,
    archivedCount,
    archivedPercent: ftfs.length > 0 ? (archivedCount / ftfs.length) * 100 : 0,
    bestDay: buckets(byDay)[0] ?? null,
    bestMonth,
    consecutiveMonths: longestConsecutiveMonths(sortedMonths),
    byYear: buckets(byYear).sort((a, b) => a.key.localeCompare(b.key)),
    byMonth: sortedMonths,
    byCalendarMonth: percentBuckets(byCalendarMonth, ftfs.length)
      .map((bucket) => ({ ...bucket, key: monthName(Number(bucket.key)) }))
      .sort((a, b) => monthLabels.indexOf(a.key) - monthLabels.indexOf(b.key)),
    byWeekday: percentBuckets(byWeekday, ftfs.length)
      .map((bucket) => ({ ...bucket, key: weekdayName(Number(bucket.key)) }))
      .sort((a, b) => weekdayLabels.indexOf(a.key) - weekdayLabels.indexOf(b.key)),
    byType: percentBuckets(byType, ftfs.length),
    bySize: percentBuckets(bySize, ftfs.length),
    byDifficulty: fixedPercentBuckets(ratingValues, byDifficulty, ftfs.length),
    byTerrain: fixedPercentBuckets(ratingValues, byTerrain, ftfs.length),
    byCountry: buckets(byCountry),
    byRegion: buckets(byRegion),
    byDifficultyTerrain: [...dt.values()].sort((a, b) => a.difficulty - b.difficulty || a.terrain - b.terrain),
    foundDateMatrix: buckets(byFoundDate).sort((a, b) => a.key.localeCompare(b.key)),
    firstByLocation: firstFtfRows(
      ftfs,
      (find) => [find.cache.country, find.cache.region, find.cache.county].filter(Boolean).join(" / ")
    ),
    firstByType: firstFtfRows(ftfs, (find) => find.cache.cacheType),
    wayTo81,
    averageDifficulty: difficultyCount > 0 ? totalDifficulty / difficultyCount : 0,
    averageTerrain: terrainCount > 0 ? totalTerrain / terrainCount : 0,
    rows
  };
}

function averageBuckets(map: Map<string, { total: number; count: number }>): AverageByYear[] {
  return [...map.entries()]
    .map(([year, value]) => ({
      year,
      amount: value.count,
      average: value.count > 0 ? value.total / value.count : 0
    }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

function daysBetweenInclusive(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.floor((endUtc - startUtc) / 86_400_000) + 1;
}

function haversineKm(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number {
  const radiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(toLatitude - fromLatitude);
  const dLon = toRad(toLongitude - fromLongitude);
  const lat1 = toRad(fromLatitude);
  const lat2 = toRad(toLatitude);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const toDeg = (value: number) => (value * 180) / Math.PI;
  const lat1 = toRad(fromLatitude);
  const lat2 = toRad(toLatitude);
  const dLon = toRad(toLongitude - fromLongitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function distanceBucket(distanceKm: number): string {
  if (distanceKm < 10) return "< 10";
  if (distanceKm < 20) return "10 - 20";
  if (distanceKm < 30) return "20 - 30";
  if (distanceKm < 40) return "30 - 40";
  if (distanceKm < 50) return "40 - 50";
  if (distanceKm < 100) return "50 - 100";
  if (distanceKm < 200) return "100 - 200";
  if (distanceKm < 500) return "200 - 500";
  if (distanceKm < 1000) return "500 - 1000";
  return "> 1000";
}

function bearingBucket(bearing: number): string {
  return String(Math.round(bearing) % 360);
}

function elevationBucket(elevationMeters: number): string {
  if (elevationMeters < 0) return "< 0";
  if (elevationMeters < 25) return "< 25";
  if (elevationMeters < 50) return "< 50";
  if (elevationMeters < 75) return "< 75";
  if (elevationMeters < 100) return "< 100";
  if (elevationMeters < 125) return "< 125";
  if (elevationMeters < 150) return "< 150";
  if (elevationMeters < 200) return "< 200";
  if (elevationMeters < 250) return "< 250";
  if (elevationMeters < 300) return "< 300";
  if (elevationMeters < 400) return "< 400";
  if (elevationMeters < 500) return "< 500";
  if (elevationMeters < 600) return "< 600";
  if (elevationMeters < 750) return "< 750";
  if (elevationMeters < 1000) return "< 1000";
  if (elevationMeters < 1250) return "< 1250";
  if (elevationMeters < 1500) return "< 1500";
  if (elevationMeters < 1750) return "< 1750";
  if (elevationMeters < 2000) return "< 2000";
  if (elevationMeters < 2500) return "< 2500";
  return ">= 2500";
}

function isArchived(cache: StatsCache): boolean {
  const raw = cache.raw;
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const extension = (raw as Record<string, any>)["groundspeak:cache"] ?? (raw as Record<string, any>).cache;
  const archived = extension?.archived;
  return archived === true || archived === "True" || archived === "true";
}

function firstRawText(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
    if (value && typeof value === "object" && "text" in value && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text.trim();
    }
  }
  return null;
}

function rawCacheExtension(cache: StatsCache): Record<string, any> {
  const raw = cache.raw;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return (raw as Record<string, any>)["groundspeak:cache"] ?? (raw as Record<string, any>).cache ?? {};
}

function asRawArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function hideLogs(hide: StatsHide): HideLog[] {
  const extension = rawCacheExtension(hide.cache);
  const logs = extension["groundspeak:logs"]?.["groundspeak:log"] ?? extension.logs?.log;
  return asRawArray<Record<string, any>>(logs)
    .map((log) => {
      const type = firstRawText(log["groundspeak:type"], log.type) ?? "Unknown";
      const date = firstRawText(log["groundspeak:date"], log.date);
      const finder = firstRawText(log["groundspeak:finder"], log.finder) ?? "Unknown";
      return {
        date: date ? dateKey(toDate(date)) : "",
        finder,
        type,
        text: firstRawText(log["groundspeak:text"], log.text),
        gcCode: hide.cache.gcCode,
        cacheName: hide.cache.name
      };
    })
    .filter((log) => log.date && log.type.toLowerCase() !== "publish listing");
}

function favoritePoints(cache: StatsCache): number {
  const extension = rawCacheExtension(cache);
  const value = firstRawText(
    extension["groundspeak:favorite_points"],
    extension["groundspeak:favorites"],
    extension.favorite_points,
    extension.favorites,
    extension.favpoints
  );
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function coordLabel(cache: StatsCache): string {
  const lat = cache.latitude == null ? null : Number(cache.latitude);
  const lon = cache.longitude == null ? null : Number(cache.longitude);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return "-";
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function cacheLinkLabel(cache: StatsCache): string {
  return `${cache.name} ${cache.gcCode}`;
}

function hideLogDateRows(logs: HideLog[]): {
  byYear: CountBucket[];
  byMonth: CountBucket[];
  cumulativeByMonth: CountBucket[];
  byCalendarMonth: PercentBucket[];
  byWeekday: PercentBucket[];
  foundDateMatrix: CountBucket[];
} {
  const byYear = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byCalendarMonth = new Map<string, number>();
  const byWeekday = new Map<string, number>();
  const byFoundDate = new Map<string, number>();
  for (const log of logs) {
    const foundAt = toDate(log.date);
    increment(byYear, String(foundAt.getUTCFullYear()));
    increment(byMonth, foundAt.toISOString().slice(0, 7));
    increment(byCalendarMonth, String(foundAt.getUTCMonth()));
    increment(byWeekday, String(foundAt.getUTCDay()));
    increment(byFoundDate, monthDayKey(foundAt));
  }
  const sortedMonths = buckets(byMonth).sort((a, b) => a.key.localeCompare(b.key));
  let cumulative = 0;
  return {
    byYear: buckets(byYear).sort((a, b) => a.key.localeCompare(b.key)),
    byMonth: sortedMonths,
    cumulativeByMonth: sortedMonths.map((bucket) => {
      cumulative += bucket.count;
      return { key: bucket.key, count: cumulative };
    }),
    byCalendarMonth: percentBuckets(byCalendarMonth, logs.length)
      .map((bucket) => ({ ...bucket, key: monthName(Number(bucket.key)) }))
      .sort((a, b) => monthLabels.indexOf(a.key) - monthLabels.indexOf(b.key)),
    byWeekday: percentBuckets(byWeekday, logs.length)
      .map((bucket) => ({ ...bucket, key: weekdayName(Number(bucket.key)) }))
      .sort((a, b) => weekdayLabels.indexOf(a.key) - weekdayLabels.indexOf(b.key)),
    foundDateMatrix: buckets(byFoundDate).sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function calculateHideStats(hides: StatsHide[]): HideStats {
  const byYear = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byType = new Map<string, number>();
  const bySize = new Map<string, number>();
  const byDifficulty = new Map<string, number>();
  const byTerrain = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byFinder = new Map<string, number>();
  const byPlacedDate = new Map<string, number>();
  const dt = new Map<string, DifficultyTerrainCell>();
  const allLogs: HideLog[] = [];
  let totalReceivedLogs = 0;
  let totalFavoritePoints = 0;
  let archivedHides = 0;

  for (const hide of hides) {
    const logs = hideLogs(hide);
    allLogs.push(...logs);
    const receivedLogCount = logs.length || hide.receivedLogCount;
    totalReceivedLogs += receivedLogCount;
    totalFavoritePoints += favoritePoints(hide.cache);
    for (const log of logs) {
      increment(byFinder, log.finder);
    }
    if (isArchived(hide.cache)) {
      archivedHides += 1;
    }
    increment(byType, hide.cache.cacheType);
    increment(bySize, hide.cache.size);
    increment(byCountry, hide.cache.country);
    increment(byRegion, hide.cache.region);
    if (hide.cache.difficulty) {
      increment(byDifficulty, hide.cache.difficulty.toFixed(1));
    }
    if (hide.cache.terrain) {
      increment(byTerrain, hide.cache.terrain.toFixed(1));
    }

    if (hide.placedAt) {
      const placedAt = toDate(hide.placedAt);
      increment(byYear, String(placedAt.getUTCFullYear()));
      increment(byMonth, placedAt.toISOString().slice(0, 7));
      increment(byPlacedDate, monthDayKey(placedAt));
    }

    if (hide.cache.difficulty && hide.cache.terrain) {
      const key = `${hide.cache.difficulty}/${hide.cache.terrain}`;
      const current = dt.get(key) ?? {
        difficulty: hide.cache.difficulty,
        terrain: hide.cache.terrain,
        count: 0
      };
      current.count += 1;
      dt.set(key, current);
    }
  }

  const totalHides = hides.length;
  const logDateRows = hideLogDateRows(allLogs);
  const topLogged = [...hides].sort((a, b) => {
    const aCount = hideLogs(a).length || a.receivedLogCount;
    const bCount = hideLogs(b).length || b.receivedLogCount;
    return bCount - aCount || a.cache.name.localeCompare(b.cache.name);
  });
  const mostNorthern = [...hides].filter((hide) => hide.cache.latitude != null).sort((a, b) => Number(b.cache.latitude) - Number(a.cache.latitude))[0];
  const mostSouthern = [...hides].filter((hide) => hide.cache.latitude != null).sort((a, b) => Number(a.cache.latitude) - Number(b.cache.latitude))[0];
  const mostEastern = [...hides].filter((hide) => hide.cache.longitude != null).sort((a, b) => Number(b.cache.longitude) - Number(a.cache.longitude))[0];
  const mostWestern = [...hides].filter((hide) => hide.cache.longitude != null).sort((a, b) => Number(a.cache.longitude) - Number(b.cache.longitude))[0];
  const highest = [...hides].filter((hide) => hide.cache.elevationMeters != null).sort((a, b) => Number(b.cache.elevationMeters) - Number(a.cache.elevationMeters))[0];
  const lowest = [...hides].filter((hide) => hide.cache.elevationMeters != null).sort((a, b) => Number(a.cache.elevationMeters) - Number(b.cache.elevationMeters))[0];
  const firstPlaced = hides.map((hide) => hide.placedAt).filter(Boolean).map((date) => toDate(date as string | Date)).sort((a, b) => a.getTime() - b.getTime())[0];
  const lastLog = allLogs.map((log) => toDate(log.date)).sort((a, b) => b.getTime() - a.getTime())[0];
  const totalDays = firstPlaced && lastLog ? daysBetweenInclusive(firstPlaced, lastLog) : 0;
  const byExactFoundDay = new Map<string, number>();
  for (const log of allLogs) {
    increment(byExactFoundDay, log.date);
  }
  const bestOverallDay = buckets(byExactFoundDay)[0] ?? null;
  const bestCacheDay = topLogged
    .flatMap((hide) => {
      const countByDay = new Map<string, number>();
      for (const log of hideLogs(hide)) {
        increment(countByDay, log.date);
      }
      const best = buckets(countByDay)[0];
      return best ? [{ hide, count: best.count, day: best.key }] : [];
    })
    .sort((a, b) => b.count - a.count || a.hide.cache.name.localeCompare(b.hide.cache.name))[0];
  const averageLogWords =
    allLogs.length > 0
      ? Math.round(
          allLogs.reduce((sum, log) => {
            const words = (log.text ?? "").split(/\s+/).filter(Boolean).length;
            return sum + words;
          }, 0) / allLogs.length
        )
      : 0;
  const topFavorite = [...hides].sort((a, b) => favoritePoints(b.cache) - favoritePoints(a.cache) || a.cache.name.localeCompare(b.cache.name))[0];

  return {
    totalHides,
    activeHides: totalHides - archivedHides,
    archivedHides,
    totalReceivedLogs,
    totalUniqueFinders: byFinder.size,
    totalFavoritePoints,
    averageLogsPerHide: totalHides > 0 ? totalReceivedLogs / totalHides : 0,
    receivedLogsByYear: logDateRows.byYear,
    receivedLogsByMonth: logDateRows.byMonth,
    cumulativeReceivedLogsByMonth: logDateRows.cumulativeByMonth,
    receivedLogsByCalendarMonth: logDateRows.byCalendarMonth,
    receivedLogsByWeekday: logDateRows.byWeekday,
    receivedFoundDateMatrix: logDateRows.foundDateMatrix,
    placedHiddenDateMatrix: buckets(byPlacedDate).sort((a, b) => a.key.localeCompare(b.key)),
    hidesByYear: buckets(byYear).sort((a, b) => a.key.localeCompare(b.key)),
    hidesByMonth: buckets(byMonth).sort((a, b) => a.key.localeCompare(b.key)),
    hidesByType: percentBuckets(byType, totalHides),
    hidesBySize: percentBuckets(bySize, totalHides),
    hidesByDifficulty: percentBuckets(byDifficulty, totalHides).sort((a, b) => Number(a.key) - Number(b.key)),
    hidesByTerrain: percentBuckets(byTerrain, totalHides).sort((a, b) => Number(a.key) - Number(b.key)),
    hidesByCountry: buckets(byCountry),
    hidesByRegion: buckets(byRegion),
    hidesByDifficultyTerrain: [...dt.values()].sort((a, b) => a.difficulty - b.difficulty || a.terrain - b.terrain),
    finderBuckets: percentBuckets(byFinder, totalReceivedLogs),
    hideSummaryRows: [
      { label: "Owned", value: `${totalHides}, ${archivedHides} archived` },
      {
        label: "Total finds of my caches",
        value: `${totalReceivedLogs} finds${totalDays > 0 ? ` in ${totalDays} total days` : ""}`
      },
      { label: "Total unique finders of my caches", value: String(byFinder.size) },
      {
        label: "Most Northerly cache hidden",
        value: mostNorthern ? `${coordLabel(mostNorthern.cache)} ${cacheLinkLabel(mostNorthern.cache)}` : "-"
      },
      {
        label: "Most Southerly cache hidden",
        value: mostSouthern ? `${coordLabel(mostSouthern.cache)} ${cacheLinkLabel(mostSouthern.cache)}` : "-"
      },
      {
        label: "Most Easterly cache hidden",
        value: mostEastern ? `${coordLabel(mostEastern.cache)} ${cacheLinkLabel(mostEastern.cache)}` : "-"
      },
      {
        label: "Most Westerly cache hidden",
        value: mostWestern ? `${coordLabel(mostWestern.cache)} ${cacheLinkLabel(mostWestern.cache)}` : "-"
      },
      {
        label: "Highest elevated cache hidden",
        value: highest ? `${Math.round(Number(highest.cache.elevationMeters))} m, ${cacheLinkLabel(highest.cache)}` : "-"
      },
      {
        label: "Lowest elevated cache hidden",
        value: lowest ? `${Math.round(Number(lowest.cache.elevationMeters))} m, ${cacheLinkLabel(lowest.cache)}` : "-"
      },
      {
        label: "Hide with the most finds",
        value: topLogged[0] ? `${hideLogs(topLogged[0]).length || topLogged[0].receivedLogCount}, ${cacheLinkLabel(topLogged[0].cache)}` : "-"
      },
      {
        label: "Hide with the most finds in a day",
        value: bestCacheDay ? `${bestCacheDay.count}, ${cacheLinkLabel(bestCacheDay.hide.cache)} on ${bestCacheDay.day}` : "-"
      },
      {
        label: "Hide with the most favorite points",
        value: topFavorite ? `${favoritePoints(topFavorite.cache)}, ${cacheLinkLabel(topFavorite.cache)}` : "0"
      },
      {
        label: "Caching karma (#hides/#finds)",
        value: "Calculated when profile find total is available"
      },
      {
        label: "Day with the most found logs received",
        value: bestOverallDay ? `${bestOverallDay.key}, ${bestOverallDay.count} find${bestOverallDay.count === 1 ? "" : "s"}` : "-"
      },
      { label: "Total favorite points received", value: String(totalFavoritePoints) },
      { label: "Log length, words", value: `Average: ${averageLogWords} words` },
      {
        label: "Life-time on hides",
        value: firstPlaced ? `Average: ${Math.round(daysBetweenInclusive(firstPlaced, new Date()) / Math.max(1, totalHides))} days` : "-"
      }
    ],
    logsReceived: topLogged.map((hide) => {
      const logs = hideLogs(hide);
      const placedAt = hide.placedAt ? dateKey(toDate(hide.placedAt)) : null;
      const lastFound = logs.map((log) => log.date).sort().at(-1) ?? null;
      const daysPerFind =
        placedAt && logs.length > 0 ? daysBetweenInclusive(toDate(placedAt), toDate(lastFound!)) / logs.length : null;
      return {
        hidden: placedAt,
        lastFound,
        finds: logs.length || hide.receivedLogCount,
        daysPerFind,
        favoritePoints: favoritePoints(hide.cache),
        gcCode: hide.cache.gcCode,
        name: hide.cache.name,
        cacheType: hide.cache.cacheType
      };
    }),
    topLoggedHides: topLogged
      .slice(0, 20)
      .map((hide) => ({
        gcCode: hide.cache.gcCode,
        name: hide.cache.name,
        count: hideLogs(hide).length || hide.receivedLogCount,
        cacheType: hide.cache.cacheType,
        placedAt: hide.placedAt ? dateKey(toDate(hide.placedAt)) : null
      }))
  };
}

function calculateDistanceStats(finds: StatsFind[], options: StatsOptions): DistanceStats | null {
  if (options.homeLatitude == null || options.homeLongitude == null) {
    return null;
  }

  const distanceMap = new Map<string, number>();
  const bearingMap = new Map<string, number>();
  let totalDistance = 0;
  let distanceCount = 0;

  for (const find of finds) {
    const latitude = find.cache.latitude;
    const longitude = find.cache.longitude;
    if (latitude == null || longitude == null) {
      continue;
    }

    const distance = haversineKm(options.homeLatitude, options.homeLongitude, latitude, longitude);
    const bearing = bearingDegrees(options.homeLatitude, options.homeLongitude, latitude, longitude);
    const distanceKey = distanceBucket(distance);
    const bearingKey = bearingBucket(bearing);
    increment(distanceMap, distanceKey);
    increment(bearingMap, bearingKey);
    totalDistance += distance;
    distanceCount += 1;
  }

  return {
    distanceBuckets: percentBuckets(distanceMap, distanceCount).sort((a, b) => {
      const order = ["< 10", "10 - 20", "20 - 30", "30 - 40", "40 - 50", "50 - 100", "100 - 200", "200 - 500", "500 - 1000", "> 1000"];
      return order.indexOf(a.key) - order.indexOf(b.key);
    }),
    bearingBuckets: Array.from({ length: 360 }, (_, degree) => {
      const key = String(degree);
      const count = bearingMap.get(key) ?? 0;
      return {
        key,
        count,
        percent: distanceCount > 0 ? (count / distanceCount) * 100 : 0
      };
    }),
    averageDistanceKm: distanceCount > 0 ? totalDistance / distanceCount : null
  };
}

export function calculateStats(finds: StatsFind[], options: StatsOptions = {}): StatsSnapshot {
  const sorted = [...finds].sort((a, b) => toDate(a.foundAt).getTime() - toDate(b.foundAt).getTime());
  const byYear = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byDay = new Map<string, number>();
  const byCalendarMonth = new Map<string, number>();
  const byWeekday = new Map<string, number>();
  const byPlacedYear = new Map<string, number>();
  const byFoundDate = new Map<string, number>();
  const byHiddenDate = new Map<string, number>();
  const byHiddenMonth = new Map<string, number>();
  const byElevation = new Map<string, number>();
  const byOwner = new Map<string, number>();
  const toTodayByYear = new Map<string, number>();
  const difficultyByYear = new Map<string, { total: number; count: number }>();
  const terrainByYear = new Map<string, { total: number; count: number }>();
  const byType = new Map<string, number>();
  const bySize = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byRegion = new Map<string, number>();
  const byCounty = new Map<string, number>();
  const dt = new Map<string, DifficultyTerrainCell>();
  const wayTo81: WayTo81Entry[] = [];
  const seenDifficultyTerrain = new Set<string>();
  let previousWayTo81Date: Date | null = null;

  for (const find of sorted) {
    const foundAt = toDate(find.foundAt);
    const year = String(foundAt.getUTCFullYear());
    const day = dateKey(foundAt);
    increment(byYear, year);
    increment(byMonth, foundAt.toISOString().slice(0, 7));
    increment(byDay, dateKey(foundAt));
    increment(byFoundDate, monthDayKey(foundAt));
    increment(byCalendarMonth, String(foundAt.getUTCMonth()));
    increment(byWeekday, String(foundAt.getUTCDay()));
    increment(byType, find.cache.cacheType);
    increment(bySize, find.cache.size);
    increment(byCountry, find.cache.country);
    increment(byRegion, find.cache.region);
    increment(byCounty, find.cache.county);
    increment(byOwner, find.cache.ownerName);

    if (find.cache.elevationMeters != null && Number.isFinite(find.cache.elevationMeters)) {
      increment(byElevation, elevationBucket(find.cache.elevationMeters));
    }

    if (find.cache.difficulty && find.cache.terrain) {
      const currentDifficulty = difficultyByYear.get(year) ?? { total: 0, count: 0 };
      currentDifficulty.total += find.cache.difficulty;
      currentDifficulty.count += 1;
      difficultyByYear.set(year, currentDifficulty);

      const currentTerrain = terrainByYear.get(year) ?? { total: 0, count: 0 };
      currentTerrain.total += find.cache.terrain;
      currentTerrain.count += 1;
      terrainByYear.set(year, currentTerrain);

      const key = `${find.cache.difficulty}/${find.cache.terrain}`;
      const current = dt.get(key) ?? {
        difficulty: find.cache.difficulty,
        terrain: find.cache.terrain,
        count: 0
      };
      current.count += 1;
      dt.set(key, current);

      if (!seenDifficultyTerrain.has(key)) {
        const intervalDays =
          previousWayTo81Date === null ? null : Math.max(0, daysBetweenInclusive(previousWayTo81Date, foundAt) - 1);
        wayTo81.push({
          index: wayTo81.length + 1,
          date: dateKey(foundAt),
          intervalDays,
          gcCode: find.cache.gcCode,
          name: find.cache.name,
          cacheType: find.cache.cacheType,
          difficulty: find.cache.difficulty,
          terrain: find.cache.terrain
        });
        seenDifficultyTerrain.add(key);
        previousWayTo81Date = foundAt;
      }
    }

    if (find.cache.hiddenDate) {
      const hiddenAt = toDate(find.cache.hiddenDate);
      increment(byPlacedYear, String(hiddenAt.getUTCFullYear()));
      increment(byHiddenDate, monthDayKey(hiddenAt));
      increment(byHiddenMonth, hiddenAt.toISOString().slice(0, 7));
    }

    const today = new Date();
    if (foundAt.getUTCMonth() < today.getUTCMonth() || (foundAt.getUTCMonth() === today.getUTCMonth() && foundAt.getUTCDate() <= today.getUTCDate())) {
      increment(toTodayByYear, year);
    }
  }

  const sortedMonths = buckets(byMonth).sort((a, b) => a.key.localeCompare(b.key));
  let cumulative = 0;
  const cumulativeFindsByMonth = sortedMonths.map((bucket) => {
    cumulative += bucket.count;
    return { key: bucket.key, count: cumulative };
  });
  const firstFind = sorted[0] ? toDate(sorted[0].foundAt) : null;
  const lastFind = sorted.at(-1) ? toDate(sorted.at(-1)!.foundAt) : null;
  const totalDays = firstFind && lastFind ? daysBetweenInclusive(firstFind, lastFind) : 0;
  const cachingDays = byDay.size;
  const latestDate = lastFind ?? new Date();
  const cutoff365 = new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate() - 364));
  const last365Finds = sorted.filter((find) => toDate(find.foundAt) >= cutoff365);
  const last365Days = new Set(last365Finds.map((find) => dateKey(toDate(find.foundAt)))).size;
  const bestDay = buckets(byDay)[0] ?? null;
  const bestMonth = sortedMonths.reduce<CountBucket | null>(
    (best, bucket) => (!best || bucket.count > best.count ? bucket : best),
    null
  );
  const totalFinds = sorted.length;

  const milestoneStats = calculateMilestoneStats(sorted);

  return {
    statsVersion: 15,
    totalFinds,
    findsByYear: buckets(byYear).sort((a, b) => a.key.localeCompare(b.key)),
    findsByMonth: sortedMonths,
    findsByDay: buckets(byDay).sort((a, b) => a.key.localeCompare(b.key)),
    cumulativeFindsByMonth,
    findsByCalendarMonth: percentBuckets(byCalendarMonth, totalFinds)
      .map((bucket) => ({ ...bucket, key: monthName(Number(bucket.key)) }))
      .sort((a, b) => monthLabels.indexOf(a.key) - monthLabels.indexOf(b.key)),
    findsByWeekday: percentBuckets(byWeekday, totalFinds)
      .map((bucket) => ({ ...bucket, key: weekdayName(Number(bucket.key)) }))
      .sort((a, b) => weekdayLabels.indexOf(a.key) - weekdayLabels.indexOf(b.key)),
    findsByPlacedYear: percentBuckets(byPlacedYear, totalFinds).sort((a, b) => a.key.localeCompare(b.key)),
    findsToTodayByYear: percentBuckets(toTodayByYear, [...toTodayByYear.values()].reduce((sum, count) => sum + count, 0)).sort((a, b) => a.key.localeCompare(b.key)),
    averageDifficultyByYear: averageBuckets(difficultyByYear),
    averageTerrainByYear: averageBuckets(terrainByYear),
    foundDateMatrix: buckets(byFoundDate).sort((a, b) => a.key.localeCompare(b.key)),
    hiddenDateMatrix: buckets(byHiddenDate).sort((a, b) => a.key.localeCompare(b.key)),
    hiddenMonthMatrix: buckets(byHiddenMonth).sort((a, b) => a.key.localeCompare(b.key)),
    elevationBuckets: buckets(byElevation).sort((a, b) => {
      const order = ["< 0", "< 25", "< 50", "< 75", "< 100", "< 125", "< 150", "< 200", "< 250", "< 300", "< 400", "< 500", "< 600", "< 750", "< 1000", "< 1250", "< 1500", "< 1750", "< 2000", "< 2500", ">= 2500"];
      return order.indexOf(a.key) - order.indexOf(b.key);
    }),
    ownerBuckets: percentBuckets(byOwner, totalFinds),
    wayTo81,
    ftfStats: calculateFtfStats(sorted, options),
    distanceStats: calculateDistanceStats(sorted, options),
    hideStats: calculateHideStats([]),
    summaryNumbers: {
      totalFinds,
      cachingDays,
      totalDays,
      findsPerCachingDay: cachingDays > 0 ? totalFinds / cachingDays : 0,
      findsPerDay: totalDays > 0 ? totalFinds / totalDays : 0,
      findsPerWeek: totalDays > 0 ? (totalFinds / totalDays) * 7 : 0,
      findsPerMonth: totalDays > 0 ? (totalFinds / totalDays) * (365.2425 / 12) : 0,
      last365Finds: last365Finds.length,
      last365CachingDays: last365Days,
      last365FindsPerCachingDay: last365Days > 0 ? last365Finds.length / last365Days : 0,
      last365FindsPerDay: last365Finds.length / 365,
      last365FindsPerWeek: (last365Finds.length / 365) * 7,
      last365FindsPerMonth: (last365Finds.length / 365) * (365.2425 / 12),
      bestDay,
      bestMonth
    },
    cacheTypes: buckets(byType),
    difficultyTerrain: [...dt.values()].sort((a, b) => a.difficulty - b.difficulty || a.terrain - b.terrain),
    sizes: buckets(bySize),
    countries: buckets(byCountry),
    regions: buckets(byRegion),
    counties: buckets(byCounty),
    milestones: milestoneStats.countMilestones,
    milestoneStats,
    streaks: calculateStreaks(sorted.map((find) => toDate(find.foundAt)))
  };
}

export function calculateMilestones(finds: StatsFind[]): Milestone[] {
  return calculateMilestoneStats(finds).countMilestones;
}

function officialCacheMilestones(): Set<number> {
  return new Set([
    1,
    5,
    10,
    25,
    50,
    75,
    100,
    ...Array.from({ length: 9 }, (_, index) => (index + 2) * 100),
    1000,
    ...Array.from({ length: 9 }, (_, index) => (index + 2) * 1000),
    10000,
    ...Array.from({ length: 9 }, (_, index) => (index + 2) * 10000)
  ]);
}

function milestoneEntry(find: StatsFind, count: number, previousDate: Date | null): Milestone {
  const foundAt = toDate(find.foundAt);
  return {
    count,
    date: dateKey(foundAt),
    intervalDays: previousDate === null ? null : Math.max(0, daysBetweenInclusive(previousDate, foundAt) - 1),
    gcCode: find.cache.gcCode,
    name: find.cache.name,
    cacheType: find.cache.cacheType
  };
}

function firstMilestoneEntry(find: StatsFind, count: number, label: string): FirstMilestone {
  return {
    count,
    date: dateKey(toDate(find.foundAt)),
    label,
    gcCode: find.cache.gcCode,
    name: find.cache.name,
    cacheType: find.cache.cacheType
  };
}

function calculateFirstMilestones(
  finds: StatsFind[],
  labelForFind: (find: StatsFind) => string | null | undefined
): FirstMilestone[] {
  const seen = new Set<string>();
  const entries: FirstMilestone[] = [];

  finds.forEach((find, index) => {
    const label = labelForFind(find)?.trim();
    if (!label || seen.has(label)) {
      return;
    }
    seen.add(label);
    entries.push(firstMilestoneEntry(find, index + 1, label));
  });

  return entries;
}

export function calculateMilestoneStats(finds: StatsFind[]): MilestoneStats {
  const milestones = officialCacheMilestones();
  const countMilestones: Milestone[] = [];
  let previousMilestoneDate: Date | null = null;

  finds.forEach((find, index) => {
    const count = index + 1;
    if (!milestones.has(count)) {
      return;
    }

    countMilestones.push(milestoneEntry(find, count, previousMilestoneDate));
    previousMilestoneDate = toDate(find.foundAt);
  });

  const homeCountry = finds.find((find) => find.cache.country?.trim())?.cache.country?.trim() ?? null;

  return {
    countMilestones,
    firstByCountry: calculateFirstMilestones(finds, (find) => find.cache.country),
    firstByHomeCountryRegion: calculateFirstMilestones(finds, (find) =>
      homeCountry && find.cache.country?.trim() === homeCountry ? find.cache.region : null
    ),
    firstByType: calculateFirstMilestones(finds, (find) => find.cache.cacheType),
    firstBySize: calculateFirstMilestones(finds, (find) => find.cache.size),
    firstByDifficultyTerrain: calculateFirstMilestones(finds, (find) =>
      find.cache.difficulty && find.cache.terrain ? `${find.cache.difficulty}/${find.cache.terrain}` : null
    ),
    homeCountry
  };
}

export function calculateStreaks(dates: Date[]): StreakStats {
  const uniqueDays = [...new Set(dates.map(dateKey))].sort();
  if (uniqueDays.length === 0) {
    return { longest: 0, current: 0 };
  }

  let longest = 1;
  let active = 1;

  for (let i = 1; i < uniqueDays.length; i += 1) {
    const previous = new Date(`${uniqueDays[i - 1]}T00:00:00.000Z`);
    const current = new Date(`${uniqueDays[i]}T00:00:00.000Z`);
    const diffDays = Math.round((current.getTime() - previous.getTime()) / 86_400_000);
    active = diffDays === 1 ? active + 1 : 1;
    longest = Math.max(longest, active);
  }

  const today = dateKey(new Date());
  const yesterday = dateKey(new Date(Date.now() - 86_400_000));
  let current = 0;
  if (uniqueDays.at(-1) === today || uniqueDays.at(-1) === yesterday) {
    current = 1;
    for (let i = uniqueDays.length - 1; i > 0; i -= 1) {
      const previous = new Date(`${uniqueDays[i - 1]}T00:00:00.000Z`);
      const next = new Date(`${uniqueDays[i]}T00:00:00.000Z`);
      if (Math.round((next.getTime() - previous.getTime()) / 86_400_000) !== 1) {
        break;
      }
      current += 1;
    }
  }

  return { longest, current };
}
