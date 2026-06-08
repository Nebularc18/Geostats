import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { cacheLogs, CollectorController, logKey, mergedRaw, rawFromInput, trustedBaseUrl } from "./collector.controller";

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

test("rawFromInput rejects malformed collector entries with BadRequestException", () => {
  assert.throws(() => rawFromInput({ date: "2024-01-15", finder: "Finder" }), BadRequestException);
  assert.throws(() => rawFromInput({ gcCode: "GC123", date: "not a date", finder: "Finder" }), BadRequestException);
  assert.throws(() => rawFromInput({ gcCode: "GC123", date: "2024-01-15" }), BadRequestException);
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
