"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";

export default function ImportsPage() {
  const [imports, setImports] = useState<any[]>([]);

  useEffect(() => {
    void apiFetch<{ imports: any[] }>("/imports").then((data) => setImports(data.imports));
  }, []);

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Background jobs</p>
        <h1>Import history</h1>
      </header>
      <section className="panel">
        <div className="table-list">
          {imports.map((item) => (
            <div key={item.id} className="table-row import-row">
              <span>
                <strong>{item.fileName}</strong>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                {item.errorMessage ? <small className="error">{item.errorMessage}</small> : null}
              </span>
              <span>{item.source}</span>
              <strong>{item.status}</strong>
            </div>
          ))}
          {imports.length === 0 ? <p className="muted">No import history yet.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}
