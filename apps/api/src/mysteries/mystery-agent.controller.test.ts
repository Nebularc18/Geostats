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
