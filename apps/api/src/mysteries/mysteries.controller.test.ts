import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { MysteriesController } from "./mysteries.controller";

const owner = { id: "owner-1", email: "owner@example.com", username: "owner" };
const recipient = { id: "recipient-1", username: "recipient" };
const mystery = { id: "local-1", gcCode: "GC12345", name: "A mystery", sharedWith: [], attempts: [] };

test("share persists both the owner snapshot and recipient grant", async () => {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const transaction = {
    mysteryWorkspaceDeletion: {
      findUnique: async () => null
    },
    mysteryWorkspace: {
      upsert: async (input: unknown) => {
        calls.push({ operation: "workspace", input });
        return { id: "workspace-1" };
      },
      updateMany: async (input: unknown) => {
        calls.push({ operation: "snapshot", input });
        return { count: 0 };
      },
      findUnique: async () => ({ snapshotRevision: 1 })
    },
    mysteryShare: {
      upsert: async (input: unknown) => {
        calls.push({ operation: "grant", input });
        return { id: "share-1" };
      }
    }
  };
  const prisma = {
    user: { findUnique: async () => recipient },
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.share(owner, "local-1", { recipientId: recipient.id, mystery, revision: 1 });

  assert.deepEqual(result, { recipient, revision: 1 });
  assert.equal(calls[0].operation, "workspace");
  assert.deepEqual((calls[0].input as any).where, { ownerId_clientId: { ownerId: owner.id, clientId: "local-1" } });
  assert.equal(calls[1].operation, "snapshot");
  assert.equal(calls[2].operation, "grant");
  assert.deepEqual((calls[2].input as any).create, { mysteryId: "workspace-1", recipientId: recipient.id });
});

test("shared returns the granted snapshot through the recipient lookup", async () => {
  const prisma = {
    mysteryShare: {
      findMany: async () => [{
        mystery: {
          id: "workspace-1",
          data: mystery,
          owner: { id: owner.id, username: owner.username },
          shares: [{ recipient }]
        }
      }]
    }
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.shared({ ...recipient, email: "recipient@example.com" });

  assert.deepEqual(result.mysteries, [{
    workspaceId: "workspace-1",
    mystery,
    owner: { id: owner.id, username: owner.username },
    sharedWith: [recipient]
  }]);
});

test("ownedShares returns the server-authoritative recipient list", async () => {
  const prisma = {
    mysteryWorkspace: {
      findMany: async () => [{
        clientId: mystery.id,
        snapshotRevision: 4,
        shares: [{ recipient }]
      }]
    },
    mysteryWorkspaceDeletion: {
      findMany: async () => [{ clientId: "deleted-local-1" }]
    }
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.ownedShares(owner);

  assert.deepEqual(result, {
    mysteries: [{ clientId: mystery.id, revision: 4, sharedWith: [recipient] }],
    deletedClientIds: ["deleted-local-1"]
  });
});

test("share rejects a snapshot that does not match the requested mystery", async () => {
  const controller = new MysteriesController({} as any);

  await assert.rejects(
    controller.share(owner, "another-id", { recipientId: recipient.id, mystery }),
    BadRequestException
  );
});

test("update refreshes an owned shared snapshot", async () => {
  let updateInput: unknown;
  const prisma = {
    mysteryWorkspace: {
      updateMany: async (input: unknown) => {
        updateInput = input;
        return { count: 1 };
      }
    }
  };
  const controller = new MysteriesController(prisma as any);
  const updatedMystery = { ...mystery, notes: "New solution" };

  const result = await controller.update(owner, mystery.id, { mystery: updatedMystery, revision: 2 });

  assert.deepEqual(result, { ok: true, revision: 2 });
  assert.deepEqual((updateInput as any).where, {
    ownerId: owner.id,
    clientId: mystery.id,
    snapshotRevision: { lt: 2 }
  });
  assert.deepEqual((updateInput as any).data, { data: updatedMystery, snapshotRevision: 2 });
});

test("update cannot modify another owner's shared snapshot", async () => {
  const prisma = {
    mysteryWorkspace: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => null
    }
  };
  const controller = new MysteriesController(prisma as any);

  await assert.rejects(
    controller.update(owner, mystery.id, { mystery, revision: 1 }),
    /Shared mystery was not found/
  );
});

test("an older in-flight update cannot overwrite a newer snapshot", async () => {
  let updateInput: unknown;
  const prisma = {
    mysteryWorkspace: {
      updateMany: async (input: unknown) => {
        updateInput = input;
        return { count: 0 };
      },
      findUnique: async () => ({ snapshotRevision: 2 })
    }
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.update(owner, mystery.id, {
    mystery: { ...mystery, notes: "Older notes" },
    revision: 1
  });

  assert.deepEqual(result, { ok: true, revision: 2 });
  assert.deepEqual((updateInput as any).where.snapshotRevision, { lt: 1 });
});

test("delete removes only the owner's workspace so its grants cascade", async () => {
  let deleteInput: unknown;
  let tombstoneInput: unknown;
  const transaction = {
    mysteryWorkspace: {
      deleteMany: async (input: unknown) => {
        deleteInput = input;
        return { count: 1 };
      }
    },
    mysteryWorkspaceDeletion: {
      upsert: async (input: unknown) => {
        tombstoneInput = input;
        return { id: "deletion-1" };
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.delete(owner, mystery.id);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual((deleteInput as any).where, { ownerId: owner.id, clientId: mystery.id });
  assert.deepEqual((tombstoneInput as any).where, {
    ownerId_clientId: { ownerId: owner.id, clientId: mystery.id }
  });
});

test("a durable deletion tombstone blocks stale tabs from resharing", async () => {
  const transaction = {
    mysteryWorkspaceDeletion: {
      findUnique: async () => ({ id: "deletion-1" })
    }
  };
  const prisma = {
    user: { findUnique: async () => recipient },
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  await assert.rejects(
    controller.share(owner, mystery.id, {
      recipientId: recipient.id,
      mystery,
      revision: 1
    }),
    /Mystery was deleted/
  );
});
