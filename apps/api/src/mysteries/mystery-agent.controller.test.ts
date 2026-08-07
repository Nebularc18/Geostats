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
