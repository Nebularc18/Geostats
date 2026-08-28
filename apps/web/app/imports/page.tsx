"use client";

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
  GEOCACHING_API: "Geocaching API",
  GSAK: "GSAK",
  GEOSTATS_EXPORT: "Geostats transfer",
};

export default function ImportsPage() {
  const [imports, setImports] = useState<ImportListItem[]>([]);

  const refresh = useCallback(async () => {
    const data = await apiFetch<ImportsResponse>("/imports");
    setImports(data.imports);
    return data.imports;
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

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Background jobs</p>
        <h1>Import history</h1>
      </header>
      <GsakImportPanel onImportActivity={refresh} />
      <section className="panel">
        <div className="table-list">
          {imports.map((item) => (
            <div key={item.id} className="table-row import-row">
              <span>
                <strong>{item.fileName}</strong>
                <small>
                  {new Date(item.createdAt).toLocaleString("sv-SE")}
                </small>
                {item.errorMessage ? (
                  <small className="error">{item.errorMessage}</small>
                ) : null}
              </span>
              <span>{sourceLabels[item.source] ?? item.source}</span>
              <strong>{item.status}</strong>
            </div>
          ))}
          {imports.length === 0 ? (
            <p className="muted">No import history yet.</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
