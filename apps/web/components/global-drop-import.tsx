"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UploadCloud, X } from "lucide-react";
import { apiFetch, invalidateStatsSummaryCache } from "../lib/api";
import { Modal } from "./ui/modal";

function detectPurpose(fileName: string): "finds" | "hides" | "travel" {
  const lower = fileName.toLowerCase();
  if (/my[ _-]?hides/.test(lower)) return "hides";
  if (/my[ _-]?finds/.test(lower)) return "finds";
  return "travel";
}

function purposeLabel(purpose: "finds" | "hides" | "travel") {
  if (purpose === "finds") return "My Finds";
  if (purpose === "hides") return "My Hides";
  return "Cache list (Travel)";
}

type UploadImportResponse = {
  status?: string;
  errorMessage?: string | null;
  import?: {
    status?: string;
    errorMessage?: string | null;
  };
};

export function GlobalDropImport({ onOpen }: { onOpen?: () => void } = {}) {
  const [dragging, setDragging] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState<"finds" | "hides" | "travel">("finds");
  const [uploading, setUploading] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; isError?: boolean } | null>(null);
  const dragDepthRef = useRef(0);
  const uploadingRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    uploadingRef.current = uploading;
    if (uploading && pendingFile) {
      dialogRef.current?.focus();
    }
  }, [uploading, pendingFile]);

  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const isLocalDrop = (event: DragEvent) => event.defaultPrevented ||
      (event.target instanceof Element && Boolean(event.target.closest('input[type="file"]')));

    const resetDrag = () => {
      dragDepthRef.current = 0;
      setDragging(false);
    };

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event) || uploadingRef.current) return;
      if (isLocalDrop(event)) { resetDrag(); return; }
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      if (isLocalDrop(event)) { resetDrag(); return; }
      event.preventDefault();
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      if (isLocalDrop(event)) { resetDrag(); return; }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDragging(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      resetDrag();
      if (isLocalDrop(event)) return;
      event.preventDefault();
      if (uploadingRef.current) {
        setToast({ text: "Wait for the current upload to finish before dropping another file.", isError: true });
        return;
      }
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) =>
        /\.(gpx|zip)$/i.test(candidate.name)
      );
      if (!file) {
        setToast({ text: "Drop a .gpx or .zip file to import into Geostats.", isError: true });
        return;
      }
      onOpenRef.current?.();
      setDialogError(null);
      setPendingFile(file);
      setPurpose(detectPurpose(file.name));
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    if (pendingFile) selectRef.current?.focus();
  }, [pendingFile]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function confirmUpload() {
    const fileToUpload = pendingFile;
    if (!fileToUpload || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setDialogError(null);
    try {
      const form = new FormData();
      form.append("file", fileToUpload);
      form.append("purpose", purpose);
      const response = await apiFetch<UploadImportResponse>("/imports/upload", { method: "POST", body: form });
      const status = (response?.import?.status ?? response?.status ?? "").toUpperCase();
      const errorMessage = response?.import?.errorMessage ?? response?.errorMessage;
      if (status === "FAILED") {
        const msg = errorMessage || `Import failed for ${fileToUpload.name}.`;
        setDialogError(msg);
        setToast({ text: msg, isError: true });
        return;
      }
      invalidateStatsSummaryCache();
      window.dispatchEvent(new CustomEvent("geostats:imports-updated"));
      setToast({
        text:
          status === "COMPLETED"
            ? `Imported ${fileToUpload.name} as ${purposeLabel(purpose)}.`
            : `Queued ${fileToUpload.name} as ${purposeLabel(purpose)}.`
      });
      setPendingFile(null);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Could not upload dropped file.";
      setDialogError(msg);
      setToast({ text: msg, isError: true });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  return (
    <>
      {dragging ? (
        <div className="ds-drop-overlay" aria-hidden="true">
          <div className="ds-drop-box">
            <UploadCloud size={44} />
            <strong>Drop GPX or Pocket Query ZIP to import</strong>
            <span>Auto-detects My Finds, My Hides, or Travel cache lists</span>
          </div>
        </div>
      ) : null}

      {pendingFile ? (
        <Modal
          className="ds-cmdk-backdrop"
          label="Quick GPX / ZIP Import"
          onClose={() => { if (!uploadingRef.current) setPendingFile(null); }}
        >
          <div ref={dialogRef} tabIndex={-1} className="ds-cmdk-dialog ds-drop-dialog">
            <div className="ds-drop-dialog-header">
              <h2>Quick GPX / ZIP Import</h2>
              <button type="button" className="row-delete" disabled={uploading} onClick={() => setPendingFile(null)} aria-label="Cancel">
                <X size={16} />
              </button>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              File: <strong>{pendingFile.name}</strong> ({(pendingFile.size / 1024).toFixed(0)} KB)
            </p>
            {dialogError ? <p className="error" role="alert" style={{ margin: 0 }}>{dialogError}</p> : null}
            <label>
              <span>Import as</span>
              <select
                ref={selectRef}
                value={purpose}
                disabled={uploading}
                onChange={(event) => setPurpose(event.target.value as "finds" | "hides" | "travel")}
              >
                <option value="finds">My Finds</option>
                <option value="hides">My Hides</option>
                <option value="travel">Cache list (Travel & Unfound Map)</option>
              </select>
            </label>
            <div className="logbook-header-actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="secondary-button" disabled={uploading} onClick={() => setPendingFile(null)}>
                Cancel
              </button>
              <button type="button" className="primary-button" disabled={uploading} onClick={() => void confirmUpload()}>
                <UploadCloud size={16} /> {uploading ? "Uploading…" : "Queue import"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {toast ? (
        <div className={`ds-drop-toast${toast.isError ? " error" : ""}`} role={toast.isError ? "alert" : "status"}>
          <span>{toast.text}</span>
          {!toast.isError ? <Link href="/imports">View imports →</Link> : null}
          <button type="button" className="row-delete" aria-label="Dismiss" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      ) : null}
    </>
  );
}
