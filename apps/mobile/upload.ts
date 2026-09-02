export type UploadKind = "cache" | "csv" | "trackable";

type UploadAsset = {
  name: string;
  uri: string;
  mimeType?: string;
};

type PickResult =
  | { canceled: true; assets?: null }
  | { canceled: false; assets: UploadAsset[] };

type UploadDependencies = {
  pick: (options: { type: string[]; copyToCacheDirectory: true }) => Promise<PickResult>;
  createFile: (uri: string) => Blob;
  request: (path: string, body: FormData) => Promise<unknown>;
  refresh: () => Promise<unknown>;
  onMessage: (message: string) => void;
};

const uploadSpecs: Record<UploadKind, { types: string[]; path: string; uploading: string; complete: string }> = {
  cache: {
    types: ["application/gpx+xml", "application/zip", "text/xml", "*/*"],
    path: "/imports/upload",
    uploading: "Uploading import...",
    complete: "Import queued."
  },
  csv: {
    types: ["text/csv", "text/plain", "*/*"],
    path: "/collector/received-logs/csv",
    uploading: "Uploading owner logs...",
    complete: "Owner logs imported."
  },
  trackable: {
    types: ["application/gpx+xml", "application/zip", "text/csv", "application/json", "application/vnd.google-earth.kml+xml", "text/xml", "*/*"],
    path: "/trackables/import",
    uploading: "Uploading trackable history...",
    complete: "Trackable history imported."
  }
};

const acceptedCsvMimeTypes = new Set(["text/csv", "application/csv", "text/plain"]);

function trackableImportMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const summary = (response as { import?: { unresolvedCaches?: unknown; estimatedLogs?: unknown; inferredTrackables?: unknown } }).import;
  if (!summary || typeof summary !== "object") return null;
  const missing = Array.isArray(summary.unresolvedCaches) ? summary.unresolvedCaches.filter((code): code is string => typeof code === "string") : [];
  if (missing.length > 0) {
    const preview = missing.slice(0, 5).join(", ");
    return `Trackable history imported, but ${missing.length} cache location${missing.length === 1 ? " is" : "s are"} missing. Export those caches from GSAK as GPX/ZIP and import them, then retry this journey.${preview ? ` Missing: ${preview}${missing.length > 5 ? "…" : ""}` : ""}`;
  }
  if (typeof summary.estimatedLogs === "number" && summary.estimatedLogs > 0) {
    return "Trackable history imported. Dates were not supplied, so the file order was used.";
  }
  if (typeof summary.inferredTrackables === "number" && summary.inferredTrackables > 0) {
    return "Trackable history imported. The export had no TB code, so a temporary KML identifier was generated.";
  }
  return null;
}

function fileForUpload(kind: UploadKind, asset: UploadAsset, file: Blob) {
  if (kind !== "csv") return file;

  const pickerMimeType = asset.mimeType?.toLowerCase();
  const mimeType = pickerMimeType && acceptedCsvMimeTypes.has(pickerMimeType) ? pickerMimeType : "text/csv";
  return file.type === mimeType ? file : file.slice(0, file.size, mimeType);
}

export async function pickAndUploadDocument(kind: UploadKind, dependencies: UploadDependencies) {
  const spec = uploadSpecs[kind];
  try {
    const result = await dependencies.pick({ type: spec.types, copyToCacheDirectory: true });
    if (result.canceled) return "canceled" as const;

    const asset = result.assets[0];
    if (!asset) throw new Error("The selected file could not be opened");

    const form = new FormData();
    form.append("file", fileForUpload(kind, asset, dependencies.createFile(asset.uri)), asset.name);
    dependencies.onMessage(spec.uploading);
    const response = await dependencies.request(spec.path, form);
    dependencies.onMessage(kind === "trackable" ? trackableImportMessage(response) ?? spec.complete : spec.complete);
    await dependencies.refresh();
    return "uploaded" as const;
  } catch (error) {
    dependencies.onMessage(error instanceof Error ? error.message : "Upload failed");
    return "failed" as const;
  }
}
