"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Copy, ExternalLink, Footprints, Puzzle, Trophy, Users } from "lucide-react";
import { formatCoordinateDd, formatCoordinateDdm, formatCoordinateDms } from "@geostats/shared";
import { AppShell } from "../../../components/app-shell";
import { type UnifiedCacheDetail } from "../../../components/ui/cache-drawer";
import { apiFetch } from "../../../lib/api";
import { copyText } from "../../../lib/copy-text";

export default function CacheDetailPage() {
  const params = useParams<{ gcCode: string }>();
  const gcCode = decodeURIComponent(params.gcCode ?? "").toUpperCase();
  return <AppShell><CacheDetailContent key={gcCode} gcCode={gcCode} /></AppShell>;
}

function CacheDetailContent({ gcCode }: { gcCode: string }) {
  const [detail, setDetail] = useState<UnifiedCacheDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!gcCode) return;
    let active = true;
    setLoading(true);
    void apiFetch<UnifiedCacheDetail>(`/stats/cache/${encodeURIComponent(gcCode)}`)
      .then((res) => { if (active) { setDetail(res); setError(null); } })
      .catch((cause: Error) => { if (active) { setDetail(null); setError(cause.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gcCode]);

  async function copyValue(value: string) {
    const ok = await copyText(value).catch(() => false);
    if (!ok) return;
    setCopied(value);
    window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1400);
  }

  const lat = detail?.cache.correctedLatitude ?? detail?.cache.latitude;
  const lon = detail?.cache.correctedLongitude ?? detail?.cache.longitude;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Unified cache profile · {gcCode}</p>
          <h1>{detail?.cache.name ?? gcCode}</h1>
        </div>
        <div className="logbook-header-actions">
          <Link className="secondary-button" href="/logbook">
            <ArrowLeft size={15} /> Logbook
          </Link>
          <a className="primary-button" href={`https://coord.info/${encodeURIComponent(gcCode)}`} target="_blank" rel="noreferrer">
            <ExternalLink size={15} /> Open on Geocaching.com
          </a>
        </div>
      </header>

      {loading ? <section className="panel"><p className="muted">Loading unified cache profile…</p></section> : null}
      {error ? <section className="panel"><p className="notice error">{error}</p></section> : null}

      {detail ? (
        <>
          <section className="panel">
            <h2>Cache metadata & coordinates</h2>
            <div className="cache-detail-meta-grid">
              <div className="cache-detail-meta-item">
                <small className="muted">Type</small>
                <strong>{detail.cache.cacheType ?? "Unknown"}</strong>
              </div>
              <div className="cache-detail-meta-item">
                <small className="muted">Difficulty / Terrain</small>
                <strong>{detail.cache.difficulty != null && detail.cache.terrain != null ? `D${detail.cache.difficulty} / T${detail.cache.terrain}` : "—"}</strong>
              </div>
              <div className="cache-detail-meta-item">
                <small className="muted">Size</small>
                <strong>{detail.cache.size ?? "—"}</strong>
              </div>
              <div className="cache-detail-meta-item">
                <small className="muted">Location</small>
                <strong>{[detail.cache.county, detail.cache.region, detail.cache.country].filter(Boolean).join(", ") || "—"}</strong>
              </div>
              <div className="cache-detail-meta-item">
                <small className="muted">Owner</small>
                <strong>{detail.cache.ownerName ?? "—"}</strong>
              </div>
              <div className="cache-detail-meta-item">
                <small className="muted">Hidden</small>
                <strong>{detail.cache.hiddenDate ?? "—"}</strong>
              </div>
            </div>

            <div className="cache-detail-coord-row">
              {lat != null && lon != null ? [
                formatCoordinateDdm(lat, lon),
                formatCoordinateDd(lat, lon),
                formatCoordinateDms(lat, lon)
              ].map((formatted) => (
                <button key={formatted} type="button" className="secondary-button" onClick={() => copyValue(formatted)}>
                  <Copy size={13} /> {copied === formatted ? "Copied!" : formatted}
                </button>
              )) : <p className="muted">Coordinates unavailable</p>}
            </div>
          </section>

          <div className="cache-detail-grid">
            <section className="panel">
              <h2>Your find & log</h2>
              {detail.find ? (
                <>
                  <div className="cache-detail-pills" style={{ marginBottom: 10 }}>
                    <span className="cache-detail-pill">Found {detail.find.foundDate}</span>
                    {detail.find.isFtf ? <span className="logbook-ftf-badge"><Trophy size={12} /> FTF</span> : null}
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
                    {detail.find.logText || "No log text recorded."}
                  </p>
                </>
              ) : (
                <p className="muted">You haven&apos;t logged a find on this cache yet.</p>
              )}
            </section>

            <section className="panel">
              <h2><Users size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />Friends who found it</h2>
              {detail.friendsWhoFound.length > 0 ? (
                <div className="table-list">
                  {detail.friendsWhoFound.map((friend) => (
                    <div key={friend.username} className="table-row">
                      <strong>{friend.username}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No saved friends have shared a find here.</p>
              )}
            </section>

            {detail.mystery ? (
              <section className="panel">
                <div className="panel-heading">
                  <h2><Puzzle size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />Mystery workspace</h2>
                  <a className="secondary-button" href={`/mysteries?cache=${encodeURIComponent(detail.mystery.clientId)}`}>Open solver</a>
                </div>
                <p className="muted">Status: <strong>{detail.mystery.status}</strong> · {detail.mystery.attemptsCount} recorded attempts</p>
                {detail.mystery.notes ? <p style={{ whiteSpace: "pre-wrap" }}>{detail.mystery.notes}</p> : null}
                {detail.mystery.clues.length > 0 ? (
                  <div className="cache-detail-pills">
                    {detail.mystery.clues.map((clue) => <span key={clue} className="cache-detail-pill">{clue}</span>)}
                  </div>
                ) : null}
              </section>
            ) : null}

            {detail.hide ? (
              <section className="panel">
                <h2>Own hide history</h2>
                <p className="muted">Placed {detail.hide.placedAt ?? "—"} · {detail.hide.receivedLogCount} received logs</p>
                <div className="table-list">
                  {detail.hide.receivedLogs.map((log, index) => (
                    <div key={`${log.date}-${index}`} className="table-row">
                      <span><strong>{log.type ?? "Log"}</strong> by {log.finder ?? "Unknown"}</span>
                      <small className="muted">{log.date ?? ""}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail.trackables.length > 0 ? (
              <section className="panel">
                <h2><Footprints size={16} style={{ verticalAlign: "-2px", marginRight: 6 }} />Trackable history at this cache</h2>
                <div className="table-list">
                  {detail.trackables.map((tb) => (
                    <div key={tb.id} className="table-row">
                      <span><strong>{tb.trackingCode}</strong> {tb.name}</span>
                      <small className="muted">{tb.logType} · {tb.loggedAt}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
