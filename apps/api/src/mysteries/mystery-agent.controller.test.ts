import assert from "node:assert/strict";
import test from "node:test";
import { MysteryAgentController } from "./mystery-agent.controller";

test("agent records a planned approach atomically and exposes it as not tried", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 4,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", attempts: [] }
  };
  let updateInput: any;
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => {
        updateInput = input;
        return { clientId: original.clientId, data: input.data.data, snapshotRevision: 5 };
      }
    }
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) };
  const auth = { userId: async () => "user-1" };
  const controller = new MysteryAgentController(prisma as any, auth as any);

  const result = await controller.addAttempt("Bearer secret", "gc12345", {
    kind: "approach",
    answer: "Try ROT13 on the title",
    state: "planned",
    source: "test-agent"
  });

  assert.equal(result.created, true);
  assert.equal(result.revision, 5);
  assert.equal(result.notTried.length, 1);
  assert.equal(result.notTried[0].answer, "Try ROT13 on the title");
  assert.deepEqual(updateInput.data.snapshotRevision, { increment: 1 });
});

test("agent updates the matching approach instead of duplicating it", async () => {
  const existingAttempt = {
    id: "agent-existing",
    kind: "approach",
    answer: "Try ROT13 on the title",
    state: "planned",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 5,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", attempts: [existingAttempt] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 6 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.addAttempt("Bearer secret", "GC12345", {
    kind: "approach",
    answer: "try rot13 on the title",
    state: "wrong",
    note: "Decoded to nonsense"
  });

  assert.equal(result.created, false);
  assert.equal(result.mystery.attempts.length, 1);
  assert.equal(result.tried[0].id, existingAttempt.id);
  assert.equal(result.tried[0].state, "wrong");
  assert.equal(result.notTried.length, 0);
});

test("agent downgrades solved status when the only solving attempt no longer works", async () => {
  const solvingAttempt = {
    id: "agent-solution",
    kind: "coordinate",
    latitude: 59.40582,
    longitude: 18.3612,
    state: "correct",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 6,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solved", attempts: [solvingAttempt] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 7 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.addAttempt("Bearer secret", "GC12345", {
    kind: "coordinate",
    latitude: 59.40582,
    longitude: 18.3612,
    state: "wrong"
  });

  assert.equal(result.created, false);
  assert.equal(result.mystery.status, "solving");
  assert.equal(result.mystery.attempts[0].state, "wrong");
});

test("agent keeps solved status when another valid solution remains", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 7,
    data: {
      id: "local-1",
      gcCode: "GC12345",
      name: "Cipher",
      status: "solved",
      attempts: [
        { id: "first", kind: "coordinate", latitude: 59.4, longitude: 18.3, state: "correct", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "second", kind: "keyword", answer: "answer", finalLatitude: 59.5, finalLongitude: 18.4, state: "correct", createdAt: "2026-01-02T00:00:00.000Z" }
      ]
    }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 8 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.addAttempt("Bearer secret", "GC12345", {
    kind: "coordinate",
    latitude: 59.4,
    longitude: 18.3,
    state: "planned"
  });

  assert.equal(result.mystery.status, "solved");
});

test("agent preserves manually solved status when an unrelated attempt is added", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 8,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solved", attempts: [] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 9 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.addAttempt("Bearer secret", "GC12345", {
    kind: "approach",
    answer: "Try reading every third word",
    state: "planned"
  });

  assert.equal(result.mystery.status, "solved");
  assert.equal(result.notTried.length, 1);
});

test("agent deletes an attempt by id and increments the revision", async () => {
  const first = {
    id: "agent-first",
    kind: "coordinate",
    latitude: 59.4,
    longitude: 18.3,
    state: "wrong",
    source: "my-ai-job",
    createdAt: "2026-09-16T20:00:00.000Z"
  };
  const second = {
    id: "agent-second",
    kind: "keyword",
    answer: "BLUEBIRD",
    state: "wrong",
    createdAt: "2026-09-16T20:36:00.000Z"
  };
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 9,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", attempts: [first, second] }
  };
  let updateInput: any;
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => {
        updateInput = input;
        return { clientId: original.clientId, data: input.data.data, snapshotRevision: 10 };
      }
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.deleteAttempt("Bearer secret", "GC12345", "agent-first");

  assert.equal(result.ok, true);
  assert.equal(result.deleted.id, "agent-first");
  assert.equal(result.mystery.attempts.length, 1);
  assert.equal(result.mystery.attempts[0].id, "agent-second");
  assert.deepEqual(updateInput.data.snapshotRevision, { increment: 1 });
  assert.equal(result.revision, 10);
});

test("agent delete downgrades solved status when the only solution is removed", async () => {
  const solvingAttempt = {
    id: "agent-solution",
    kind: "coordinate",
    latitude: 59.40582,
    longitude: 18.3612,
    state: "correct",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 10,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solved", attempts: [solvingAttempt] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 11 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.deleteAttempt("Bearer secret", "GC12345", "agent-solution");

  assert.equal(result.mystery.status, "solving");
  assert.equal(result.mystery.attempts.length, 0);
});

test("agent delete keeps solved status while another solution remains", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 11,
    data: {
      id: "local-1",
      gcCode: "GC12345",
      name: "Cipher",
      status: "solved",
      attempts: [
        { id: "first", kind: "coordinate", latitude: 59.4, longitude: 18.3, state: "correct", createdAt: "2026-01-01T00:00:00.000Z" },
        { id: "second", kind: "keyword", answer: "answer", finalLatitude: 59.5, finalLongitude: 18.4, state: "correct", createdAt: "2026-01-02T00:00:00.000Z" }
      ]
    }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => ({ clientId: original.clientId, data: input.data.data, snapshotRevision: 12 })
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.deleteAttempt("Bearer secret", "GC12345", "first");

  assert.equal(result.mystery.status, "solved");
  assert.equal(result.mystery.attempts.length, 1);
});

test("agent delete reports a missing attempt instead of silently succeeding", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 12,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", attempts: [] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async () => {
        throw new Error("update must not run for a missing attempt");
      }
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  await assert.rejects(controller.deleteAttempt("Bearer secret", "GC12345", "missing-id"), /Attempt was not found/);
});

test("agent replaces solution and field notes", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 4,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", notes: "old notes", attempts: [] }
  };
  let updateInput: any;
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => {
        updateInput = input;
        return { clientId: original.clientId, data: input.data.data, snapshotRevision: 5 };
      }
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.updateNotes("Bearer secret", "gc12345", { notes: "leta lågt" });

  assert.equal(result.ok, true);
  assert.equal(result.mystery.notes, "leta lågt");
  assert.equal(result.revision, 5);
  assert.deepEqual(updateInput.data.snapshotRevision, { increment: 1 });
});

test("agent appends to existing notes without wiping them", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 5,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", notes: "existing clue", attempts: [] }
  };
  let storedNotes: unknown;
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async (input: any) => {
        storedNotes = (input.data.data as any).notes;
        return { clientId: original.clientId, data: input.data.data, snapshotRevision: 6 };
      }
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  const result = await controller.updateNotes("Bearer secret", "GC12345", {
    notes: "new finding",
    mode: "append"
  });

  assert.equal(storedNotes, "existing clue\n\nnew finding");
  assert.equal(result.mystery.notes, "existing clue\n\nnew finding");
});

test("agent notes reject oversized content", async () => {
  const original = {
    id: "workspace-1",
    clientId: "local-1",
    snapshotRevision: 5,
    data: { id: "local-1", gcCode: "GC12345", name: "Cipher", status: "solving", notes: "", attempts: [] }
  };
  const tx = {
    $queryRaw: async () => [],
    mysteryWorkspace: {
      findUnique: async () => original,
      update: async () => {
        throw new Error("update must not run for oversized notes");
      }
    }
  };
  const controller = new MysteryAgentController(
    { $transaction: async (callback: any) => callback(tx) } as any,
    { userId: async () => "user-1" } as any
  );

  await assert.rejects(
    controller.updateNotes("Bearer secret", "GC12345", { notes: "x".repeat(100_001) }),
    /cannot exceed/
  );
});
