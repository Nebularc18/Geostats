import type { File } from "expo-file-system";

export const MAX_MYSTERY_SNAPSHOT_BYTES = 256 * 1024;

export function safeRecipientMysteryImage(value: unknown) {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)
    ? value
    : undefined;
}

function identityFingerprint(value: string) {
  const hashes = [2166136261, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    hashes[0] = Math.imul(hashes[0] ^ codePoint, 16777619);
    hashes[1] = Math.imul(hashes[1] ^ codePoint, 2246822519);
    hashes[2] = Math.imul(hashes[2] ^ codePoint, 3266489917);
    hashes[3] = Math.imul(hashes[3] ^ codePoint, 668265263);
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, "0")).join("");
}

export function mysteryStorageNamespace(apiBaseUrl: string, userId: string) {
  const origin = new URL(apiBaseUrl).origin.toLowerCase();
  const identity = userId.trim();
  if (!identity) throw new Error("A user ID is required for mystery storage");
  const host = new URL(origin).hostname.replace(/[^a-z0-9.-]/gi, "_").slice(0, 48) || "server";
  const user = identity.replace(/[^a-z0-9_-]/gi, "_").slice(0, 32) || "user";
  return `${host}-${user}-${identityFingerprint(`${origin}\0${identity}`)}`;
}

function utf8ByteLength(value: string) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

export function mysterySnapshotByteLength(value: unknown) {
  return utf8ByteLength(JSON.stringify(value));
}

export function replaceJsonFile<T>(
  destination: File,
  temporary: File,
  backup: File,
  json: string,
  isValidEntry: (value: unknown) => value is T,
) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every(isValidEntry)) {
    throw new Error("Mystery storage contains invalid data");
  }

  temporary.write(json);
  if (destination.exists) {
    try {
      const current = JSON.parse(destination.textSync());
      if (Array.isArray(current) && current.every(isValidEntry)) {
        destination.copySync(backup, { overwrite: true });
      }
    } catch {
      // Keep the existing last-known-good backup when the primary is corrupt.
    }
  }

  try {
    temporary.moveSync(destination, { overwrite: true });
  } catch (error) {
    if (backup.exists) {
      backup.copySync(destination, { overwrite: true });
    }
    throw error;
  }
}

async function readJsonArray<T>(file: File, isValidEntry: (value: unknown) => value is T) {
  const json = await file.text();
  const value = JSON.parse(json);
  if (!Array.isArray(value) || !value.every(isValidEntry)) {
    throw new Error("Mystery storage contains invalid data");
  }
  return value as T[];
}

export async function readJsonArrayWithRecovery<T = unknown>(
  primary: File,
  backup: File,
  corruptFile: () => File,
  isValidEntry: (value: unknown) => value is T,
  warn: (message: string, error: unknown) => void,
) {
  try {
    return await readJsonArray(primary, isValidEntry);
  } catch (error) {
    warn("Mystery storage is corrupt; preserving it before recovery", error);
    if (primary.exists) {
      try {
        const corrupt = corruptFile();
        corrupt.write(await primary.text().catch(() => ""));
      } catch (backupError) {
        warn("Could not preserve corrupt mystery storage", backupError);
      }
    }

    if (backup.exists) {
      try {
        const recovered = await readJsonArray(backup, isValidEntry);
        warn("Recovered mysteries from the last known-good backup", error);
        return recovered;
      } catch (backupError) {
        warn("The mystery backup is also corrupt", backupError);
      }
    }
    return [];
  }
}
