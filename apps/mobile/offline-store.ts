import { File, Paths } from "expo-file-system";

export type OfflineFieldNote = {
  id: string;
  gcCode: string;
  note: string;
  createdAt: string;
};

function fieldNotesFile(userId: string, suffix = "") {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "local";
  return new File(Paths.document, `geostats-offline-field-notes-${safeId}.json${suffix}`);
}

export async function loadOfflineFieldNotes(userId: string): Promise<OfflineFieldNote[]> {
  const current = fieldNotesFile(userId);
  const file = current.exists ? current : fieldNotesFile(userId, ".previous");
  if (!file.exists) return [];
  const parsed = JSON.parse(await file.text());
  if (!Array.isArray(parsed)) throw new Error("Invalid field notes file");
  return parsed;
}

export async function saveOfflineFieldNotes(userId: string, notes: OfflineFieldNote[]): Promise<void> {
  const current = fieldNotesFile(userId);
  const previous = fieldNotesFile(userId, ".previous");
  const staged = fieldNotesFile(userId, ".pending");
  staged.write(JSON.stringify(notes));
  const currentName = current.name;

  // Keep a readable copy even if the app stops between the two renames.
  if (current.exists) {
    if (previous.exists) previous.delete();
    current.rename(previous.name);
  }
  staged.rename(currentName);

  // After commit, cleanup can't make the save fail.
  try {
    if (previous.exists) previous.delete();
  } catch {
    // A later write can retry cleanup while the current file is intact.
  }
}
