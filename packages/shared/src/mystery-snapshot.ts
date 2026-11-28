function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function optionalText(value: unknown) {
  return value == null || typeof value === "string";
}

function optionalCoordinate(value: unknown) {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

const ATTEMPT_TEXT_FIELDS = ["kind", "state", "answer", "note", "source", "createdAt", "updatedAt", "geocachingSyncedAt"];
const ATTEMPT_COORDINATE_FIELDS = ["latitude", "longitude", "finalLatitude", "finalLongitude"];
const SNAPSHOT_TEXT_FIELDS = [
  "area", "county", "country", "region", "locality", "status", "statusUpdatedAt", "trip", "tripUpdatedAt",
  "addedAt", "notes", "fieldNotes", "image", "listingText", "listingTextUpdatedAt",
  "geocachingFieldNotesFingerprint", "geocachingFieldNotesSyncedAt"
];
const SNAPSHOT_TEXT_LIST_FIELDS = ["clues", "listingImageUrls", "locationHierarchy"];

export function isSafeMysteryAttempt(value: unknown): boolean {
  const attempt = record(value);
  return Boolean(attempt
    && typeof attempt.id === "string" && attempt.id
    && ATTEMPT_TEXT_FIELDS.every((field) => optionalText(attempt[field]))
    && ATTEMPT_COORDINATE_FIELDS.every((field) => optionalCoordinate(attempt[field])));
}

// Device-only fields and grant metadata must still be supplied by each caller.
// Older snapshots may omit lists; clients initialize those lists before rendering.
export function isSafeMysterySnapshot(value: unknown): boolean {
  const snapshot = record(value);
  if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id
    || typeof snapshot.name !== "string" || !snapshot.name.trim()
    || typeof snapshot.gcCode !== "string" || !/^GC[A-Z0-9]+$/i.test(snapshot.gcCode.trim())) return false;

  return SNAPSHOT_TEXT_FIELDS.every((field) => optionalText(snapshot[field]))
    && SNAPSHOT_TEXT_LIST_FIELDS.every((field) => {
      const items = snapshot[field];
      return items == null || (Array.isArray(items) && items.every((item) => typeof item === "string"));
    })
    && optionalCoordinate(snapshot.publishedLatitude)
    && optionalCoordinate(snapshot.publishedLongitude)
    && (snapshot.attempts === undefined || (Array.isArray(snapshot.attempts) && snapshot.attempts.every(isSafeMysteryAttempt)));
}
