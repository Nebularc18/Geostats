export enum ImportSource {
  MY_FINDS_GPX = "MY_FINDS_GPX",
  MY_HIDES_GPX = "MY_HIDES_GPX",
  POCKET_QUERY = "POCKET_QUERY",
  MANUAL_GPX = "MANUAL_GPX",
  GEOCACHING_API = "GEOCACHING_API"
}

export enum ImportStatus {
  UPLOADED = "UPLOADED",
  QUEUED = "QUEUED",
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED"
}

export enum ImportFileType {
  GPX = "GPX",
  ZIP = "ZIP"
}

export const IMPORT_QUEUE_NAME = "imports";

export interface ImportJobPayload {
  importId: string;
  userId: string;
  objectKey: string;
  source: ImportSource;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

export interface CacheMapPoint {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  latitude: number;
  longitude: number;
  foundAt: string;
}
