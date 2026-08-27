"use client";

import { useEffect, useState } from "react";
import { Database, Download } from "lucide-react";
import { apiFetch } from "../lib/api";

export function GsakImportPanel() {
  const [status, setStatus] = useState<{
    connected: boolean;
    lastImportedAt: string | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void apiFetch<{ connected: boolean; lastImportedAt: string | null }>(
      "/collector/gsak/status",
    ).then(setStatus);
  }, []);

  async function downloadConnector() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ fileName: string; macro: string }>(
        "/collector/gsak/setup",
        { method: "POST" },
      );
      const url = URL.createObjectURL(
        new Blob([data.macro], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus({ connected: true, lastImportedAt: null });
      setMessage(
        "Connector downloaded. Open GeostatsImport.gsk and let GSAK install it, then run the macro from GSAK.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare the GSAK connector",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="upload-zone">
      <Database size={42} />
      <div className="form">
        <div>
          <h2>Import from GSAK</h2>
          <p className="muted">
            Optional. Install the connector once, then send the current GSAK
            database to Geostats directly from GSAK. GPX and ZIP imports
            continue to work without it.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void downloadConnector()}
        >
          <Download size={18} />
          {busy
            ? "Preparing connector…"
            : status?.connected
              ? "Download a new connector"
              : "Set up GSAK import"}
        </button>
        {status?.lastImportedAt ? (
          <p className="muted">
            Last GSAK import:{" "}
            {new Date(status.lastImportedAt).toLocaleString("sv-SE")}
          </p>
        ) : null}
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </section>
  );
}
