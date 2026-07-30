"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AchievementBadges } from "../../components/achievement-badges";
import { AppShell } from "../../components/app-shell";
import { CountBarChart } from "../../components/charts";
import { StatCard } from "../../components/stat-card";
import { apiFetch } from "../../lib/api";

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isDevelopment = process.env.NODE_ENV === "development";
const developmentGpxStats = {
  totalFinds: 5,
  cacheTypes: [{ key: "Traditional Cache", count: 5 }],
  sizes: [
    { key: "Micro", count: 2 },
    { key: "Small", count: 3 }
  ],
  countries: [
    { key: "Sweden", count: 3 },
    { key: "Iceland", count: 2 }
  ],
  regions: [
    { key: "Blekinge", count: 3 },
    { key: "Capital Region", count: 1 },
    { key: "Southern Region", count: 1 }
  ],
  findsByMonth: [
    { key: "2025-11", count: 2 },
    { key: "2026-03", count: 1 },
    { key: "2026-04", count: 2 }
  ],
  difficultyTerrain: [
    { difficulty: 1.5, terrain: 1.5, count: 2 },
    { difficulty: 2, terrain: 3, count: 1 },
    { difficulty: 3.5, terrain: 1.5, count: 1 },
    { difficulty: 2, terrain: 1.5, count: 1 }
  ],
  streaks: { longest: 1, current: 0 },
  summaryNumbers: {
    bestDay: { key: "2026-04-02", count: 1 },
    bestMonth: { key: "2026-04", count: 2 },
    cachingDays: 5,
    findsPerDay: 1
  },
  achievementStats: {
    distinctAttributes: 11,
    maxCacheTypesInDay: 1,
    maxDistanceKm: null,
    longLogsWritten: 0,
    hostedEventCaches: 0
  },
  distanceStats: { averageDistanceKm: null, maxDistanceKm: null, bearingBuckets: [] },
  ftfStats: { total: 0 },
  hideStats: { totalHides: 0, totalFavoritePoints: 0, hostedEventCaches: 0 }
};

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addUtcMonths(date: Date, amount: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function latestTwelveMonths(findsByMonth: { key: string; count: number }[] = []) {
  const countByMonth = new Map(findsByMonth.map((bucket) => [bucket.key, bucket.count]));
  const lastKey = findsByMonth.at(-1)?.key ?? monthKey(new Date());
  const [year, month] = lastKey.split("-").map(Number);
  const lastMonth = new Date(Date.UTC(year, month - 1, 1));

  return Array.from({ length: 12 }, (_, index) => {
    const date = addUtcMonths(lastMonth, index - 11);
    const month = monthKey(date);
    return {
      key: `${monthLabels[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`,
      count: countByMonth.get(month) ?? 0
    };
  });
}

function formatImportDate(value?: string) {
  if (!value) {
    return "No imports yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(isDevelopment ? developmentGpxStats : null);
  const [imports, setImports] = useState<any[]>([]);

  useEffect(() => {
    void apiFetch<{ stats: any }>("/stats/summary")
      .then((data) => {
        if (!isDevelopment || data.stats?.totalFinds > 0) {
          setStats(data.stats);
        }
      })
      .catch(() => {
        if (!isDevelopment) {
          setStats({});
        }
      });
    void apiFetch<{ imports: any[] }>("/imports").then((data) => setImports(data.imports)).catch(() => setImports([]));
  }, []);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Private profile stats</p>
        <h1>Your cache archive</h1>
        <Link className="primary-link" href="/upload">
          Upload GPX or ZIP
        </Link>
      </header>
      <section className="stat-grid">
        <StatCard label="Total finds" value={stats?.totalFinds ?? 0} />
        <StatCard label="Cache types" value={stats?.cacheTypes?.length ?? 0} />
        <StatCard label="Countries" value={stats?.countries?.length ?? 0} />
        <StatCard label="Longest streak" value={stats?.streaks?.longest ?? 0} detail="days" />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>At a glance</h2>
          <small className="muted">Last import: {formatImportDate(imports[0]?.createdAt)}</small>
        </div>
        <div className="dashboard-glance">
          <div>
            <CountBarChart data={latestTwelveMonths(stats?.findsByMonth ?? [])} />
            <small className="muted">Latest 12 months</small>
          </div>
          <div className="stat-table compact">
            <div>
              <span>Best day</span>
              <strong>
                {stats?.summaryNumbers?.bestDay
                  ? `${stats.summaryNumbers.bestDay.count} finds on ${stats.summaryNumbers.bestDay.key}`
                  : "-"}
              </strong>
            </div>
            <div>
              <span>Best month</span>
              <strong>
                {stats?.summaryNumbers?.bestMonth
                  ? `${stats.summaryNumbers.bestMonth.count} finds in ${stats.summaryNumbers.bestMonth.key}`
                  : "-"}
              </strong>
            </div>
            <div>
              <span>Cache days</span>
              <strong>{stats?.summaryNumbers?.cachingDays ?? 0}</strong>
            </div>
            <div>
              <span>Average/day</span>
              <strong>{stats?.summaryNumbers?.findsPerDay?.toFixed(2) ?? "0.00"}</strong>
            </div>
            <div>
              <span>Average distance</span>
              <strong>
                {stats?.distanceStats?.averageDistanceKm == null
                  ? "-"
                  : `${Math.round(stats.distanceStats.averageDistanceKm)} km`}
              </strong>
            </div>
          </div>
        </div>
      </section>
      <AchievementBadges stats={stats} variant="dashboard" />
    </AppShell>
  );
}
