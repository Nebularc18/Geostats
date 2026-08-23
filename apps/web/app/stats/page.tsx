"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppShell } from "../../components/app-shell";
import { CountBarChart, CumulativeFindsChart } from "../../components/charts";
import { DifficultyTerrainGrid } from "../../components/difficulty-terrain-grid";
import { ExtremeBadge, type ExtremeBadgeKind } from "../../components/extreme-badge";
import { StatCard } from "../../components/stat-card";
import { apiFetch } from "../../lib/api";

type CountBucket = { key: string; count: number };
type PercentBucket = CountBucket & { percent: number };
type AverageBucket = { year: string; amount: number; average: number };
type SummaryNumbers = {
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
};
type DistanceStats = {
  distanceBuckets: PercentBucket[];
  bearingBuckets: PercentBucket[];
  averageDistanceKm: number | null;
};
type WayTo81Entry = {
  index: number;
  date: string;
  intervalDays: number | null;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number;
  terrain: number;
};

export type ReferenceExtremeEntry = {
  gcCode: string;
  name: string;
  elevationMeters: number | null;
  found: boolean;
};

export type ReferenceExtremes = {
  country: string;
  region: string | null;
  extremes: {
    northernmost: ReferenceExtremeEntry;
    southernmost: ReferenceExtremeEntry;
    easternmost: ReferenceExtremeEntry;
    westernmost: ReferenceExtremeEntry;
    highest: ReferenceExtremeEntry;
    lowest: ReferenceExtremeEntry;
  };
};

export type ExtremeCachesData = {
  countries: string[];
  selectedCountry: string | null;
  selectedRegion: string | null;
  referenceRegions: string[];
  reference: ReferenceExtremes | null;
};

const referenceCards: {
  key: keyof ReferenceExtremes["extremes"];
  label: string;
  badge: ExtremeBadgeKind;
}[] = [
  { key: "northernmost", label: "Northernmost cache", badge: "northernmost" },
  { key: "easternmost", label: "Easternmost cache", badge: "easternmost" },
  { key: "southernmost", label: "Southernmost cache", badge: "southernmost" },
  { key: "westernmost", label: "Westernmost cache", badge: "westernmost" },
  { key: "highest", label: "Highest altitude cache", badge: "highest" },
  { key: "lowest", label: "Lowest altitude cache", badge: "lowest" }
];

function referenceDetail(entry: ReferenceExtremeEntry) {
  return [entry.gcCode, entry.elevationMeters != null ? `${entry.elevationMeters} m` : ""].filter(Boolean).join(" · ");
}

function ExtremeCachesPanel() {
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [data, setData] = useState<ExtremeCachesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (country) {
      params.set("country", country);
    }
    if (region) {
      params.set("region", region);
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    apiFetch<ExtremeCachesData>(`/stats/extreme-caches${query}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setError(cause.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [country, region]);

  const countries = data?.countries ?? [];
  const referenceRegions = data?.selectedCountry ? (data.referenceRegions ?? []) : [];
  if (data && countries.length === 0) {
    return null;
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Extreme caches</h2>
        <label>
          <span className="sr-only">Country</span>
          <select
            value={country}
            onChange={(event) => {
              setCountry(event.target.value);
              setRegion("");
            }}
          >
            <option value="">Worldwide</option>
            {countries.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {referenceRegions.length > 0 ? (
          <label>
            <span className="sr-only">Region</span>
            <select value={region} onChange={(event) => setRegion(event.target.value)}>
              <option value="">Whole country</option>
              {referenceRegions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="muted">Failed to load extreme caches: {error}</p> : null}
      {!error && !data ? <p className="muted">Loading…</p> : null}
      {data?.reference ? (
        <section className="extreme-set">
          <div className="extreme-set-heading">
            <div>
              <p className="eyebrow">Project-GC reference</p>
              <h3>{data.reference.region ? `${data.reference.region} extremes` : "Country extremes"}</h3>
            </div>
            <span>{data.reference.region ? `${data.reference.country} · ${data.reference.region}` : data.reference.country}</span>
          </div>
          <div className="extremes-grid">
            {referenceCards.map(({ key, label, badge }) => {
              const entry = data.reference!.extremes[key];
              return (
                <article className="extreme-card" key={key}>
                  <ExtremeBadge kind={badge} found={entry.found} />
                  <span className="extreme-card-copy">
                    <h3>{label}</h3>
                    <a
                      className="extreme-link"
                      href={`https://coord.info/${entry.gcCode}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {entry.name}
                    </a>
                    <span className="extreme-detail">{referenceDetail(entry)}</span>
                    <span className="sr-only">{entry.found ? "Found" : "Not found"}</span>
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function formatMonthLabel(key: string) {
  const [, month] = key.split("-");
  return monthLabels[Number(month) - 1] ?? key;
}

function latestTwelveMonths(findsByMonth: CountBucket[]) {
  const countByMonth = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
  const lastKey = findsByMonth.at(-1)?.key ?? monthKey(new Date());
  const [year, month] = lastKey.split("-").map(Number);
  const lastMonth = new Date(Date.UTC(year, month - 1, 1));

  return Array.from({ length: 12 }, (_, index) => {
    const date = addUtcMonths(lastMonth, index - 11);
    const key = monthKey(date);
    return {
      key,
      label: `${formatMonthLabel(key)} ${String(date.getUTCFullYear()).slice(2)}`,
      count: countByMonth.get(key) ?? 0
    };
  });
}

function averagePerDay(months: CountBucket[], firstFindKey?: string) {
  if (months.length === 0) {
    return 0;
  }

  const [startYear, startMonth] = months[0].key.split("-").map(Number);
  const [endYear, endMonth] = months.at(-1)!.key.split("-").map(Number);
  const rollingStart = Date.UTC(startYear, startMonth - 1, 1);
  const firstFindStart = firstFindKey ? Date.parse(`${firstFindKey}T00:00:00.000Z`) : rollingStart;
  const start = Math.max(rollingStart, firstFindStart);
  const end = Date.UTC(endYear, endMonth, 1);
  const days = Math.max(1, Math.round((end - start) / 86_400_000));
  return months.reduce((sum, bucket) => sum + bucket.count, 0) / days;
}

function yearOptions(findsByMonth: CountBucket[]) {
  return [...new Set(findsByMonth.map((bucket) => bucket.key.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
}

function daysInYear(year: number) {
  return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
}

function utcDayOfYear(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const start = Date.UTC(year, 0, 1);
  const date = Date.UTC(year, month - 1, day);
  return Math.floor((date - start) / 86_400_000) + 1;
}

function elapsedDaysForYear(year: number, firstFindKey?: string) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const firstFindYear = firstFindKey ? Number(firstFindKey.slice(0, 4)) : null;
  const firstFindDay = firstFindKey && firstFindYear === year ? utcDayOfYear(firstFindKey) : 1;

  if (year < currentYear) {
    return daysInYear(year) - firstFindDay + 1;
  }
  if (year > currentYear) {
    return 0;
  }

  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, today.getMonth(), today.getDate());
  return Math.floor((end - start) / 86_400_000) - firstFindDay + 2;
}

function MonthlyStatsCard({ stats }: { stats: any }) {
  const findsByMonth = stats?.findsByMonth ?? [];
  const findsByDay = stats?.findsByDay ?? [];
  const [tab, setTab] = useState<"monthly" | "cumulative" | "numbers">("monthly");
  const rollingMonths = useMemo(() => latestTwelveMonths(findsByMonth), [findsByMonth]);
  const total = rollingMonths.reduce((sum, bucket) => sum + bucket.count, 0);
  const perDay = averagePerDay(rollingMonths, findsByDay[0]?.key);

  return (
    <div className="panel monthly-stats-panel">
      <div className="panel-heading">
        <h2>Finds by month</h2>
        <div className="panel-metrics" aria-label="Latest 12 month summary">
          <span>
            <small>Total</small>
            <strong>{total}</strong>
          </span>
          <span>
            <small>Avg/day</small>
            <strong>{perDay.toFixed(2)}</strong>
          </span>
        </div>
      </div>
      <div className="tab-list" role="tablist" aria-label="Find statistics views">
        <button className={tab === "monthly" ? "active" : ""} type="button" onClick={() => setTab("monthly")}>
          Monthly
        </button>
        <button className={tab === "cumulative" ? "active" : ""} type="button" onClick={() => setTab("cumulative")}>
          Cumulative
        </button>
        <button className={tab === "numbers" ? "active" : ""} type="button" onClick={() => setTab("numbers")}>
          Numbers
        </button>
      </div>
      {tab === "monthly" ? (
        <>
          <CountBarChart data={rollingMonths.map(({ label, count }) => ({ key: label, count }))} />
          <small className="muted">Rolling latest 12 months</small>
          <MonthPerYearTable findsByMonth={findsByMonth} findsByDay={findsByDay} />
        </>
      ) : null}
      {tab === "cumulative" ? (
        <>
          <CumulativeFindsChart data={stats?.cumulativeFindsByMonth ?? []} />
          <small className="muted">Cumulative total finds by month</small>
        </>
      ) : null}
      {tab === "numbers" ? <SummaryNumbersTable numbers={stats?.summaryNumbers} /> : null}
    </div>
  );
}

function SummaryNumbersTable({ numbers }: { numbers?: SummaryNumbers }) {
  const rows = [
    ["Overall total finds", numbers ? `${numbers.totalFinds} finds in ${numbers.cachingDays} caching days over ${numbers.totalDays} total days` : "-"],
    [
      "Overall averages",
      numbers
        ? `${numbers.findsPerCachingDay.toFixed(2)} finds per caching day, ${numbers.findsPerDay.toFixed(2)}/day, ${numbers.findsPerWeek.toFixed(2)}/week, ${numbers.findsPerMonth.toFixed(2)}/month`
        : "-"
    ],
    ["Last 365 days", numbers ? `${numbers.last365Finds} finds in ${numbers.last365CachingDays} caching days` : "-"],
    [
      "Last 365 days averages",
      numbers
        ? `${numbers.last365FindsPerCachingDay.toFixed(2)} finds per caching day, ${numbers.last365FindsPerDay.toFixed(2)}/day, ${numbers.last365FindsPerWeek.toFixed(2)}/week, ${numbers.last365FindsPerMonth.toFixed(2)}/month`
        : "-"
    ],
    ["Most finds in a day", numbers?.bestDay ? `${numbers.bestDay.count} on ${numbers.bestDay.key}` : "-"],
    ["Most finds in a calendar month", numbers?.bestMonth ? `${numbers.bestMonth.count} in ${numbers.bestMonth.key}` : "-"]
  ];

  return (
    <div className="stat-table">
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function PercentTable({ title, data }: { title: string; data: PercentBucket[] }) {
  const max = Math.max(1, ...data.map((row) => row.count));
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <div className="mini-table-grid">
        <span>Name</span>
        <span>Amount</span>
        <span>Percent</span>
        <span />
        {data.map((row) => (
          <FragmentRow key={row.key} row={row} max={max} />
        ))}
      </div>
    </section>
  );
}

function DistanceBucketTable({
  title,
  data,
  averageDistanceKm
}: {
  title: string;
  data: PercentBucket[];
  averageDistanceKm: number | null;
}) {
  const max = Math.max(1, ...data.map((row) => row.count));
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <div className="mini-table-grid">
        <span>Name</span>
        <span>Amount</span>
        <span>Percent</span>
        <span />
        {data.map((row) => (
          <FragmentRow key={row.key} row={row} max={max} />
        ))}
      </div>
      <div className="mini-table-footer">
        <span>Average distance</span>
        <strong>{averageDistanceKm == null ? "-" : `${Math.round(averageDistanceKm)} km`}</strong>
      </div>
    </section>
  );
}

function BearingPolarChart({ data }: { data: PercentBucket[] }) {
  const sectors = bearingSectorBuckets(data);
  const max = Math.max(1, ...sectors.map((row) => row.count));
  const center = 130;
  const maxRadius = 98;
  const rings = [20, 40, 60, 80, 100];

  function point(degrees: number, radius: number) {
    const angle = ((degrees - 90) * Math.PI) / 180;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius
    };
  }

  return (
    <section className="mini-table">
      <h3>Finds by bearing</h3>
      <svg className="bearing-chart" viewBox="0 0 260 260" role="img" aria-label="Finds by bearing">
        {rings.map((percent) => (
          <circle key={percent} cx={center} cy={center} r={(percent / 100) * maxRadius} />
        ))}
        {Array.from({ length: 12 }, (_, index) => index * 30).map((degrees) => {
          const end = point(degrees, maxRadius);
          const label = point(degrees, maxRadius + 18);
          return (
            <g key={degrees}>
              <line x1={center} y1={center} x2={end.x} y2={end.y} />
              <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle">
                {degrees} deg
              </text>
            </g>
          );
        })}
        {sectors.map((bucket) => {
          if (bucket.count === 0) return null;
          const [start] = bucket.key.split(" - ").map(Number);
          const degrees = start + 15;
          const radius = (bucket.count / max) * maxRadius;
          const end = point(degrees, radius);
          return <line className="bearing-bar" key={bucket.key} x1={center} y1={center} x2={end.x} y2={end.y} />;
        })}
      </svg>
    </section>
  );
}

function bearingSectorLabel(degree: number) {
  const start = Math.floor(degree / 30) * 30;
  return `${start} - ${start + 30}`;
}

function bearingSectorBuckets(data: PercentBucket[]) {
  const total = data.reduce((sum, bucket) => sum + bucket.count, 0);
  const bySector = new Map<string, number>();
  for (const bucket of data) {
    const degree = Number(bucket.key);
    const label = Number.isFinite(degree) ? bearingSectorLabel(degree) : bucket.key;
    bySector.set(label, (bySector.get(label) ?? 0) + bucket.count);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const key = `${index * 30} - ${index * 30 + 30}`;
    const count = bySector.get(key) ?? 0;
    return {
      key,
      count,
      percent: total > 0 ? (count / total) * 100 : 0
    };
  });
}

function ExactDegreeTable({ data }: { data: PercentBucket[] }) {
  const [sort, setSort] = useState<"degree" | "least" | "most">("degree");
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      if (sort === "least") {
        return a.count - b.count || Number(a.key) - Number(b.key);
      }
      if (sort === "most") {
        return b.count - a.count || Number(a.key) - Number(b.key);
      }
      return Number(a.key) - Number(b.key);
    });
  }, [data, sort]);
  const max = Math.max(1, ...sortedData.map((row) => row.count));
  return (
    <section className="mini-table">
      <div className="mini-table-heading">
        <h3>Finds by exact degree from home</h3>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="degree">Degree order</option>
          <option value="least">Least to most</option>
          <option value="most">Most to least</option>
        </select>
      </div>
      <div className="degree-grid">
        {sortedData.map((row) => (
          <div className="degree-cell" key={row.key}>
            <span>{row.key} deg</span>
            <strong>{row.count}</strong>
            <small>{row.percent.toFixed(2)}%</small>
            <span className="degree-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
    </section>
  );
}

function FragmentRow({ row, max }: { row: PercentBucket; max: number }) {
  return (
    <>
      <span>{row.key}</span>
      <strong>{row.count}</strong>
      <span>{row.percent.toFixed(2)}%</span>
      <span className="bar-track">
        <span style={{ width: `${(row.count / max) * 100}%` }} />
      </span>
    </>
  );
}

function AverageTable({ title, data, label }: { title: string; data: AverageBucket[]; label: string }) {
  const max = Math.max(1, ...data.map((row) => row.average));
  return (
    <section className="mini-table">
      <h3>{title}</h3>
      <div className="mini-table-grid average-grid">
        <span>Year</span>
        <span>Amount</span>
        <span>{label}</span>
        <span />
        {data.map((row) => (
          <AverageRow key={row.year} row={row} max={max} />
        ))}
      </div>
    </section>
  );
}

function AverageRow({ row, max }: { row: AverageBucket; max: number }) {
  return (
    <>
      <span>{row.year}</span>
      <strong>{row.amount}</strong>
      <span>{row.average.toFixed(3)}</span>
      <span className="bar-track">
        <span style={{ width: `${(row.average / max) * 100}%` }} />
      </span>
    </>
  );
}

function BreakdownStatsPanel({ stats }: { stats: any }) {
  return (
    <section className="panel">
      <h2>Find breakdowns</h2>
      <div className="stats-breakdown-grid">
        <AverageTable title="Average difficulty per year" data={stats?.averageDifficultyByYear ?? []} label="Average D" />
        <AverageTable title="Average terrain per year" data={stats?.averageTerrainByYear ?? []} label="Average T" />
        <PercentTable title="Finds by month" data={stats?.findsByCalendarMonth ?? []} />
        <PercentTable title="Finds by weekday" data={stats?.findsByWeekday ?? []} />
        <PercentTable title="Finds by year placed" data={stats?.findsByPlacedYear ?? []} />
        <PercentTable title="Finds to today for each year" data={stats?.findsToTodayByYear ?? []} />
      </div>
    </section>
  );
}

function WayTo81Panel({ entries }: { entries: WayTo81Entry[] }) {
  return (
    <section className="panel">
      <h2>Way to 81</h2>
      <div className="way-table">
        <span>#</span>
        <span>Date</span>
        <span>Interval</span>
        <span>GC Code</span>
        <span>Cache name</span>
        <span>Type</span>
        <span>D/T</span>
        {entries.map((entry) => (
          <WayTo81Row entry={entry} key={`${entry.index}-${entry.gcCode}`} />
        ))}
      </div>
    </section>
  );
}

function WayTo81Row({ entry }: { entry: WayTo81Entry }) {
  return (
    <>
      <span>{entry.index}</span>
      <span>{entry.date}</span>
      <span>{entry.intervalDays == null ? "-" : `${entry.intervalDays} days`}</span>
      <a href={`https://coord.info/${entry.gcCode}`} rel="noreferrer" target="_blank">
        {entry.gcCode}
      </a>
      <span>{entry.name}</span>
      <span>{entry.cacheType ?? "Unknown"}</span>
      <span>
        {entry.difficulty}/{entry.terrain}
      </span>
    </>
  );
}

function CalendarHeatmap({ title, data }: { title: string; data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  const filled = data.filter((bucket) => bucket.count > 0).length;
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <section className="mini-table wide-table">
      <h3>{title}</h3>
      <div className="calendar-grid">
        <span />
        {Array.from({ length: 31 }, (_, day) => (
          <span key={day + 1}>{day + 1}</span>
        ))}
        {monthNames.map((month, monthIndex) => (
          <CalendarMonthRow counts={counts} key={month} max={max} month={month} monthIndex={monthIndex} />
        ))}
      </div>
      <div className="mini-table-footer">
        <span>Filled dates</span>
        <strong>
          {filled}/366 ({((filled / 366) * 100).toFixed(1)}%)
        </strong>
      </div>
    </section>
  );
}

function CalendarMonthRow({
  counts,
  max,
  month,
  monthIndex
}: {
  counts: Map<string, number>;
  max: number;
  month: string;
  monthIndex: number;
}) {
  return (
    <>
      <strong>{month}</strong>
      {Array.from({ length: 31 }, (_, dayIndex) => {
        const day = dayIndex + 1;
        const key = `${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = counts.get(key) ?? 0;
        return (
          <span
            className={count > 0 ? "calendar-cell filled" : "calendar-cell"}
            key={key}
            style={{ "--intensity": count / max } as CSSProperties & Record<"--intensity", number>}
            title={`${key}: ${count}`}
          >
            {count || ""}
          </span>
        );
      })}
    </>
  );
}

function HiddenMonthGrid({ data }: { data: CountBucket[] }) {
  const counts = new Map(data.map((bucket) => [bucket.key, bucket.count]));
  const years = [...new Set(data.map((bucket) => bucket.key.slice(0, 4)))].sort();
  const max = Math.max(1, ...data.map((bucket) => bucket.count));
  const filled = data.filter((bucket) => bucket.count > 0).length;

  return (
    <section className="mini-table wide-table">
      <h3>Finds by hidden month</h3>
      <div className="hidden-month-grid">
        <span />
        {monthLabels.map((month) => (
          <span key={month}>{month}</span>
        ))}
        {years.map((year) => (
          <HiddenMonthRow counts={counts} key={year} max={max} year={year} />
        ))}
      </div>
      <div className="mini-table-footer">
        <span>Filled hidden months</span>
        <strong>{filled}</strong>
      </div>
    </section>
  );
}

function HiddenMonthRow({ counts, max, year }: { counts: Map<string, number>; max: number; year: string }) {
  return (
    <>
      <strong>{year}</strong>
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
        const count = counts.get(key) ?? 0;
        return (
          <span
            className={count > 0 ? "calendar-cell filled" : "calendar-cell"}
            key={key}
            style={{ "--intensity": count / max } as CSSProperties & Record<"--intensity", number>}
          >
            {count || ""}
          </span>
        );
      })}
    </>
  );
}

function ElevationPanel({ data }: { data: CountBucket[] }) {
  if (data.length === 0) {
    return null;
  }

  return (
    <section className="mini-table wide-table">
      <h3>Elevation chart</h3>
      <CountBarChart data={data} />
    </section>
  );
}

function DateGridPanel({ stats }: { stats: any }) {
  return (
    <section className="panel">
      <h2>Date grids</h2>
      <div className="stats-breakdown-grid">
        <ElevationPanel data={stats?.elevationBuckets ?? []} />
        <CalendarHeatmap title="Finds by found date" data={stats?.foundDateMatrix ?? []} />
        <CalendarHeatmap title="Finds by hidden date" data={stats?.hiddenDateMatrix ?? []} />
        <HiddenMonthGrid data={stats?.hiddenMonthMatrix ?? []} />
      </div>
    </section>
  );
}

function OwnerPanel({ owners }: { owners: PercentBucket[] }) {
  return (
    <section className="panel">
      <h2>Top hiders</h2>
      <div className="stats-breakdown-grid">
        <PercentTable title="Finds by owner" data={owners.slice(0, 20)} />
        <div className="mini-table">
          <h3>Other owners</h3>
          <div className="owner-chip-list">
            {owners.slice(20).map((owner) => (
              <span key={owner.key}>
                {owner.key} ({owner.count})
              </span>
            ))}
            {owners.length <= 20 ? <span>No other owners.</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function HomeDistancePanel({ distanceStats }: { distanceStats?: DistanceStats | null }) {
  if (!distanceStats) {
    return (
      <section className="panel">
        <h2>Home distance</h2>
        <p className="muted">Set home coordinates in Profile to show distance and bearing stats.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Home distance</h2>
      <div className="stats-breakdown-grid">
        <BearingPolarChart data={distanceStats.bearingBuckets} />
        <PercentTable title="Finds by degrees from home" data={bearingSectorBuckets(distanceStats.bearingBuckets)} />
        <DistanceBucketTable
          title="Finds by distance from home"
          data={distanceStats.distanceBuckets}
          averageDistanceKm={distanceStats.averageDistanceKm}
        />
        <details className="wide-table collapsible-table">
          <summary>
            <span>Exact 1-degree breakdown</span>
            <small>All 360 degrees</small>
          </summary>
          <ExactDegreeTable data={distanceStats.bearingBuckets} />
        </details>
      </div>
    </section>
  );
}

function MonthPerYearTable({ findsByMonth, findsByDay }: { findsByMonth: CountBucket[]; findsByDay: CountBucket[] }) {
  const years = useMemo(() => yearOptions(findsByMonth), [findsByMonth]);
  const [selectedYear, setSelectedYear] = useState<string>("all");

  useEffect(() => {
    if (selectedYear !== "all" && !years.includes(selectedYear)) {
      setSelectedYear("all");
    }
  }, [selectedYear, years]);

  const rows = useMemo(() => {
    const countByMonth = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
    const firstFindKey = findsByDay[0]?.key;
    const daysByMonth = new Map<string, number>();
    for (const day of findsByDay) {
      const key = day.key.slice(0, 7);
      daysByMonth.set(key, (daysByMonth.get(key) ?? 0) + 1);
    }

    const visibleYears = selectedYear === "all" ? years : years.filter((year) => year === selectedYear);
    return visibleYears.map((year) => {
      const months = monthLabels.map((label, index) => {
        const key = `${year}-${String(index + 1).padStart(2, "0")}`;
        const finds = countByMonth.get(key) ?? 0;
        const daysCaching = daysByMonth.get(key) ?? 0;
        return { key, label, finds, daysCaching };
      });
      const totalFinds = months.reduce((sum, month) => sum + month.finds, 0);
      const daysCaching = months.reduce((sum, month) => sum + month.daysCaching, 0);
      const monthsWithFinds = months.filter((month) => month.finds > 0).length;
      const daysElapsed = Math.max(0, elapsedDaysForYear(Number(year), firstFindKey));

      return {
        year,
        months,
        totalFinds,
        daysCaching,
        daysElapsed,
        averageCachingDay: daysCaching > 0 ? totalFinds / daysCaching : 0,
        averageDay: daysElapsed > 0 ? totalFinds / daysElapsed : 0,
        averageMonth: monthsWithFinds > 0 ? totalFinds / monthsWithFinds : 0
      };
    });
  }, [findsByDay, findsByMonth, selectedYear, years]);

  return (
    <div className="month-year-card">
      <div className="month-year-heading">
        <h3>Finds by month per year</h3>
        <label>
          <span className="sr-only">Year</span>
          <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
            <option value="all">All years</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.map((row) => (
        <section className="month-year-row" key={row.year}>
          <h4>{row.year}</h4>
          <div className="month-year-layout">
            <div className="month-grid">
              <div className="month-grid-label">Month</div>
              {row.months.map((month) => (
                <div key={month.key}>{month.label}</div>
              ))}
              <div className="month-grid-label">Finds</div>
              {row.months.map((month) => (
                <strong key={month.key}>{month.finds || ""}</strong>
              ))}
              <div className="month-grid-label">Days caching</div>
              {row.months.map((month) => (
                <span key={month.key}>{month.daysCaching || ""}</span>
              ))}
            </div>
            <dl className="year-summary">
              <div>
                <dt>Total finds</dt>
                <dd>{row.totalFinds}</dd>
              </div>
              <div>
                <dt>Days caching</dt>
                <dd>
                  {row.daysCaching}/{row.daysElapsed}
                </dd>
              </div>
              <div>
                <dt>Average finds per caching day</dt>
                <dd>{row.averageCachingDay.toFixed(1)}</dd>
              </div>
              <div>
                <dt>Overall finds per day</dt>
                <dd>{row.averageDay.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Finds per active month</dt>
                <dd>{row.averageMonth.toFixed(1)}</dd>
              </div>
            </dl>
          </div>
        </section>
      ))}
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    void apiFetch<{ stats: any }>("/stats/summary").then((data) => setStats(data.stats));
  }, []);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Reusable stats package</p>
        <h1>Statistics</h1>
      </header>
      <section className="stat-grid">
        <StatCard label="Total finds" value={stats?.totalFinds ?? 0} />
        <StatCard label="Longest streak" value={stats?.streaks?.longest ?? 0} detail="days" />
        <StatCard label="Current streak" value={stats?.streaks?.current ?? 0} detail="days" />
        <StatCard label="Milestones" value={stats?.milestones?.length ?? 0} />
      </section>
      <section className="two-column">
        <MonthlyStatsCard stats={stats} />
        <div className="panel">
          <h2>Cache types</h2>
          <CountBarChart data={stats?.cacheTypes ?? []} />
        </div>
        <div className="panel">
          <h2>Sizes</h2>
          <CountBarChart data={stats?.sizes ?? []} />
        </div>
        <div className="panel">
          <h2>Countries</h2>
          <CountBarChart data={stats?.countries ?? []} />
        </div>
      </section>
      <section className="panel">
        <h2>Difficulty / Terrain</h2>
        <DifficultyTerrainGrid data={stats?.difficultyTerrain ?? []} />
      </section>
      <BreakdownStatsPanel stats={stats} />
      <HomeDistancePanel distanceStats={stats?.distanceStats} />
      <WayTo81Panel entries={stats?.wayTo81 ?? []} />
      <ExtremeCachesPanel />
      <DateGridPanel stats={stats} />
      <OwnerPanel owners={stats?.ownerBuckets ?? []} />
    </AppShell>
  );
}

