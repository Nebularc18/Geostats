"use client";

import Link from "next/link";
import { CACHE_IMPORT_MODES, ImportStatus, formatImportReceipt } from "@geostats/shared";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Database, Download, FileUp, Route, Shield, UploadCloud } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { hasActiveImports, type ImportListItem, type ImportsResponse } from "../../lib/imports";

export default function UploadPage() {
  const [mode, setMode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [travelMessage, setTravelMessage] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [gsakStatus, setGsakStatus] = useState<{ connected: boolean; lastImportedAt: string | null } | null>(null);
  const [gsakMessage, setGsakMessage] = useState<string | null>(null);
  const [gsakBusy, setGsakBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminGsakBusy, setAdminGsakBusy] = useState(false);
  const [adminGsakMessage, setAdminGsakMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await apiFetch<ImportsResponse>("/imports");
    setImports(data.imports);
    return data.imports;
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage("Could not load recent imports."));
    void apiFetch<{ connected: boolean; lastImportedAt: string | null }>("/collector/gsak/status").then(setGsakStatus);
    void apiFetch<{ isAdmin: boolean }>("/admin/access")
      .then((data) => setIsAdmin(Boolean(data.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [refresh]);

  useEffect(() => {
    if (!hasActiveImports(imports)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh().catch(() => setMessage("Could not load recent imports."));
    }, 3000);

    return () => window.clearInterval(interval);
  }, [imports, refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("Uploading...");
    try {
      const { import: job } = await apiFetch<{ import: { status: ImportStatus } }>("/imports/upload", { method: "POST", body: form });
      setMessage(job.status === ImportStatus.FAILED ? "The import could not queue. Retry it from history." : "Import queued.");
      formElement.reset();
      window.dispatchEvent(new CustomEvent("geostats:imports-updated"));
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    }
  }

  async function submitTravelCaches(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("purpose", "travel");
    setTravelMessage("Uploading cache list…");
    try {
      const { import: job } = await apiFetch<{ import: { status: ImportStatus } }>("/imports/upload", { method: "POST", body: form });
      setTravelMessage(job.status === ImportStatus.FAILED ? "The import could not queue. Retry it from history." : "Import queued. The caches will appear in Travel when processing finishes.");
      formElement.reset();
      window.dispatchEvent(new CustomEvent("geostats:imports-updated"));
      await refresh();
    } catch (error) {
      setTravelMessage(error instanceof Error ? error.message : "Cache list upload failed");
    }
  }

  async function submitOwnerLogsCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setCsvMessage("Importing owner logs...");
    try {
      const result = await apiFetch<{ added: number; changedCaches: number }>("/collector/received-logs/csv", {
        method: "POST",
        body: form
      });
      setCsvMessage(`Imported ${result.added} owner logs across ${result.changedCaches} hides.`);
      formElement.reset();
    } catch (error) {
      setCsvMessage(error instanceof Error ? error.message : "Owner log CSV import failed");
    }
  }

  async function downloadGsakConnector() {
    setGsakBusy(true);
    setGsakMessage(null);
    try {
      const data = await apiFetch<{ fileName: string; macro: string }>("/collector/gsak/setup", { method: "POST" });
      const url = URL.createObjectURL(new Blob([data.macro], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setGsakStatus({ connected: true, lastImportedAt: null });
      setGsakMessage("Connector downloaded. Open GeostatsImport.gsk and let GSAK install it, then run the macro from GSAK.");
    } catch (error) {
      setGsakMessage(error instanceof Error ? error.message : "Could not prepare the GSAK connector");
    } finally {
      setGsakBusy(false);
    }
  }

  async function downloadAdminGsakConnector() {
    setAdminGsakBusy(true);
    setAdminGsakMessage(null);
    try {
      const data = await apiFetch<{ fileName: string; macro: string }>("/collector/gsak/admin-setup", { method: "POST" });
      const url = URL.createObjectURL(new Blob([data.macro], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setAdminGsakMessage("Admin connector downloaded. Install GeostatsMissingCaches.gsk in GSAK and run it whenever caches are missing across the instance.");
    } catch (error) {
      setAdminGsakMessage(error instanceof Error ? error.message : "Could not prepare the admin GSAK connector");
    } finally {
      setAdminGsakBusy(false);
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Import pipeline</p>
          <h1>Upload cache data</h1>
        </div>
      </header>
      <section className="upload-zone upload-purpose-zone" id="travel-cache-import">
        <Route size={42} />
        <div className="upload-zone-copy">
          <h2>Cache lists for Travel</h2>
          <p className="muted">Upload a Geocaching or GSAK cache GPX or ZIP. This also fills in cache coordinates needed by a trackable journey.</p>
        </div>
        <form onSubmit={submitTravelCaches} className="form">
          <label>
            Pocket Query file
            <input name="file" type="file" accept=".gpx,.zip,application/gpx+xml,application/zip" required />
          </label>
          <button className="primary-button" type="submit">Import cache list</button>
        </form>
        {travelMessage ? <p className="muted" role="status">{travelMessage}</p> : null}
      </section>
      <section className="upload-zone">
        <UploadCloud size={42} />
        <div className="upload-zone-copy">
          <h2>Your finds and hides</h2>
          <p className="muted">Upload a My Finds GPX, My Hides GPX, or an existing ZIP import.</p>
        </div>
        <form onSubmit={submit} className="form">
          <label>
            GPX or ZIP file
            <input name="file" type="file" accept=".gpx,.zip,application/gpx+xml,application/zip" required onChange={(event) => {
              const name = event.target.files?.[0]?.name ?? "";
              if (/my[ _-]hides/i.test(name)) setMode("hides");
              else if (/my[ _-]finds/i.test(name)) setMode("finds");
              else setMode("");
            }} />
          </label>
          <label>
            What does the file contain?
            <select name="purpose" value={mode} required onChange={(event) => setMode(event.target.value)}>
              <option value="">Choose an import type</option>
              {CACHE_IMPORT_MODES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button className="primary-button" type="submit">
            Queue import
          </button>
        </form>
        {message ? <p className="muted">{message}</p> : null}
      </section>
      <section className="upload-zone">
        <Database size={42} />
        <div className="form">
          <div>
            <h2>Import from GSAK</h2>
          <p className="muted">
            Optional. Install the connector once. Each run refreshes found and
            owned cache data in GSAK before sending it to Geostats, and loads
            cache codes that are missing from your trackable journeys. If GSAK
            cannot fetch a cache, export it as GPX or ZIP and upload that file
            above.
          </p>
          </div>
          <button className="secondary-button" type="button" disabled={gsakBusy} onClick={() => void downloadGsakConnector()}>
            <Download size={18} />
            {gsakBusy ? "Preparing connector…" : gsakStatus?.connected ? "Download a new connector" : "Set up GSAK import"}
          </button>
          {gsakStatus?.lastImportedAt ? (
            <p className="muted">Last GSAK import: {new Date(gsakStatus.lastImportedAt).toLocaleString("sv-SE")}</p>
          ) : null}
          {gsakMessage ? <p className="muted">{gsakMessage}</p> : null}
        </div>
      </section>
      {isAdmin ? (
        <section className="upload-zone">
          <Shield size={42} />
          <div className="form">
            <div>
              <h2>Admin: Missing caches GSAK script</h2>
              <p className="muted">
                Download the admin-only GSAK macro (<code>GeostatsMissingCaches.gsk</code>). Running it in GSAK automatically fetches any unresolved GC codes across all users and imports their shared cache metadata without touching personal finds or logs.
              </p>
            </div>
            <div className="logbook-header-actions" style={{ justifyContent: "center" }}>
              <button className="primary-button" type="button" disabled={adminGsakBusy} onClick={() => void downloadAdminGsakConnector()}>
                <Download size={18} />
                {adminGsakBusy ? "Preparing admin script…" : "Download admin GSAK script"}
              </button>
              <Link className="secondary-button" href="/admin">
                Open Admin console
              </Link>
            </div>
            {adminGsakMessage ? <p className="muted" role="status">{adminGsakMessage}</p> : null}
          </div>
        </section>
      ) : null}
      <section className="upload-zone">
        <FileUp size={42} />
        <form onSubmit={submitOwnerLogsCsv} className="form">
          <label>
            Owner log CSV
            <input name="file" type="file" accept=".csv,text/csv" required />
          </label>
          <button className="primary-button" type="submit">
            Import owner logs
          </button>
        </form>
        <p className="muted">Use the CSV command from Profile. Existing My Hides data must be imported first so the logs can be attached to those hides.</p>
        {csvMessage ? <p className="muted">{csvMessage}</p> : null}
      </section>
      <section className="panel">
        <h2>Latest imports</h2>
        <Link href="/imports">View import history</Link>
        <div className="table-list">
          {imports.map((item) => (
            <div key={item.id} className="table-row">
              <span>{item.fileName}{item.status === ImportStatus.COMPLETED && item.receipt ? <small>{formatImportReceipt(item.receipt)}</small> : null}</span>
              <strong>{item.status}</strong>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
