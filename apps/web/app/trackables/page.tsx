"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { TrackableMap, type TrackableMapPoint } from "../../components/trackable-map";
import { apiFetch } from "../../lib/api";

const STATES = ["OWNED", "DISCOVERED", "RETRIEVED", "DROPPED", "VISITED", "MISSING"] as const;
type TrackableState = (typeof STATES)[number];
type Trackable = {
  id: string;
  trackingCode: string;
  name: string;
  state: TrackableState;
  lastSeenAt: string | null;
  lastSeenLocation: string | null;
  distanceKm: number | null;
  notes: string | null;
  stuck: boolean;
};
type Summary = { total: number; stuck: number; byState: Partial<Record<TrackableState, number>> };
type FormValues = Omit<Trackable, "id" | "stuck">;

const stateLabels: Record<TrackableState, string> = {
  OWNED: "Owned",
  DISCOVERED: "Discovered",
  RETRIEVED: "Retrieved",
  DROPPED: "Dropped",
  VISITED: "Visited",
  MISSING: "Missing"
};

const blankForm: FormValues = {
  trackingCode: "",
  name: "",
  state: "DISCOVERED",
  lastSeenAt: "",
  lastSeenLocation: "",
  distanceKm: null,
  notes: ""
};
const STOP_PAGE_SIZE = 50;

type TrackableMapResponse = { points: TrackableMapPoint[]; total: number; unmapped: number };
type TrackableImportResponse = {
  import: {
    importedTrackables: number;
    importedLogs: number;
    estimatedLogs: number;
    inferredTrackables: number;
    skippedLogs: number;
    importedCaches: number;
    unresolvedCaches: string[];
    source: string;
  };
};

function dateInput(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

function dateLabel(value: string | null) {
  if (!value) return "No last-seen date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? dateInput(value) : date.toLocaleDateString();
}

function stopDateLabel(point: TrackableMapPoint) {
  if (point.dateEstimated) return "File order";
  const date = new Date(point.loggedAt);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString();
}

function displayCacheName(point: TrackableMapPoint): string | null {
  const name = point.cacheName?.trim() ?? "";
  const code = point.gcCode?.trim() ?? "";
  if (!name || (code && name.toUpperCase() === code.toUpperCase())) return null;
  return name;
}

function displayLocationName(point: TrackableMapPoint, cacheName: string | null): string | null {
  const location = point.locationName?.trim() ?? "";
  const code = point.gcCode?.trim() ?? "";
  if (!location || (code && location.toUpperCase() === code.toUpperCase()) || (cacheName && location.toUpperCase() === cacheName.toUpperCase())) return null;
  return location;
}

function stopTitle(point: TrackableMapPoint): string {
  return displayCacheName(point) ?? point.gcCode ?? "Unmapped stop";
}

function stopMetaLabel(point: TrackableMapPoint): string {
  const cacheName = displayCacheName(point);
  const code = point.gcCode?.trim() ?? "";
  const locationName = displayLocationName(point, cacheName);
  const details = cacheName && code ? [code] : [];
  if (!cacheName) details.push(code ? "Cache name unavailable" : "Cache location unavailable");
  if (locationName) details.push(locationName);
  details.push(stopDateLabel(point));
  return details.join(" · ");
}

export default function TrackablesPage() {
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, stuck: 0, byState: {} });
  const [form, setForm] = useState<FormValues>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrackableState | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mapPoints, setMapPoints] = useState<TrackableMapPoint[]>([]);
  const [mapUnmapped, setMapUnmapped] = useState(0);
  const [mapLoading, setMapLoading] = useState(true);
  const [selectedMapTrackable, setSelectedMapTrackable] = useState<string>("");
  const [mapCacheQuery, setMapCacheQuery] = useState("");
  const [focusedMapPointId, setFocusedMapPointId] = useState<string | null>(null);
  const [stopListStart, setStopListStart] = useState(0);
  const mapSelectionUserChanged = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [missingCacheCodes, setMissingCacheCodes] = useState<string[]>([]);
  const [importTrackingCode, setImportTrackingCode] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ trackables: Trackable[]; summary: Summary }>("/trackables");
      setTrackables(data.trackables);
      setSummary(data.summary);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load trackables");
    } finally {
      setLoading(false);
    }
  }

  async function loadMap() {
    setMapLoading(true);
    try {
      const data = await apiFetch<TrackableMapResponse>("/trackables/map");
      setMapPoints(data.points);
      setMapUnmapped(data.unmapped);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load trackable map");
    } finally {
      setMapLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadMap();
  }, []);

  useEffect(() => {
    // Pick a useful default once data arrives, but never replace a choice the
    // user has already made. Without this guard, the async map load could
    // overwrite the first selection and make the dropdown appear to need two
    // clicks.
    if (mapSelectionUserChanged.current || mapLoading || trackables.length === 0 || selectedMapTrackable) return;
    const firstWithJourney = trackables.find((trackable) => mapPoints.some((point) => point.trackableId === trackable.id));
    setSelectedMapTrackable(firstWithJourney?.id ?? trackables[0]!.id);
  }, [mapLoading, mapPoints, selectedMapTrackable, trackables]);

  useEffect(() => {
    if (!selectedMapTrackable) return;
    if (trackables.some((trackable) => trackable.id === selectedMapTrackable)) return;
    setSelectedMapTrackable(trackables[0]?.id ?? "");
  }, [selectedMapTrackable, trackables]);

  useEffect(() => {
    setFocusedMapPointId(null);
    setStopListStart(0);
    setMapCacheQuery("");
  }, [selectedMapTrackable]);

  useEffect(() => {
    setFocusedMapPointId(null);
    setStopListStart(0);
  }, [mapCacheQuery]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return trackables.filter((trackable) => {
      if (filter !== "ALL" && trackable.state !== filter) return false;
      return !needle || `${trackable.trackingCode} ${trackable.name} ${trackable.lastSeenLocation ?? ""}`.toLocaleLowerCase().includes(needle);
    });
  }, [filter, query, trackables]);

  function resetForm() {
    setForm(blankForm);
    setEditingId(null);
  }

  function edit(trackable: Trackable) {
    setEditingId(trackable.id);
    setForm({
      trackingCode: trackable.trackingCode,
      name: trackable.name,
      state: trackable.state,
      lastSeenAt: dateInput(trackable.lastSeenAt),
      lastSeenLocation: trackable.lastSeenLocation ?? "",
      distanceKm: trackable.distanceKm,
      notes: trackable.notes ?? ""
    });
    window.requestAnimationFrame(() => document.getElementById("trackable-form")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        trackingCode: form.trackingCode.trim(),
        name: form.name.trim(),
        lastSeenAt: form.lastSeenAt || null,
        lastSeenLocation: form.lastSeenLocation?.trim() || null,
        distanceKm: form.distanceKm == null ? null : Number(form.distanceKm),
        notes: form.notes?.trim() || null
      };
      await apiFetch(editingId ? `/trackables/${editingId}` : "/trackables", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload)
      });
      resetForm();
      await Promise.all([load(), loadMap()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save trackable");
    } finally {
      setBusy(false);
    }
  }

  async function remove(trackable: Trackable) {
    if (!window.confirm(`Remove ${trackable.trackingCode} from your logbook?`)) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/trackables/${trackable.id}`, { method: "DELETE" });
      if (editingId === trackable.id) resetForm();
      await Promise.all([load(), loadMap()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove trackable");
    } finally {
      setBusy(false);
    }
  }

  async function importHistory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.namedItem("file");
    if (!(file instanceof HTMLInputElement) || !file.files?.[0]) {
      setImportMessage("Choose a GPX, ZIP, KMZ, CSV, KML, or JSON export first.");
      return;
    }
    setImportBusy(true);
    setImportMessage("Reading trackable history…");
    setMissingCacheCodes([]);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file.files[0]);
      if (importTrackingCode.trim()) body.append("trackingCode", importTrackingCode.trim());
      const result = await apiFetch<TrackableImportResponse>("/trackables/import", { method: "POST", body });
      const summary = result.import;
      setMissingCacheCodes(summary.unresolvedCaches);
      const dateNote = summary.estimatedLogs > 0 ? " The KML did not include dates, so the file order was used." : "";
      const codeNote = summary.inferredTrackables > 0 ? " No TB code was present, so a temporary KML identifier was generated; edit it to the printed code when you have it." : "";
      setImportMessage(`Imported ${summary.importedLogs} movement${summary.importedLogs === 1 ? "" : "s"} for ${summary.importedTrackables} trackable${summary.importedTrackables === 1 ? "" : "s"}; ${summary.importedCaches} cache location${summary.importedCaches === 1 ? "" : "s"} saved.${dateNote}${codeNote}`);
      form.reset();
      setImportTrackingCode("");
      await Promise.all([load(), loadMap()]);
    } catch (cause) {
      setImportMessage(cause instanceof Error ? cause.message : "Trackable history import failed");
    } finally {
      setImportBusy(false);
    }
  }

  const visibleMapPoints = useMemo(
    () => [...mapPoints.filter((point) => point.trackableId === selectedMapTrackable)]
      .sort((left, right) => left.sequence - right.sequence || Date.parse(left.loggedAt) - Date.parse(right.loggedAt)),
    [mapPoints, selectedMapTrackable]
  );
  const missingCacheNameCodes = useMemo(
    () => [...new Set(visibleMapPoints.flatMap((point) => point.gcCode && !displayCacheName(point) ? [point.gcCode] : []))],
    [visibleMapPoints]
  );
  const mapCacheMatches = useMemo(() => {
    const needle = mapCacheQuery.trim().toLocaleLowerCase();
    if (!needle) return visibleMapPoints;
    return visibleMapPoints.filter((point) => [point.gcCode, point.cacheName, point.locationName].some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [mapCacheQuery, visibleMapPoints]);
  const stopListSource = mapCacheQuery.trim() ? mapCacheMatches : visibleMapPoints;
  const highlightedMapPointIds = useMemo(() => mapCacheQuery.trim() ? mapCacheMatches.map((point) => point.id) : [], [mapCacheMatches, mapCacheQuery]);
  const stopListPoints = stopListSource.slice(stopListStart, stopListStart + STOP_PAGE_SIZE);
  const stopListEnd = Math.min(stopListStart + STOP_PAGE_SIZE, stopListSource.length);

  function focusMapPoint(point: TrackableMapPoint) {
    const index = stopListSource.findIndex((candidate) => candidate.id === point.id);
    if (index >= 0) setStopListStart(Math.floor(index / STOP_PAGE_SIZE) * STOP_PAGE_SIZE);
    setFocusedMapPointId(point.id);
  }

  function handleMapPointSelect(pointId: string) {
    const point = visibleMapPoints.find((candidate) => candidate.id === pointId);
    if (point) focusMapPoint(point);
  }

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Trackable logbook</p>
          <h1>Trackables</h1>
          <p className="page-lede">Keep your trackables in one place. Add a tracking code, update its state, and note where you last saw it.</p>
        </div>
      </header>

      <section className="stat-grid trackable-stat-grid">
        <div className="stat-card"><span>Total trackables</span><strong>{summary.total}</strong></div>
        <div className="stat-card"><span>Owned</span><strong>{summary.byState.OWNED ?? 0}</strong></div>
        <div className="stat-card"><span>In the wild</span><strong>{(summary.byState.DROPPED ?? 0) + (summary.byState.VISITED ?? 0)}</strong></div>
        <div className="stat-card"><span>Needs a look</span><strong>{summary.stuck}</strong></div>
      </section>

      <section className="panel trackable-form-panel" id="trackable-form">
        <div className="panel-heading">
          <div><h2>{editingId ? "Edit trackable" : "Add a trackable"}</h2><p className="muted">Use the code printed on the item, not a cache code.</p></div>
          {editingId ? <button className="secondary-button" type="button" onClick={resetForm}>Cancel edit</button> : null}
        </div>
        <form className="trackable-form" onSubmit={save}>
          <label><span>Tracking code</span><input required maxLength={80} value={form.trackingCode} onChange={(event) => setForm((current) => ({ ...current, trackingCode: event.target.value }))} placeholder="TB1234" /></label>
          <label><span>Name</span><input required maxLength={200} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="A red geocoin" /></label>
          <label><span>State</span><select value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value as TrackableState }))}>{STATES.map((state) => <option key={state} value={state}>{stateLabels[state]}</option>)}</select></label>
          <label><span>Last seen</span><input type="date" value={form.lastSeenAt ?? ""} onChange={(event) => setForm((current) => ({ ...current, lastSeenAt: event.target.value }))} /></label>
          <label><span>Last-seen location</span><input maxLength={200} value={form.lastSeenLocation ?? ""} onChange={(event) => setForm((current) => ({ ...current, lastSeenLocation: event.target.value }))} placeholder="GC7ABC or Stockholm" /></label>
          <label><span>Distance (km)</span><input type="number" min="0" step="0.01" value={form.distanceKm ?? ""} onChange={(event) => setForm((current) => ({ ...current, distanceKm: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
          <label className="trackable-notes-field"><span>Notes</span><textarea maxLength={2000} rows={3} value={form.notes ?? ""} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Who has it, or where it is headed" /></label>
          <div className="trackable-form-actions"><button className="primary-button" disabled={busy} type="submit">{busy ? "Saving..." : editingId ? "Save changes" : "Add trackable"}</button></div>
        </form>
      </section>

      <section className="upload-zone trackable-import-zone">
        <div className="upload-zone-copy">
          <p className="eyebrow">Bring your history with you</p>
          <h2>Import from Geocaching or GSAK</h2>
          <p className="muted">Upload a trackable journey export as GPX, ZIP, KMZ, CSV, KML, or Geocaching API JSON. Cache coordinates found in the file are added to your archive when they are not already there.</p>
        </div>
        <form onSubmit={importHistory} className="trackable-import-form">
          <input name="file" type="file" accept=".gpx,.zip,.kmz,.csv,.kml,.json,application/gpx+xml,application/zip,application/vnd.google-earth.kml+xml,text/csv,application/json" required />
          <label className="trackable-import-code"><span>Public trackable code (optional)</span><input name="trackingCode" maxLength={80} value={importTrackingCode} onChange={(event) => setImportTrackingCode(event.target.value)} placeholder="TB1234" /><small>Use this when a Geocaching KML contains cache points but omits the TB code.</small></label>
          <button className="primary-button" disabled={importBusy} type="submit">{importBusy ? "Importing…" : "Import movement history"}</button>
        </form>
        {importMessage ? <p className="muted" role="status">{importMessage}</p> : null}
        {missingCacheCodes.length > 0 ? <p className="trackable-import-warning" role="alert"><strong>Cache import needed.</strong> {missingCacheCodes.length} cache{missingCacheCodes.length === 1 ? "" : "s"} could not be matched to coordinates. Export those caches from GSAK as GPX/ZIP, or upload a Geocaching cache export, then import this journey again. <span>Missing: {missingCacheCodes.slice(0, 8).join(", ")}{missingCacheCodes.length > 8 ? "…" : ""}</span> <a href="/upload#travel-cache-import">Open cache import</a></p> : null}
      </section>

      <section className="map-stage trackable-map-stage">
        <div className="map-toolbar trackable-map-toolbar">
          <div className="trackable-map-summary"><span className="trackable-map-kicker">Journey map</span><strong>{mapLoading ? "Loading movement…" : `${visibleMapPoints.length} stop${visibleMapPoints.length === 1 ? "" : "s"}`}</strong>{mapCacheQuery.trim() ? <small>{mapCacheMatches.length} cache match{mapCacheMatches.length === 1 ? "" : "es"}</small> : null}</div>
          <label className="trackable-map-search"><span>Find a cache</span><input aria-label="Search journey caches by GC code or name" type="search" value={mapCacheQuery} onChange={(event) => setMapCacheQuery(event.target.value)} placeholder="GC code or cache name" /></label>
          <label className="trackable-map-filter"><span>Trackable</span><select value={selectedMapTrackable} onChange={(event) => { mapSelectionUserChanged.current = true; setSelectedMapTrackable(event.target.value); }}><option value="" disabled>Choose a trackable</option>{trackables.map((trackable) => <option key={trackable.id} value={trackable.id}>{trackable.trackingCode} · {trackable.name}</option>)}</select></label>
          <p className="trackable-map-hint">Clusters group nearby stops. Search narrows the stop list and highlights matches; the full route stays visible.</p>
        </div>
        <div className="trackable-map-canvas">
          <TrackableMap points={visibleMapPoints} focusPointId={focusedMapPointId} highlightPointIds={highlightedMapPointIds} onPointSelect={handleMapPointSelect} />
          <div className="trackable-map-legend" aria-label="Journey map legend"><span><b className="trackable-legend-swatch start">S</b>Start</span><span><b className="trackable-legend-swatch end">E</b>End</span><span><b className="trackable-legend-swatch stop">#</b>Stop number</span><span><b className="trackable-legend-swatch route" />Journey progress</span></div>
        </div>
        {mapUnmapped > 0 ? <p className="map-footnote">{mapUnmapped} imported movement{mapUnmapped === 1 ? " has" : "s have"} no cache coordinates. Import a GSAK cache GPX/ZIP or Geocaching cache export, then import this journey again. <a href="/upload#travel-cache-import">Open cache import</a></p> : null}
        {missingCacheNameCodes.length > 0 ? <p className="trackable-import-warning trackable-map-warning" role="status"><strong>Cache names missing.</strong> {missingCacheNameCodes.length} journey stop{missingCacheNameCodes.length === 1 ? " has" : "s have"} coordinates but no cache name in your archive. Import the matching caches from GSAK as GPX/ZIP, or upload a Geocaching cache export. <span>Missing names: {missingCacheNameCodes.slice(0, 8).join(", ")}{missingCacheNameCodes.length > 8 ? "…" : ""}</span> <a href="/upload#travel-cache-import">Open cache import</a></p> : null}
        {visibleMapPoints.length > 0 ? <div className="trackable-stop-panel">
          <div className="trackable-stop-heading">
            <div><h3>Journey stops</h3><p className="muted">{mapCacheQuery.trim() ? `${mapCacheMatches.length} matching cache${mapCacheMatches.length === 1 ? "" : "s"} · ` : ""}Select a stop to center the map and open its details.</p></div>
            <div className="trackable-stop-nav">
              <span>{stopListSource.length > 0 ? `Stops ${stopListStart + 1}–${stopListEnd} of ${stopListSource.length}` : "No matching stops"}</span>
              <button className="secondary-button" type="button" disabled={stopListStart === 0 || stopListSource.length === 0} onClick={() => setStopListStart(Math.max(0, stopListStart - STOP_PAGE_SIZE))}>Previous</button>
              <button className="secondary-button" type="button" disabled={stopListEnd >= stopListSource.length} onClick={() => setStopListStart(Math.min(Math.max(0, stopListSource.length - STOP_PAGE_SIZE), stopListStart + STOP_PAGE_SIZE))}>Next</button>
            </div>
          </div>
          {stopListPoints.length > 0 ? <ol className="trackable-stop-list" start={stopListStart + 1}>
            {stopListPoints.map((point) => <li key={point.id} className={focusedMapPointId === point.id ? "selected" : undefined}>
              <button type="button" onClick={() => focusMapPoint(point)} aria-current={focusedMapPointId === point.id ? "true" : undefined}>
                <span className="trackable-stop-number">{point.sequence}</span>
                <span className="trackable-stop-copy"><strong>{stopTitle(point)}</strong><small>{stopMetaLabel(point)}</small></span>
              </button>
            </li>)}
          </ol> : <div className="trackable-stop-empty"><strong>No cache matches</strong><p>Try a different GC code or cache name.</p><button className="secondary-button" type="button" onClick={() => setMapCacheQuery("")}>Clear search</button></div>}
        </div> : null}
      </section>

      <section className="panel">
        <div className="panel-heading trackable-list-heading"><div><h2>Logbook</h2><small className="muted">{visible.length} of {trackables.length} shown</small></div><div className="trackable-filters"><input aria-label="Search trackables" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code or name" /><select aria-label="Filter trackables by state" value={filter} onChange={(event) => setFilter(event.target.value as TrackableState | "ALL")}><option value="ALL">All states</option>{STATES.map((state) => <option key={state} value={state}>{stateLabels[state]}</option>)}</select></div></div>
        {loading ? <p className="muted">Loading trackables...</p> : null}
        {!loading && !visible.length ? <div className="trackable-empty"><span className="trackable-empty-mark">⌁</span><h3>{trackables.length ? "No matches" : "Your logbook is empty"}</h3><p>{trackables.length ? "Try a different search or state." : "Add your first trackable above. You can update its state whenever it moves."}</p></div> : null}
        <div className="trackable-list">{visible.map((trackable) => <article className="trackable-row" key={trackable.id}><div className="trackable-row-main"><div className="trackable-row-title"><strong>{trackable.name}</strong><span className={`trackable-state ${trackable.state.toLowerCase()}`}>{stateLabels[trackable.state]}</span>{trackable.stuck ? <span className="trackable-warning">Last seen over 90 days ago</span> : null}</div><div className="trackable-row-meta"><code>{trackable.trackingCode}</code><span>{dateLabel(trackable.lastSeenAt)}</span>{trackable.lastSeenLocation ? <span>{trackable.lastSeenLocation}</span> : null}{trackable.distanceKm != null ? <span>{trackable.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 2 })} km travelled</span> : null}</div>{trackable.notes ? <p>{trackable.notes}</p> : null}</div><div className="trackable-row-actions"><button className="secondary-button" type="button" onClick={() => { mapSelectionUserChanged.current = true; setSelectedMapTrackable(trackable.id); window.requestAnimationFrame(() => document.querySelector(".trackable-map-stage")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>Show journey</button><button className="secondary-button" type="button" onClick={() => edit(trackable)}>Edit</button><button className="secondary-button danger-button" disabled={busy} type="button" onClick={() => void remove(trackable)}>Remove</button></div></article>)}</div>
      </section>
      {error ? <p className="error-message">{error}</p> : null}
    </AppShell>
  );
}
