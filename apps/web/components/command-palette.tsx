"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Compass, Flag, Footprints, Globe2, Goal, Home, KeyRound, Map, Navigation, Puzzle, Search, Settings, ShieldCheck, Trophy, Upload, Users, X } from "lucide-react";
import { formatCoordinateDd, formatCoordinateDdm, formatCoordinateDms, parseAnyCoordinate, rot13 } from "@geostats/shared";
import { apiFetch } from "../lib/api";

type SearchFind = {
  id: string;
  gcCode: string;
  name: string;
  foundDate: string;
  cacheType: string | null;
};

const PAGES = [
  { href: "/dashboard", label: "Dashboard", group: "Workspace", icon: Home },
  { href: "/map", label: "Map (Spatial Hub)", group: "Workspace", icon: Map },
  { href: "/stats", label: "Statistics", group: "Stats", icon: Compass },
  { href: "/logbook", label: "Logbook", group: "Stats", icon: BookOpen },
  { href: "/goals", label: "Goals", group: "Stats", icon: Goal },
  { href: "/milestones", label: "Milestones", group: "Stats", icon: Flag },
  { href: "/ftf", label: "FTF", group: "Stats", icon: Trophy },
  { href: "/scratch", label: "Scratch Map", group: "Stats", icon: Globe2 },
  { href: "/profile-html", label: "Profile HTML", group: "Stats", icon: Compass },
  { href: "/mysteries", label: "Mysteries & Solver Toolkit", group: "Field", icon: Puzzle },
  { href: "/travel", label: "Travel Planner", group: "Field", icon: Navigation },
  { href: "/challenge-checkers", label: "Challenge Checkers", group: "Field", icon: ShieldCheck },
  { href: "/trackables", label: "Trackables", group: "Field", icon: Footprints },
  { href: "/hides", label: "Hides & Maintenance", group: "Community", icon: Flag },
  { href: "/friends", label: "Friends & Leaderboard", group: "Community", icon: Users },
  { href: "/upload", label: "Upload GPX / ZIP", group: "Data", icon: Upload },
  { href: "/imports", label: "Import History", group: "Data", icon: Upload },
  { href: "/settings/profile", label: "Profile Settings", group: "Account", icon: Settings }
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [finds, setFinds] = useState<SearchFind[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setFinds([]);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setFinds([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void apiFetch<{ finds: SearchFind[] }>(`/stats/finds?q=${encodeURIComponent(trimmed)}&limit=6`)
        .then((res) => {
          if (active) setFinds(res.finds ?? []);
        })
        .catch(() => {
          if (active) setFinds([]);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const trimmed = query.trim();
  const directGcCode = useMemo(() => {
    const match = trimmed.toUpperCase().match(/^GC[A-Z0-9]{2,12}$/);
    return match ? match[0] : null;
  }, [trimmed]);

  const rot13Preview = useMemo(() => {
    const match = trimmed.match(/^rot13\s+(.+)$/i);
    return match ? rot13(match[1]!) : null;
  }, [trimmed]);

  const parsedCoord = useMemo(() => (trimmed.length >= 6 ? parseAnyCoordinate(trimmed) : null), [trimmed]);

  const matchedPages = useMemo(() => {
    if (!trimmed) return PAGES.slice(0, 8);
    const q = trimmed.toLowerCase();
    return PAGES.filter((page) => page.label.toLowerCase().includes(q) || page.group.toLowerCase().includes(q)).slice(0, 8);
  }, [trimmed]);

  if (!open) return null;

  function go(href: string) {
    onClose();
    if (href === "/mysteries") {
      window.location.href = href;
      return;
    }
    router.push(href);
  }

  return (
    <div className="ds-cmdk-backdrop" role="dialog" aria-modal="true" aria-label="Quick command palette" onClick={onClose}>
      <div className="ds-cmdk-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="ds-cmdk-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to page, GC code, log text, coordinates, or 'rot13 ...'"
          />
          <button type="button" className="row-delete" aria-label="Close command palette" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="ds-cmdk-results">
          {rot13Preview ? (
            <div className="ds-cmdk-instant">
              <span><KeyRound size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />ROT13 Decode</span>
              <code>{rot13Preview}</code>
            </div>
          ) : null}

          {parsedCoord ? (
            <div className="ds-cmdk-instant">
              <span><Compass size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Coordinate Converter</span>
              <code>DDM: {formatCoordinateDdm(parsedCoord.latitude, parsedCoord.longitude)}</code>
              <code>DD: {formatCoordinateDd(parsedCoord.latitude, parsedCoord.longitude)}</code>
              <code>DMS: {formatCoordinateDms(parsedCoord.latitude, parsedCoord.longitude)}</code>
            </div>
          ) : null}

          {directGcCode ? (
            <div>
              <p className="ds-cmdk-group-label">Direct GC Code</p>
              <div className="ds-cmdk-list">
                <button type="button" className="ds-cmdk-item" onClick={() => go(`/cache/${directGcCode}`)}>
                  <span className="ds-cmdk-item-main">
                    <Compass size={16} />
                    <strong>Open {directGcCode}</strong>
                  </span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          ) : null}

          {finds.length > 0 ? (
            <div>
              <p className="ds-cmdk-group-label">Matching Finds {searching ? "…" : ""}</p>
              <div className="ds-cmdk-list">
                {finds.map((find) => (
                  <button key={find.id} type="button" className="ds-cmdk-item" onClick={() => go(`/cache/${find.gcCode}`)}>
                    <span className="ds-cmdk-item-main">
                      <strong>{find.gcCode}</strong>
                      <span>{find.name}</span>
                    </span>
                    <small>{find.foundDate}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {matchedPages.length > 0 ? (
            <div>
              <p className="ds-cmdk-group-label">Navigation</p>
              <div className="ds-cmdk-list">
                {matchedPages.map((page) => {
                  const Icon = page.icon;
                  return (
                    <button key={page.href} type="button" className="ds-cmdk-item" onClick={() => go(page.href)}>
                      <span className="ds-cmdk-item-main">
                        <Icon size={16} />
                        <span>{page.label}</span>
                      </span>
                      <small>{page.group}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
