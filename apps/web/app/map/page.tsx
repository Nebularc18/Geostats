"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMap, CacheMapPoint, getCacheTypeColor } from "../../components/cache-map";
import { apiFetch } from "../../lib/api";

function mapPointDate(point: CacheMapPoint) {
  return point.isOwnHide ? point.placedAt : point.foundAt;
}

function mapPointTime(point: CacheMapPoint) {
  const timestamp = Date.parse(mapPointDate(point) ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export default function MapPage() {
  const [points, setPoints] = useState<CacheMapPoint[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      apiFetch<{ points: CacheMapPoint[] }>("/map/caches"),
      apiFetch<{ points: CacheMapPoint[] }>("/map/hides")
    ]).then(([findResult, hideResult]) => {
      if (!active) {
        return;
      }
      const findPoints = findResult.status === "fulfilled" ? findResult.value.points : [];
      const hidePoints = hideResult.status === "fulfilled" ? hideResult.value.points : [];
      setPoints([...findPoints, ...hidePoints]);
    });
    return () => {
      active = false;
    };
  }, []);

  const findCount = points.filter((point) => !point.isOwnHide).length;
  const ownHideCount = points.length - findCount;
  const visiblePoints = [...points].sort((a, b) => mapPointTime(b) - mapPointTime(a)).slice(0, 20);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">PostGIS-ready coordinates</p>
        <h1>Map</h1>
      </header>
      <section className="map-stage">
        <div className="map-toolbar">
          <strong>{findCount} plotted finds</strong>
          <span>{ownHideCount} own hides</span>
        </div>
        <CacheMap points={points} />
      </section>
      <section className="panel">
        <h2>Recent map points</h2>
        <div className="table-list">
          {visiblePoints.map((point) => (
            <div key={`${point.isOwnHide ? "hide" : "find"}-${point.gcCode}-${mapPointDate(point) || point.id}`} className="table-row">
              <a
                className="cache-link"
                href={`https://coord.info/${point.gcCode}`}
                rel="noreferrer"
                target="_blank"
                style={{ color: getCacheTypeColor(point.cacheType, point.isOwnHide) }}
              >
                <strong>{point.gcCode}</strong> {point.name}
              </a>
              <small style={{ color: getCacheTypeColor(point.cacheType, point.isOwnHide) }}>
                {point.isOwnHide ? "Own hide - " : ""}
                {point.latitude}, {point.longitude}
              </small>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
