"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { CacheMap, CacheMapPoint, getCacheTypeColor } from "../../components/cache-map";
import { apiFetch } from "../../lib/api";

export default function MapPage() {
  const [points, setPoints] = useState<CacheMapPoint[]>([]);

  useEffect(() => {
    void Promise.all([
      apiFetch<{ points: CacheMapPoint[] }>("/map/caches"),
      apiFetch<{ points: CacheMapPoint[] }>("/map/hides")
    ]).then(([findData, hideData]) => setPoints([...findData.points, ...hideData.points]));
  }, []);

  const findCount = points.filter((point) => !point.isOwnHide).length;
  const ownHideCount = points.length - findCount;

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
          {points.slice(0, 20).map((point) => (
            <div key={`${point.gcCode}-${point.foundAt}`} className="table-row">
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
