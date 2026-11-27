"use client";

import { formatImportReceipt, ImportStatus } from "@geostats/shared";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { GsakImportPanel } from "../../components/gsak-import-panel";
import { apiFetch } from "../../lib/api";
import {
  hasActiveImports,
  type ImportListItem,
  type ImportsResponse,
} from "../../lib/imports";

const sourceLabels: Record<string, string> = {
  MY_FINDS_GPX: "My Finds GPX",
  MY_HIDES_GPX: "My Hides GPX",
  POCKET_QUERY: "Pocket Query",
  MANUAL_GPX: "Manual GPX",
  GEOCACHING_API: "Geocaching JSON",
  GSAK: "GSAK",
  GEOSTATS_EXPORT: "Geostats transfer",
};

export default function ImportsPage() {
  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<ImportsResponse>("/imports");
      setImports(data.imports);
      setError("");
      return data.imports;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load import history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasActiveImports(imports)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [imports, refresh]);

  async function retry(id: string) {
    if (retrying) return;
    setRetrying(id);
    try {
      await apiFetch(`/imports/${encodeURIComponent(id)}/retry`, { method: "POST" });
      window.dispatchEvent(new CustomEvent("geostats:imports-updated"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry the import.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Background jobs</p>
          <h1>Import history</h1>
        </div>
      </header>
      <GsakImportPanel onImportActivity={refresh} />
      <section className="panel">
        {error ? <p className="error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Reload</button></p> : null}
        {loading ? <p role="status">Loading import history…</p> : null}
        <div className="table-list">
          {imports.map((item) => (
            <div key={item.id} className="table-row import-row">
              <span>
                <strong>{item.fileName}</strong>
                <small>
                  {new Date(item.createdAt).toLocaleString("sv-SE")}
                </small>
                {item.status === ImportStatus.COMPLETED && item.receipt ? <small>{formatImportReceipt(item.receipt)}</small> : null}
                {item.errorMessage ? (
                  <small className="error">{item.errorMessage}</small>
                ) : null}
              </span>
              <span>{sourceLabels[item.source] ?? item.source}</span>
              <div>
                <strong>{item.status}</strong>
                {item.retryable ? <button className="secondary-button" type="button" disabled={retrying !== null} onClick={() => void retry(item.id)}>
                  {retrying === item.id ? "Retrying…" : "Retry"}
                </button> : null}
              </div>
            </div>
          ))}
          {!loading && !error && imports.length === 0 ? (
            <p className="muted">No import history yet.</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
