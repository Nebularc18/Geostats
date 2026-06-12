"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { FileUp, UploadCloud } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { hasActiveImports, type ImportListItem, type ImportsResponse } from "../../lib/imports";

export default function UploadPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [csvMessage, setCsvMessage] = useState<string | null>(null);
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("Uploading...");
    try {
      await apiFetch("/imports/upload", { method: "POST", body: form });
      setMessage("Import queued.");
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
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

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Import pipeline</p>
        <h1>Upload cache data</h1>
      </header>
      <section className="upload-zone">
        <UploadCloud size={42} />
        <form onSubmit={submit} className="form">
          <input name="file" type="file" accept=".gpx,.zip,application/gpx+xml,application/zip" required />
          <button className="primary-button" type="submit">
            Queue import
          </button>
        </form>
        {message ? <p className="muted">{message}</p> : null}
      </section>
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
        <div className="table-list">
          {imports.map((item) => (
            <div key={item.id} className="table-row">
              <span>{item.fileName}</span>
              <strong>{item.status}</strong>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
