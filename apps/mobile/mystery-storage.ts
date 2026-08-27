import type { File } from "expo-file-system";

export const MAX_MYSTERY_SNAPSHOT_BYTES = 256 * 1024;

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
