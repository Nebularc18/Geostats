import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { cacheLogs, CollectorController, logKey, mergedRaw, parseReceivedLogsCsv, rawFromInput, trustedBaseUrl } from "./collector.controller";

function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("trustedBaseUrl uses API_ORIGIN instead of forwarded request headers", () => {
  withEnv({ API_ORIGIN: "https://api.geostats.example/", NODE_ENV: "production" }, () => {
    const baseUrl = trustedBaseUrl({
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "attacker.example"
      },
      protocol: "http"
    });

    assert.equal(baseUrl, "https://api.geostats.example");
  });
});

test("trustedBaseUrl requires API_ORIGIN in production", () => {
  withEnv({ API_ORIGIN: undefined, NODE_ENV: "production" }, () => {
    assert.throws(
      () =>
        trustedBaseUrl({
          headers: { "x-forwarded-host": "attacker.example" },
          protocol: "https"
        }),
      /API_ORIGIN must be set in production/
    );
  });
});

test("mergedRaw preserves root cache key variant", () => {
  const raw = {
    cache: {
      logs: {
        log: [
          {
            "groundspeak:date": "2024-01-01T00:00:00.000Z",
            "groundspeak:type": "Found it",
            "groundspeak:finder": "Existing",
            "groundspeak:text": "Already here"
          }
        ]
      }
    }
  };
  const result = mergedRaw(raw, [
    {
      "groundspeak:date": "2024-01-02T00:00:00.000Z",
      "groundspeak:type": "Found it",
      "groundspeak:finder": "New",
      "groundspeak:text": "Added"
    }
  ]);

  assert.equal(result.added, 1);
  assert.equal("groundspeak:cache" in result.raw, false);
  assert.equal(cacheLogs(result.raw).length, 2);
});

test("logKey normalizes GPX and collector date formats to the same day", () => {
  const stored = logKey({
    "groundspeak:date": "2024-01-15T00:00:00",
    "groundspeak:type": "Found it",
    "groundspeak:finder": "Finder",
    "groundspeak:text": "Same log"
  });
  const incoming = logKey({
    "groundspeak:date": "2024-01-15T00:00:00.000Z",
    "groundspeak:type": "Found it",
    "groundspeak:finder": "Finder",
    "groundspeak:text": "Same log"
  });

  assert.equal(incoming, stored);
});

test("logKey normalizes GPX HTML text and collector plain text", () => {
  const stored = logKey({
    "groundspeak:date": "2024-01-15T00:00:00",
    "groundspeak:type": "Found it",
    "groundspeak:finder": "Finder",
    "groundspeak:text": "Nice &amp; easy cache"
  });
  const incoming = logKey({
    "groundspeak:date": "2024-01-15T00:00:00.000Z",
    "groundspeak:type": "Found it",
    "groundspeak:finder": "Finder",
    "groundspeak:text": "Nice & easy cache"
  });

  assert.equal(incoming, stored);
});

test("mergedRaw deduplicates no-id logs across GPX and collector date formats", () => {
  const result = mergedRaw(
    {
      "groundspeak:cache": {
        "groundspeak:logs": {
          "groundspeak:log": [
            {
              "groundspeak:date": "2024-01-15T00:00:00",
              "groundspeak:type": "Found it",
              "groundspeak:finder": "Finder",
              "groundspeak:text": "Same log"
            }
          ]
        }
      }
    },
    [
      {
        "groundspeak:date": "2024-01-15T00:00:00.000Z",
        "groundspeak:type": "Found it",
        "groundspeak:finder": "Finder",
        "groundspeak:text": "Same log"
      }
    ]
  );

  assert.equal(result.added, 0);
  assert.equal(cacheLogs(result.raw).length, 1);
});

test("mergedRaw deduplicates no-id logs across GPX HTML text and collector plain text", () => {
  const result = mergedRaw(
    {
      "groundspeak:cache": {
        "groundspeak:logs": {
          "groundspeak:log": [
            {
              "groundspeak:date": "2024-01-15T00:00:00",
              "groundspeak:type": "Found it",
              "groundspeak:finder": "Finder",
              "groundspeak:text": "Nice &amp; easy cache"
            }
          ]
        }
      }
    },
    [
      {
        "groundspeak:date": "2024-01-15T00:00:00.000Z",
        "groundspeak:type": "Found it",
        "groundspeak:finder": "Finder",
        "groundspeak:text": "Nice & easy cache"
      }
    ]
  );

  assert.equal(result.added, 0);
  assert.equal(cacheLogs(result.raw).length, 1);
});

test("rawFromInput rejects malformed collector entries with BadRequestException", () => {
  assert.throws(() => rawFromInput({ date: "2024-01-15", finder: "Finder" }), BadRequestException);
  assert.throws(() => rawFromInput({ gcCode: "GC123", date: "not a date", finder: "Finder" }), BadRequestException);
  assert.throws(() => rawFromInput({ gcCode: "GC123", date: "2024-01-15" }), BadRequestException);
});

test("parseReceivedLogsCsv reads generated owner log CSV", () => {
  const logs = parseReceivedLogsCsv(
    'gcCode,logId,date,type,finder,text\nGC123,987,2024-01-15,Found it,Finder,"Nice, easy cache"\n'
  );

  assert.deepEqual(logs, [
    {
      gcCode: "GC123",
      logId: "987",
      date: "2024-01-15",
      type: "Found it",
      finder: "Finder",
      text: "Nice, easy cache"
    }
  ]);
});

test("parseReceivedLogsCsv accepts older CSV without log ids", () => {
  const logs = parseReceivedLogsCsv("gcCode,date,type,finder,text\nGC123,2024-01-15,Found it,Finder,Fresh\n");

  assert.deepEqual(logs, [
    {
      gcCode: "GC123",
      logId: null,
      date: "2024-01-15",
      type: "Found it",
      finder: "Finder",
      text: "Fresh"
    }
  ]);
});

function collectorControllerWithHides(hides: unknown[]) {
  const prisma = {
    collectorToken: {
      findUnique: async () => ({ id: "token-1", userId: "user-1" }),
      update: async () => ({})
    },
    hide: {
      findMany: async () => hides
    }
  };
  return new CollectorController(prisma as any, {} as any);
}

test("receivedLogs rejects non-array logs with BadRequestException", async () => {
  const controller = collectorControllerWithHides([]);

  await assert.rejects(() => controller.receivedLogs("Bearer token", { logs: "bad" } as any), BadRequestException);
});

test("receivedLogs rejects unknown owned caches with BadRequestException", async () => {
  const controller = collectorControllerWithHides([]);

  await assert.rejects(
    () =>
      controller.receivedLogs("Bearer token", {
        logs: [{ gcCode: "GC123", date: "2024-01-15", finder: "Finder" }]
      }),
    BadRequestException
  );
});

test("receivedLogs rereads raw in the transaction and builds stats after commit", async () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  const preloadedRaw = {
    "groundspeak:cache": {
      "groundspeak:logs": {
        "groundspeak:log": []
      }
    }
  };
  const transactionRaw = {
    "groundspeak:cache": {
      "groundspeak:logs": {
        "groundspeak:log": [
          {
            "groundspeak:date": "2024-01-14T00:00:00",
            "groundspeak:type": "Found it",
            "groundspeak:finder": "Existing",
            "groundspeak:text": "Already committed"
          }
        ]
      }
    }
  };
  let inTransaction = false;
  let transactionCount = 0;
  let writtenRaw: unknown;
  const tx = {
    hide: {
      findFirst: async () => ({
        id: "hide-1",
        cacheId: "cache-1",
        receivedLogCount: 1,
        cache: {
          id: "cache-1",
          updatedAt,
          raw: transactionRaw
        }
      }),
      update: async () => ({})
    },
    cache: {
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.id, "cache-1");
        assert.equal(where.updatedAt, updatedAt);
        writtenRaw = data.raw;
        return { count: 1 };
      }
    }
  };
  const prisma = {
    collectorToken: {
      findUnique: async () => ({ id: "token-1", userId: "user-1" }),
      update: async () => ({})
    },
    hide: {
      findMany: async () => [
        {
          id: "hide-1",
          cacheId: "cache-1",
          receivedLogCount: 0,
          cache: { gcCode: "GC123", raw: preloadedRaw }
        }
      ]
    },
    $transaction: async (run: (client: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      inTransaction = true;
      try {
        return await run(tx);
      } finally {
        inTransaction = false;
      }
    }
  };
  const stats = {
    buildSnapshotForUser: async () => {
      assert.equal(inTransaction, false);
      return { statsVersion: 16 };
    },
    replaceSnapshotForUser: async () => {
      assert.equal(inTransaction, true);
    }
  };
  const controller = new CollectorController(prisma as any, stats as any);

  const result = await controller.receivedLogs("Bearer token", {
    logs: [{ gcCode: "GC123", date: "2024-01-15", finder: "New", text: "Fresh" }]
  });

  assert.deepEqual(result, { added: 1, changedCaches: 1 });
  assert.equal(transactionCount, 2);
  assert.equal(cacheLogs(writtenRaw).length, 2);
});

test("receivedLogsCsv imports uploaded owner log CSV for the authenticated user", async () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  const raw = {
    "groundspeak:cache": {
      "groundspeak:logs": {
        "groundspeak:log": []
      }
    }
  };
  let writtenRaw: unknown;
  const tx = {
    hide: {
      findFirst: async ({ where }: any) => {
        assert.equal(where.userId, "user-1");
        return {
          id: "hide-1",
          cacheId: "cache-1",
          receivedLogCount: 0,
          cache: { id: "cache-1", updatedAt, raw }
        };
      },
      update: async () => ({})
    },
    cache: {
      updateMany: async ({ data }: any) => {
        writtenRaw = data.raw;
        return { count: 1 };
      }
    }
  };
  const prisma = {
    hide: {
      findMany: async ({ where }: any) => {
        assert.equal(where.userId, "user-1");
        return [
          {
            id: "hide-1",
            cacheId: "cache-1",
            receivedLogCount: 0,
            cache: { gcCode: "GC123", raw }
          }
        ];
      }
    },
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx)
  };
  const stats = {
    buildSnapshotForUser: async () => ({}),
    replaceSnapshotForUser: async () => ({})
  };
  const controller = new CollectorController(prisma as any, stats as any);

  const result = await controller.receivedLogsCsv(
    { id: "user-1", email: "user@example.com", username: "user" },
    {
      originalname: "geostats-received-logs.csv",
      buffer: Buffer.from("gcCode,logId,date,type,finder,text\nGC123,1,2024-01-15,Found it,Finder,Fresh\n")
    } as Express.Multer.File
  );

  assert.deepEqual(result, { added: 1, changedCaches: 1 });
  assert.equal(cacheLogs(writtenRaw).length, 1);
});
