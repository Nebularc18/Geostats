import { ImportSource, ImportStatus } from "@geostats/shared";

export type ImportListItem = {
  id: string;
  fileName: string;
  source: ImportSource;
  status: ImportStatus;
  createdAt: string;
  errorMessage: string | null;
};

export type ImportsResponse = {
  imports: ImportListItem[];
};

const ACTIVE_IMPORT_STATUSES = new Set<ImportStatus>([
  ImportStatus.UPLOADED,
  ImportStatus.QUEUED,
  ImportStatus.PROCESSING
]);

export function hasActiveImports(imports: Pick<ImportListItem, "status">[]) {
  return imports.some((item) => ACTIVE_IMPORT_STATUSES.has(item.status));
}
