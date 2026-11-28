"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Copy, ExternalLink, Puzzle, Trophy, Users, X } from "lucide-react";
import { formatCoordinateDd, formatCoordinateDdm } from "@geostats/shared";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/copy-text";
import { Modal } from "./modal";

export type UnifiedCacheDetail = {
  gcCode: string;
  cache: {
    id: string;
    gcCode: string;
    name: string;
    cacheType: string | null;
    difficulty: number | null;
    terrain: number | null;
    size: string | null;
    latitude: number | null;
    longitude: number | null;
    correctedLatitude: number | null;
    correctedLongitude: number | null;
    country: string | null;
    region: string | null;
    county: string | null;
    hiddenDate: string | null;
    ownerName: string | null;
  };
  find: { id: string; foundAt: string; foundDate: string; isFtf: boolean; logText: string | null } | null;
  hide: { id: string; placedAt: string | null; receivedLogCount: number; receivedLogs: Array<{ date?: string; finder?: string; type?: string; text?: string }> } | null;
  mystery: { clientId: string; status: string; notes: string; fieldNotes: string; clues: string[]; attemptsCount: number; updatedAt: string } | null;
  friendsWhoFound: Array<{ username: string }>;
  trackables: Array<{ id: string; trackingCode: string; name: string; state: string; logType: string; loggedAt: string }>;
};

export function CacheDrawer({ gcCode, onClose }: { gcCode: string | null; onClose: () => void }) {
  return gcCode ? (
    <Modal className="ds-drawer-backdrop" label={`Cache details for ${gcCode}`} onClose={onClose}>
      <CacheDrawerContent key={gcCode} gcCode={gcCode} onClose={onClose} />
    </Modal>
  ) : null;
}

function CacheDrawerContent({ gcCode, onClose }: { gcCode: string; onClose: () => void }) {
  const [detail, setDetail] = useState<UnifiedCacheDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!gcCode) return;
    let active = true;
    setLoading(true);
    setError(null);
    void apiFetch<UnifiedCacheDetail>(`/stats/cache/${encodeURIComponent(gcCode)}`)
      .then((res) => { if (active) setDetail(res); })
      .catch((cause: Error) => { if (active) { setDetail(null); setError(cause.message); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [gcCode]);

  const lat = detail?.cache.correctedLatitude ?? detail?.cache.latitude;
  const lon = detail?.cache.correctedLongitude ?? detail?.cache.longitude;

  async function copyCoords() {
    if (lat == null || lon == null) return;
    const ok = await copyText(formatCoordinateDdm(lat, lon)).catch(() => false);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <aside className="ds-drawer">
      <header className="ds-drawer-header">
        <div>
          <p className="eyebrow">{gcCode}</p>
          <h2>{detail?.cache.name ?? (loading ? "Loading cache…" : gcCode)}</h2>
        </div>
        <button type="button" className="row-delete" aria-label="Close cache inspector" onClick={onClose}>
          <X size={18} />
        </button>
      </header>

      <div className="ds-drawer-body">
        {error ? <p className="notice error">{error}</p> : null}
        {detail ? (
          <>
            <div className="ds-drawer-section">
              <h3>Overview</h3>
              <p className="muted" style={{ margin: 0 }}>
                {detail.cache.cacheType ?? "Unknown type"}
                {detail.cache.difficulty != null && detail.cache.terrain != null ? ` · D${detail.cache.difficulty} / T${detail.cache.terrain}` : ""}
                {detail.cache.size ? ` · ${detail.cache.size}` : ""}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {[detail.cache.county, detail.cache.region, detail.cache.country].filter(Boolean).join(", ") || "Location unknown"}
                {detail.cache.ownerName ? ` · by ${detail.cache.ownerName}` : ""}
              </p>
              {lat != null && lon != null ? (
                <>
                  <div className="cache-detail-coord-row">
                    <code>{formatCoordinateDdm(lat, lon)}</code>
                    <button type="button" className="text-button" onClick={() => void copyCoords()}>
                      <Copy size={13} /> {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <small className="muted">DD: {formatCoordinateDd(lat, lon)}</small>
                </>
              ) : <p className="muted">Coordinates unavailable</p>}
            </div>

            {detail.find ? (
              <div className="ds-drawer-section">
                <h3>Your Find ({detail.find.foundDate}){detail.find.isFtf ? " · FTF" : ""}</h3>
                {detail.find.isFtf ? <span className="logbook-ftf-badge" style={{ alignSelf: "flex-start" }}><Trophy size={12} /> First to Find</span> : null}
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>
                  {detail.find.logText || "No log text recorded."}
                </p>
              </div>
            ) : null}

            {detail.mystery ? (
              <div className="ds-drawer-section">
                <h3><Puzzle size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Mystery Workspace ({detail.mystery.status})</h3>
                {detail.mystery.notes ? <p style={{ margin: 0, fontSize: "0.88rem" }}>{detail.mystery.notes}</p> : null}
                {detail.mystery.clues.length > 0 ? (
                  <div className="cache-detail-pills">
                    {detail.mystery.clues.map((clue) => <span key={clue} className="cache-detail-pill">{clue}</span>)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {detail.friendsWhoFound.length > 0 ? (
              <div className="ds-drawer-section">
                <h3><Users size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Friends Who Found This</h3>
                <div className="cache-detail-pills">
                  {detail.friendsWhoFound.map((friend) => (
                    <span key={friend.username} className="cache-detail-pill">
                      {friend.username}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="ds-drawer-footer">
        <Link className="primary-button" href={`/cache/${encodeURIComponent(gcCode)}`} onClick={onClose}>
          Full Cache Page
        </Link>
        <a className="secondary-button" href={`https://coord.info/${encodeURIComponent(gcCode)}`} target="_blank" rel="noreferrer">
          <ExternalLink size={14} /> Geocaching.com
        </a>
      </footer>
    </aside>
  );
}
