"use client";

import { FormEvent, useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";

export default function UploadPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [imports, setImports] = useState<any[]>([]);

  async function refresh() {
    const data = await apiFetch<{ imports: any[] }>("/imports");
    setImports(data.imports);
  }

  useEffect(() => {
    void refresh();
  }, []);

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

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Import pipeline</p>
        <h1>Upload GPX data</h1>
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
