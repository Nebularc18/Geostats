import assert from "node:assert/strict";
import test from "node:test";
import type { File } from "expo-file-system";
import {
  MAX_MYSTERY_SNAPSHOT_BYTES,
  mysterySnapshotByteLength,
  readJsonArrayWithRecovery,
  replaceJsonFile,
} from "./mystery-storage";

class MemoryFile {
  content: string | null;
  failMove = false;

  constructor(content: string | null = null) {
    this.content = content;
  }

  get exists() {
    return this.content !== null;
  }

  async text() {
    if (this.content === null) throw new Error("File does not exist");
    return this.content;
  }

  textSync() {
    if (this.content === null) throw new Error("File does not exist");
    return this.content;
  }

  write(content: string) {
    this.content = content;
  }

  copySync(destination: MemoryFile, options?: { overwrite?: boolean }) {
    if (this.content === null) throw new Error("File does not exist");
    if (destination.exists && !options?.overwrite) throw new Error("Destination exists");
    destination.content = this.content;
  }

  moveSync(destination: MemoryFile, options?: { overwrite?: boolean }) {
    if (this.failMove) throw new Error("Move failed");
    this.copySync(destination, options);
    this.content = null;
  }
}

function asFile(file: MemoryFile) {
  return file as unknown as File;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

test("replaceJsonFile replaces an existing file and retains its last known-good backup", () => {
  const primary = new MemoryFile('[{"version":1}]');
  const temporary = new MemoryFile();
  const backup = new MemoryFile();

  replaceJsonFile(asFile(primary), asFile(temporary), asFile(backup), '[{"version":2}]', isObject);

  assert.equal(primary.content, '[{"version":2}]');
  assert.equal(backup.content, '[{"version":1}]');
  assert.equal(temporary.exists, false);
});

test("replaceJsonFile restores the previous file when promotion fails", () => {
  const primary = new MemoryFile('[{"version":1}]');
  const temporary = new MemoryFile();
  const backup = new MemoryFile();
  temporary.failMove = true;

  assert.throws(
    () => replaceJsonFile(asFile(primary), asFile(temporary), asFile(backup), '[{"version":2}]', isObject),
    /Move failed/,
  );
  assert.equal(primary.content, '[{"version":1}]');
  assert.equal(backup.content, '[{"version":1}]');
});

test("readJsonArrayWithRecovery preserves a valid non-array file and uses the backup", async () => {
  const primary = new MemoryFile('{"unexpected":true}');
  const backup = new MemoryFile('[{"version":1}]');
  const corrupt = new MemoryFile();
  const warnings: string[] = [];

  const recovered = await readJsonArrayWithRecovery(
    asFile(primary),
    asFile(backup),
    () => asFile(corrupt),
    isObject,
    (message) => warnings.push(message),
  );

  assert.deepEqual(recovered, [{ version: 1 }]);
  assert.equal(corrupt.content, '{"unexpected":true}');
  assert.equal(warnings.length, 2);
});

test("readJsonArrayWithRecovery uses the backup when promotion left no primary file", async () => {
  const primary = new MemoryFile();
  const backup = new MemoryFile('[{"version":1}]');
  let createdCorruptFile = false;

  const recovered = await readJsonArrayWithRecovery(
    asFile(primary),
    asFile(backup),
    () => {
      createdCorruptFile = true;
      return asFile(new MemoryFile());
    },
    isObject,
    () => undefined,
  );

  assert.deepEqual(recovered, [{ version: 1 }]);
  assert.equal(createdCorruptFile, false);
});

test("readJsonArrayWithRecovery rejects malformed array entries", async () => {
  const primary = new MemoryFile("[null]");
  const backup = new MemoryFile('[{"version":1}]');

  const recovered = await readJsonArrayWithRecovery(
    asFile(primary),
    asFile(backup),
    () => asFile(new MemoryFile()),
    isObject,
    () => undefined,
  );

  assert.deepEqual(recovered, [{ version: 1 }]);
});

test("replaceJsonFile does not overwrite a good backup with a corrupt primary", () => {
  const primary = new MemoryFile("[null]");
  const temporary = new MemoryFile();
  const backup = new MemoryFile('[{"version":1}]');

  replaceJsonFile(asFile(primary), asFile(temporary), asFile(backup), '[{"version":1}]', isObject);

  assert.equal(primary.content, '[{"version":1}]');
  assert.equal(backup.content, '[{"version":1}]');
});

test("mysterySnapshotByteLength enforces the complete UTF-8 JSON boundary", () => {
  const emptySize = mysterySnapshotByteLength({ notes: "" });
  const exact = { notes: "a".repeat(MAX_MYSTERY_SNAPSHOT_BYTES - emptySize) };
  assert.equal(mysterySnapshotByteLength(exact), MAX_MYSTERY_SNAPSHOT_BYTES);
  assert.equal(
    mysterySnapshotByteLength({ notes: `${exact.notes}a` }),
    MAX_MYSTERY_SNAPSHOT_BYTES + 1,
  );
  assert.equal(mysterySnapshotByteLength({ notes: "å" }), mysterySnapshotByteLength({ notes: "a" }) + 1);
  assert.equal(
    mysterySnapshotByteLength({ notes: "a".repeat(30_000), image: "x".repeat(240_000) }) > MAX_MYSTERY_SNAPSHOT_BYTES,
    true,
  );
});
