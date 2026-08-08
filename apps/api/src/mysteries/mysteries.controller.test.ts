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
    $queryRaw: async () => {
      calls.push({ operation: "lock", input: undefined });
      return [];
    },
    mysteryWorkspaceDeletion: {
      findUnique: async (input: unknown) => {
        calls.push({ operation: "deletion", input });
        return null;
      }
    },
    mysteryWorkspace: {
      findUnique: async (input: any) => {
        if (input.where.ownerId_gcCode) {
          calls.push({ operation: "duplicate", input });
          return null;
        }
        if (input.where.ownerId_clientId) {
          calls.push({ operation: "existing", input });
          return null;
        }
        calls.push({ operation: "readback", input });
        return { snapshotRevision: 1 };
      },
      count: async (input: unknown) => {
        calls.push({ operation: "count", input });
        return 0;
      },
      upsert: async (input: unknown) => {
        calls.push({ operation: "workspace", input });
        return { id: "workspace-1" };
      },
      updateMany: async (input: unknown) => {
        calls.push({ operation: "snapshot", input });
        return { count: 0 };
      }
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
  assert.deepEqual(calls.map(({ operation }) => operation), ["lock", "lock", "deletion", "duplicate", "existing", "count", "workspace", "snapshot", "grant", "readback"]);
  assert.deepEqual((calls[6].input as any).where, { ownerId_clientId: { ownerId: owner.id, clientId: "local-1" } });
  assert.equal((calls[6].input as any).create.gcCode, mystery.gcCode);
  assert.deepEqual((calls[8].input as any).create, { mysteryId: "workspace-1", recipientId: recipient.id });
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

test("owned returns every server-backed mystery, including unshared mysteries", async () => {
  const unsharedMystery = { ...mystery, id: "local-unshared", name: "Private solve" };
  const prisma = {
    mysteryWorkspace: {
      findMany: async () => [
        {
          clientId: unsharedMystery.id,
          data: unsharedMystery,
          snapshotRevision: 3,
          shares: []
        },
        {
          clientId: mystery.id,
          data: mystery,
          snapshotRevision: 4,
          shares: [{ recipient }]
        }
      ]
    },
    mysteryWorkspaceDeletion: {
      findMany: async () => [{ clientId: "deleted-local-1" }]
    }
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.owned(owner);

  assert.deepEqual(result, {
    mysteries: [
      { clientId: unsharedMystery.id, mystery: unsharedMystery, revision: 3, sharedWith: [] },
      { clientId: mystery.id, mystery, revision: 4, sharedWith: [recipient] }
    ],
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

test("share rejects runaway mystery names before touching the database", async () => {
  const controller = new MysteriesController({} as any);

  await assert.rejects(
    controller.share(owner, mystery.id, {
      recipientId: recipient.id,
      mystery: { ...mystery, name: "A".repeat(301) },
      revision: 1
    }),
    /cannot exceed 300 characters/
  );
});

test("share rejects a duplicate GC code with a different client id", async () => {
  const transaction = {
    $queryRaw: async () => [],
    mysteryWorkspaceDeletion: { findUnique: async () => null },
    mysteryWorkspace: {
      findUnique: async (input: any) => input.where.ownerId_gcCode ? { clientId: "other-client" } : null
    }
  };
  const prisma = {
    user: { findUnique: async () => recipient },
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  await assert.rejects(
    controller.share(owner, mystery.id, { recipientId: recipient.id, mystery, revision: 1 }),
    /already has a shared workspace/
  );
});

test("update creates an unshared server snapshot", async () => {
  const operations: string[] = [];
  let upsertInput: unknown;
  const transaction = {
    $queryRaw: async (query: TemplateStringsArray) => {
      if (query.join("?").includes("content_matches")) {
        operations.push("comparison");
        return [{ revision: 1, mystery, content_matches: true }];
      }
      operations.push("lock");
      return [];
    },
    mysteryWorkspaceDeletion: {
      findUnique: async () => {
        operations.push("deletion");
        return null;
      }
    },
    mysteryWorkspace: {
      findUnique: async (input: any) => {
        if (input.where.ownerId_gcCode) {
          operations.push("duplicate");
          return null;
        }
        if (input.where.ownerId_clientId) {
          operations.push("existing");
          return null;
        }
        throw new Error("Unexpected mystery readback");
      },
      count: async () => {
        operations.push("count");
        return 0;
      },
      upsert: async (input: unknown) => {
        operations.push("upsert");
        upsertInput = input;
        return { id: "workspace-1" };
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.update(owner, mystery.id, { mystery, revision: 1 });

  assert.deepEqual(result, { ok: true, revision: 1, mystery });
  assert.deepEqual(operations, ["lock", "lock", "deletion", "duplicate", "existing", "count", "upsert", "comparison"]);
  assert.deepEqual((upsertInput as any).create, {
    ownerId: owner.id,
    clientId: mystery.id,
    gcCode: mystery.gcCode,
    data: mystery,
    snapshotRevision: 1
  });
});

test("update rejects a stale tab after the mystery was deleted", async () => {
  const transaction = {
    $queryRaw: async () => [],
    mysteryWorkspaceDeletion: {
      findUnique: async () => ({ id: "deletion-1" })
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  await assert.rejects(
    controller.update(owner, mystery.id, { mystery, revision: 1 }),
    /Mystery was deleted/
  );
});

test("update locks both the GC code and client identity before checking tombstones", async () => {
  const lockedKeys: string[] = [];
  const transaction = {
    $queryRaw: async (_query: TemplateStringsArray, _ownerId: string, key: string) => {
      lockedKeys.push(key);
      return [];
    },
    mysteryWorkspaceDeletion: {
      findUnique: async () => ({ id: "deletion-1" })
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  await assert.rejects(
    controller.update(owner, mystery.id, { mystery, revision: 1 }),
    /Mystery was deleted/
  );
  assert.deepEqual(lockedKeys, [mystery.gcCode, mystery.id]);
});

test("an older in-flight update cannot overwrite a newer snapshot", async () => {
  let atomicQuery = "";
  const transaction = {
    $queryRaw: async (query: TemplateStringsArray) => {
      const sql = query.join("?");
      if (!sql.includes("content_matches")) return [];
      atomicQuery = sql;
      return [{
        revision: 2,
        mystery: { ...mystery, notes: "Newer notes" },
        content_matches: false
      }];
    },
    mysteryWorkspaceDeletion: {
      findUnique: async () => null
    },
    mysteryWorkspace: {
      upsert: async () => ({ id: "workspace-1" }),
      findUnique: async (input: any) => input.select?.clientId
        ? { clientId: mystery.id }
        : null
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.update(owner, mystery.id, {
    mystery: { ...mystery, notes: "Older notes" },
    revision: 1
  });

  assert.deepEqual(result, {
    ok: true,
    revision: 2,
    mystery: { ...mystery, notes: "Newer notes" }
  });
  assert.match(atomicQuery, /snapshot_revision < \?/);
  assert.match(atomicQuery, /data IS DISTINCT FROM requested\.data/);
  assert.match(atomicQuery, /FROM updated[\s\S]*UNION ALL/);
  assert.match(atomicQuery, /NOT EXISTS \(SELECT 1 FROM updated\)/);
});

test("a higher distinct update returns the updated CTE state", async () => {
  let atomicQuery = "";
  const updatedMystery = { ...mystery, notes: "Current notes" };
  const transaction = {
    $queryRaw: async (query: TemplateStringsArray) => {
      const sql = query.join("?");
      if (!sql.includes("content_matches")) return [];
      atomicQuery = sql;
      return [{ revision: 8, mystery: updatedMystery, content_matches: true }];
    },
    mysteryWorkspaceDeletion: { findUnique: async () => null },
    mysteryWorkspace: {
      findUnique: async (input: any) => input.select?.clientId
        ? { clientId: mystery.id }
        : null,
      upsert: async () => ({ id: "workspace-1" })
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.update(owner, mystery.id, {
    mystery: updatedMystery,
    revision: 8
  });

  assert.deepEqual(result, { ok: true, revision: 8, mystery: updatedMystery });
  assert.match(atomicQuery, /RETURNING workspace\.snapshot_revision AS revision,[\s\S]*workspace\.data AS mystery/);
  assert.match(atomicQuery, /SELECT updated\.revision,[\s\S]*updated\.mystery/);
});

test("an identical update does not advance the server revision", async () => {
  let comparisonCalls = 0;
  const reorderedMystery = {
    attempts: [],
    sharedWith: [],
    name: mystery.name,
    gcCode: mystery.gcCode,
    id: mystery.id
  };
  const transaction = {
    $queryRaw: async (query: TemplateStringsArray) => {
      if (query.join("?").includes("content_matches")) {
        comparisonCalls += 1;
        return [{ revision: 42, mystery, content_matches: true }];
      }
      return [];
    },
    mysteryWorkspaceDeletion: { findUnique: async () => null },
    mysteryWorkspace: {
      findUnique: async (input: any) => input.select?.clientId
        ? { clientId: mystery.id }
        : null,
      upsert: async () => ({ id: "workspace-1" })
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.update(owner, mystery.id, { mystery, revision: 43 });

  assert.equal(comparisonCalls, 1);
  assert.deepEqual(result, { ok: true, revision: 42, mystery: reorderedMystery });
});

test("delete removes only the owner's workspace so its grants cascade", async () => {
  const operations: string[] = [];
  let deleteInput: unknown;
  let tombstoneInput: unknown;
  const transaction = {
    $queryRaw: async (query: TemplateStringsArray) => {
      assert.match(query.join("?"), /pg_advisory_xact_lock[\s\S]*::text AS lock_result/);
      operations.push("lock");
      return [];
    },
    mysteryWorkspace: {
      deleteMany: async (input: unknown) => {
        operations.push("delete");
        deleteInput = input;
        return { count: 1 };
      }
    },
    mysteryWorkspaceDeletion: {
      upsert: async (input: unknown) => {
        operations.push("tombstone");
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
  assert.deepEqual(operations, ["lock", "delete", "tombstone"]);
  assert.deepEqual((deleteInput as any).where, { ownerId: owner.id, clientId: mystery.id });
  assert.deepEqual((tombstoneInput as any).where, {
    ownerId_clientId: { ownerId: owner.id, clientId: mystery.id }
  });
});

test("a durable deletion tombstone blocks stale tabs from resharing", async () => {
  const transaction = {
    $queryRaw: async () => [],
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

test("unshare locks the mystery before revoking its recipient grant", async () => {
  const operations: string[] = [];
  const transaction = {
    $queryRaw: async () => {
      operations.push("lock");
      return [];
    },
    mysteryWorkspace: {
      findUnique: async () => {
        operations.push("workspace");
        return { id: "workspace-1" };
      }
    },
    mysteryShare: {
      deleteMany: async () => {
        operations.push("revoke");
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (tx: typeof transaction) => unknown) => callback(transaction)
  };
  const controller = new MysteriesController(prisma as any);

  const result = await controller.unshare(owner, mystery.id, recipient.id);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(operations, ["lock", "workspace", "revoke"]);
});
