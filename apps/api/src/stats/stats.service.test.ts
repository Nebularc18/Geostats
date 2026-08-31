import { BadRequestException } from "@nestjs/common";
import assert from "node:assert/strict";
import test from "node:test";
import { StatsService } from "./stats.service";

test("rejects ambiguous case-insensitive geocaching usernames", async () => {
  let latestImportLookups = 0;
  const prisma = {
    geocachingProfile: {
      findMany: async () => [
        { userId: "user-1", gcUsername: "Alice" },
        { userId: "user-2", gcUsername: "alice" },
      ],
    },
    import: {
      findFirst: async () => {
        latestImportLookups += 1;
        return null;
      },
    },
  };
  const service = new StatsService(prisma as any);

  await assert.rejects(
    () => (service as any).snapshotForUsername(" ALICE "),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message === "Geocaching username matches multiple profiles",
  );
  assert.equal(latestImportLookups, 0);
});
