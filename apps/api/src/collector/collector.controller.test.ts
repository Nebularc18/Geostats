import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  cacheLogs,
  CollectorController,
  gsakImportBaseUrl,
  gsakImportMacro,
  logKey,
  mergedRaw,
  normalizeFinderCountryRows,
  parseReceivedLogsCsv,
  rawFromInput,
  trustedBaseUrl
} from "./collector.controller";

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

async function withAsyncEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
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

test("PowerShell collectors select platform-specific npm launchers", () => {
  withEnv({ API_ORIGIN: "https://api.geostats.example", NODE_ENV: "production" }, () => {
    const controller = new CollectorController(undefined as never, undefined as never);
    const request = { headers: {}, protocol: "https" };

    for (const script of [controller.hidesPowerShell(request), controller.projectGcPowerShell(request)]) {
      assert.match(script, /\$isWindowsPlatform = \$env:OS -eq "Windows_NT"/);
      assert.match(script, /\$npmCommand = if \(\$isWindowsPlatform\) \{ "npm\.cmd" \} else \{ "npm" \}/);
      assert.match(script, /\$npxCommand = if \(\$isWindowsPlatform\) \{ "npx\.cmd" \} else \{ "npx" \}/);
      assert.match(script, /& \$npmCommand install --no-audit --no-fund/);
      assert.match(script, /& \$npxCommand --yes playwright install chromium/);
      assert.match(script, /& \$npxCommand --yes tsx @runArgs/);
      assert.doesNotMatch(script, /(?<![.\w])npm install/);
      assert.doesNotMatch(script, /(?<![.\w])npx --yes/);
    }
  });
});

test("gsakImportBaseUrl uses the dedicated GSAK gateway origin", () => {
  withEnv(
    {
      API_ORIGIN: "http://10.11.18.163:3001",
      GSAK_IMPORT_ORIGIN: "http://10.11.18.163/",
      NODE_ENV: "production"
    },
    () => assert.equal(gsakImportBaseUrl({ headers: {} }), "http://10.11.18.163")
  );
});

test("gsakImportBaseUrl falls back to the normal API origin", () => {
  withEnv(
    { API_ORIGIN: "https://api.geostats.example/", GSAK_IMPORT_ORIGIN: undefined, NODE_ENV: "production" },
    () => assert.equal(gsakImportBaseUrl({ headers: {} }), "https://api.geostats.example")
  );
});

test("GSAK macro refreshes found and owned caches before uploading bounded batches", () => {
  const macro = gsakImportMacro("https://api.geostats.example", "gst_secret");

  assert.match(macro, /# MacVersion = 1\.8/);
  assert.match(macro, /\$cacheBatchSize = 50/);
  assert.match(macro, /\$logBatchSize = 25/);
  assert.match(macro, /\$journeyTake = 500/);
  assert.match(macro, /\/collector\/gsak\/import/);
  assert.match(macro, /SqlQuote\(\$token\)/);
  assert.match(macro, /'kind','complete'/);
  assert.match(macro, /ifnull\(FoundByMeDate,''\) <> '' or IsOwner = 1/);
  assert.match(macro, /\$logFilter = "\(c\.IsOwner = 1\)"/);
  assert.doesNotMatch(macro, /\$logFilter = .*FoundByMeDate/);
  assert.match(macro, /from Caches where " \+ \$cacheFilter/);
  assert.match(macro, /join Caches c on c\.Code = l\.lParent where " \+ \$logFilter/);
  assert.match(macro, /GcUpdateUserInfo UpdateHome=N UpdateMatching=Y/);
  assert.match(macro, /'kind','trackable-codes'/);
  assert.match(macro, /GeostatsTrackableCodes/);
  assert.match(macro, /Code in \(select GeocacheCode from GeostatsTrackableCodes\)/);
  assert.match(macro, /GcGetCaches Settings=<macro> GcCodes=\$journeyCodes/);
  assert.match(macro, /users\/me\/geocachelogs\?logTypes=2,10,11/);
  assert.match(macro, /not exists \(select 1 from Caches c where c\.Code = a\.GeocacheCode\)/);
  assert.match(macro, /GcGetCaches Settings=<macro> GcCodes=\$missingCodes/);
  assert.match(macro, /edtHiddenBy\.Text=" \+ \$currentUser/);
  assert.match(macro, /GcGetCaches Settings=<macro> Load=Y ShowSummary=No/);
  assert.match(macro, /skip=" \+ NumToStr\(\$apiSkip\)/);
  assert.match(macro, /limit " \+ NumToStr\(\$cacheBatchSize\) \+ " offset " \+ NumToStr\(\$offset\)/);
  assert.match(macro, /limit " \+ NumToStr\(\$logBatchSize\) \+ " offset " \+ NumToStr\(\$offset\)/);
  assert.doesNotMatch(macro, /limit " \+ \$(?:cacheBatchSize|logBatchSize)/);
  assert.match(macro, /GcStatusCheck Scope=Filter ShowSummary=N/);
  assert.match(macro, /GcGetLogs Scope=Filter Type=Newer ShowSummary=N/);
  assert.match(macro, /GcRefresh Scope=Filter LogsPerCache=30 Format=Full ShowSummary=No/);
  assert.ok(macro.indexOf("GcRefresh Scope=Filter") < macro.indexOf('ShowStatus msg="Sending caches to Geostats..."'));
  assert.match(macro, /update Caches set Found=1/);
  assert.doesNotMatch(macro, /FoundCount\s*=/);
  assert.match(macro, /Geostats rejected the cache batch/);
  assert.match(macro, /Geostats rejected the placed-cache log batch/);
  assert.match(macro, /Geostats rejected the account-log batch/);
  assert.match(macro, /Geostats did not complete the import/);
});

test("GSAK setup replaces only the dedicated scoped token", async () => {
  const actions: any[] = [];
  const tx = {
    collectorToken: {
      deleteMany: async (input: any) => actions.push(["delete", input]),
      create: async (input: any) => actions.push(["create", input])
    }
  };
  const prisma = { $transaction: async (run: (client: any) => Promise<unknown>) => run(tx) };
  const controller = new CollectorController(prisma as any, {} as any);

  await withAsyncEnv({ API_ORIGIN: "https://api.geostats.example", GSAK_IMPORT_ORIGIN: "http://gsak.geostats.example", COLLECTOR_TOKEN_ENCRYPTION_KEY: "test-key" }, async () => {
    const result = await controller.setupGsak(
      { id: "user-1", email: "user@example.com", username: "user" },
      { headers: {}, protocol: "https" }
    );
    assert.equal(result.fileName, "GeostatsImport.gsk");
    assert.match(result.macro, /http:\/\/gsak\.geostats\.example/);
  });

  assert.deepEqual(actions[0], ["delete", { where: { userId: "user-1", scope: "GSAK_IMPORT" } }]);
  assert.equal(actions[1][0], "create");
  assert.equal(actions[1][1].data.scope, "GSAK_IMPORT");
});

test("GSAK status advances only after a completed import exists", async () => {
  const tokenCreatedAt = new Date("2026-08-28T10:00:00.000Z");
  const tokenLastUsedAt = new Date("2026-08-28T10:05:00.000Z");
  const importCreatedAt = new Date("2026-08-28T10:04:59.000Z");
  let latestImport: { createdAt: Date } | null = null;
  const prisma = {
    collectorToken: {
      findFirst: async (input: any) => {
        assert.deepEqual(input, {
          where: { userId: "user-1", scope: "GSAK_IMPORT" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true }
        });
        return { createdAt: tokenCreatedAt, lastUsedAt: tokenLastUsedAt };
      }
    },
    import: {
      findFirst: async (input: any) => {
        assert.deepEqual(input, {
          where: { userId: "user-1", source: "GSAK", status: "COMPLETED", createdAt: { gte: tokenCreatedAt } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { createdAt: true }
        });
        return latestImport;
      }
    }
  };
  const controller = new CollectorController(prisma as any, {} as any);

  const user = { id: "user-1", email: "user@example.com", username: "user" };
  const beforeCompletion = await controller.gsakStatus(user);
  assert.equal(beforeCompletion.lastImportedAt, null);

  latestImport = { createdAt: importCreatedAt };
  const afterCompletion = await controller.gsakStatus(user);

  assert.deepEqual(afterCompletion, {
    connected: true,
    createdAt: tokenCreatedAt,
    lastImportedAt: importCreatedAt
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
    'gcCode,logId,date,type,finder,country,text\nGC123,987,2024-01-15,Found it,Finder,Sweden,"Nice, easy cache"\n'
  );

  assert.deepEqual(logs, [
    {
      gcCode: "GC123",
      logId: "987",
      date: "2024-01-15",
      type: "Found it",
      finder: "Finder",
      finderCountry: "Sweden",
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
      finderCountry: null,
      text: "Fresh"
    }
  ]);
});

test("normalizeFinderCountryRows validates and merges country counts", () => {
  assert.deepEqual(
    normalizeFinderCountryRows([
      { country: "Sweden", count: 18 },
      { country: "Germany", count: "5" },
      { country: "Sweden", count: 1 }
    ]),
    [
      { country: "Sweden", count: 19 },
      { country: "Germany", count: 5 }
    ]
  );
  assert.throws(() => normalizeFinderCountryRows([{ country: "Sweden", count: 0 }]), BadRequestException);
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

test("receivedLogs replaces the current favorite-point total without creating history", async () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  const raw = {
    "groundspeak:cache": {
      "groundspeak:favorite_points": "4",
      favorites: "3",
      "groundspeak:logs": { "groundspeak:log": [] }
    }
  };
  let writtenCacheRaw: any;
  let hideUpdated = false;
  const tx = {
    hide: {
      findFirst: async () => ({
        id: "hide-1",
        cacheId: "cache-1",
        updatedAt,
        receivedLogCount: 0,
        receivedLogsRaw: raw,
        cache: {
          id: "cache-1",
          updatedAt,
          userData: [{ id: "user-cache-1", userId: "user-1", cacheId: "cache-1", updatedAt, raw }]
        }
      }),
      updateMany: async () => {
        hideUpdated = true;
        return { count: 1 };
      }
    },
    userCacheData: {
      updateMany: async ({ where, data }: any) => {
        assert.deepEqual(where, { id: "user-cache-1", userId: "user-1", updatedAt });
        writtenCacheRaw = data.raw;
        return { count: 1 };
      }
    }
  };
  let transactionCount = 0;
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
          receivedLogsRaw: raw,
          cache: {
            gcCode: "GC123",
            userData: [{ id: "user-cache-1", userId: "user-1", cacheId: "cache-1", updatedAt, raw }]
          }
        }
      ]
    },
    $transaction: async (run: (client: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      return run(tx);
    }
  };
  const stats = {
    buildSnapshotForUser: async () => ({}),
    replaceSnapshotForUser: async () => ({})
  };
  const controller = new CollectorController(prisma as any, stats as any);

  const result = await controller.receivedLogs("Bearer token", {
    logs: [],
    caches: [{ gcCode: "gc123", favoritePoints: 9 }]
  });

  assert.deepEqual(result, { added: 0, changedCaches: 1 });
  assert.equal(transactionCount, 2);
  assert.equal(hideUpdated, false);
  assert.equal(writtenCacheRaw["groundspeak:cache"]["groundspeak:favorite_points"], "9");
  assert.equal(Object.keys(writtenCacheRaw["groundspeak:cache"]).filter((key) => key.includes("favorite")).length, 1);
});

test("receivedLogs rejects invalid favorite-point totals", async () => {
  const controller = collectorControllerWithHides([]);

  await assert.rejects(
    () => controller.receivedLogs("Bearer token", { caches: [{ gcCode: "GC123", favoritePoints: -1 }] }),
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
        updatedAt,
        receivedLogCount: 1,
        receivedLogsRaw: transactionRaw,
        cache: {
          id: "cache-1",
          updatedAt,
          raw: transactionRaw
        }
      }),
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.id, "hide-1");
        assert.equal(where.userId, "user-1");
        assert.equal(where.updatedAt, updatedAt);
        assert.equal(data.receivedLogCount, 2);
        writtenRaw = data.receivedLogsRaw;
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
          receivedLogsRaw: preloadedRaw,
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

test("receivedLogs returns committed import result when stats rebuild fails", async () => {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  const raw = {
    "groundspeak:cache": {
      "groundspeak:logs": {
        "groundspeak:log": []
      }
    }
  };
  let transactionCount = 0;
  let loggedError = false;
  const tx = {
    hide: {
      findFirst: async () => ({
        id: "hide-1",
        cacheId: "cache-1",
        updatedAt,
        receivedLogCount: 0,
        receivedLogsRaw: raw,
        cache: { id: "cache-1", updatedAt, raw }
      }),
      updateMany: async () => ({ count: 1 })
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
          receivedLogsRaw: raw,
          cache: { gcCode: "GC123", raw }
        }
      ]
    },
    $transaction: async (run: (client: unknown) => Promise<unknown>) => {
      transactionCount += 1;
      return run(tx);
    }
  };
  const stats = {
    buildSnapshotForUser: async () => {
      throw new Error("stats unavailable");
    },
    replaceSnapshotForUser: async () => {
      throw new Error("stats replacement should not run");
    }
  };
  const controller = new CollectorController(prisma as any, stats as any);
  (controller as any).logger = {
    error: () => {
      loggedError = true;
    }
  };

  const result = await controller.receivedLogs("Bearer token", {
    logs: [{ gcCode: "GC123", date: "2024-01-15", finder: "New", text: "Fresh" }]
  });

  assert.deepEqual(result, { added: 1, changedCaches: 1 });
  assert.equal(transactionCount, 1);
  assert.equal(loggedError, true);
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
          updatedAt,
          receivedLogCount: 0,
          receivedLogsRaw: raw,
          cache: { id: "cache-1", updatedAt, raw }
        };
      },
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.id, "hide-1");
        assert.equal(where.userId, "user-1");
        writtenRaw = data.receivedLogsRaw;
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
            receivedLogsRaw: raw,
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
      mimetype: "text/csv",
      buffer: Buffer.from("gcCode,logId,date,type,finder,text\nGC123,1,2024-01-15,Found it,Finder,Fresh\n")
    } as Express.Multer.File
  );

  assert.deepEqual(result, { added: 1, changedCaches: 1 });
  assert.equal(cacheLogs(writtenRaw).length, 1);
});

test("receivedLogsCsv rejects renamed non-CSV uploads by MIME type", async () => {
  const controller = new CollectorController({} as any, {} as any);

  await assert.rejects(
    () =>
      controller.receivedLogsCsv(
        { id: "user-1", email: "user@example.com", username: "user" },
        {
          originalname: "archive.csv",
          mimetype: "application/zip",
          buffer: Buffer.from("not a csv")
        } as Express.Multer.File
      ),
    BadRequestException
  );
});

test("projectGcFinderCountries stores aggregate rows and clears snapshots", async () => {
  const actions: string[] = [];
  const tx = {
    ownerFinderCountryStat: {
      deleteMany: async ({ where }: any) => {
        assert.equal(where.userId, "user-1");
        actions.push("delete-countries");
      },
      createMany: async ({ data }: any) => {
        assert.deepEqual(data, [
          { userId: "user-1", country: "Sweden", count: 18 },
          { userId: "user-1", country: "Germany", count: 5 }
        ]);
        actions.push("create-countries");
      }
    },
    statSnapshot: {
      deleteMany: async ({ where }: any) => {
        assert.equal(where.userId, "user-1");
        actions.push("delete-snapshots");
      }
    }
  };
  const prisma = {
    collectorToken: {
      findUnique: async () => ({ id: "token-1", userId: "user-1" }),
      update: async () => ({})
    },
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx)
  };
  const controller = new CollectorController(prisma as any, {} as any);

  const result = await controller.projectGcFinderCountries("Bearer token", {
    rows: [
      { country: "Sweden", count: 18 },
      { country: "Germany", count: 5 }
    ]
  });

  assert.deepEqual(result.rows, [
    { country: "Sweden", count: 18 },
    { country: "Germany", count: 5 }
  ]);
  assert.deepEqual(actions, ["delete-countries", "create-countries", "delete-snapshots"]);
});

test("projectGcFinderCountries rejects empty rows before clearing data", async () => {
  let transactionCalled = false;
  const prisma = {
    collectorToken: {
      findUnique: async () => ({ id: "token-1", userId: "user-1" }),
      update: async () => ({})
    },
    $transaction: async () => {
      transactionCalled = true;
    }
  };
  const controller = new CollectorController(prisma as any, {} as any);

  await assert.rejects(() => controller.projectGcFinderCountries("Bearer token", { rows: [] }), BadRequestException);
  assert.equal(transactionCalled, false);
});
