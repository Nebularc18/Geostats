import { File, Paths } from "expo-file-system";

export type OfflineFieldNote = {
  id: string;
  gcCode: string;
  note: string;
  createdAt: string;
};

function fieldNotesFile(userId: string) {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "local";
  return new File(Paths.document, `geostats-offline-field-notes-${safeId}.json`);
}

export async function loadOfflineFieldNotes(userId: string): Promise<OfflineFieldNote[]> {
  try {
    const file = fieldNotesFile(userId);
    if (!file.exists) return [];
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveOfflineFieldNotes(userId: string, notes: OfflineFieldNote[]): Promise<void> {
  try {
    const file = fieldNotesFile(userId);
    file.write(JSON.stringify(notes));
  } catch {
    // Ignore local persistence failure when storage is unavailable
  }
}
