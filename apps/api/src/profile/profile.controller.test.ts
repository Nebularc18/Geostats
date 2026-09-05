import assert from "node:assert/strict";
import test from "node:test";
import { ProfileController } from "./profile.controller";

const user = { id: "user-1" } as any;

test("trims the stored Geocaching username", async () => {
  let upsertArgs: any;
  const tx = {
    geocachingProfile: {
      upsert: async (args: any) => {
        upsertArgs = args;
        return { gcUsername: args.create.gcUsername };
      }
    },
    statSnapshot: {
      deleteMany: async () => undefined
    }
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  };
  const controller = new ProfileController(prisma as any);

  await controller.updateProfile(user, {
    gcUsername: "  Alice  ",
    timeZone: "Europe/Stockholm"
  } as any);

  assert.equal(upsertArgs.create.gcUsername, "Alice");
  assert.equal(upsertArgs.update.gcUsername, "Alice");
  assert.equal("publicStatsEnabled" in upsertArgs.create, false);
  assert.equal("publicStatsEnabled" in upsertArgs.update, false);
});

test("stores an explicit public statistics consent choice", async () => {
  let upsertArgs: any;
  let snapshotDeletes = 0;
  const tx = {
    geocachingProfile: {
      upsert: async (args: any) => {
        upsertArgs = args;
        return { ...args.create };
      }
    },
    statSnapshot: {
      deleteMany: async () => {
        snapshotDeletes += 1;
      }
    }
  };
  const controller = new ProfileController({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)
  } as any);

  const result = await controller.updateProfile(user, {
    gcUsername: "Alice",
    timeZone: "Europe/Stockholm",
    publicStatsEnabled: true
  } as any);

  assert.equal(upsertArgs.create.publicStatsEnabled, true);
  assert.equal(upsertArgs.update.publicStatsEnabled, true);
  assert.equal((result.profile as any).publicStatsEnabled, true);
  assert.equal(snapshotDeletes, 1);
});

test("updates public statistics consent without rewriting profile settings", async () => {
  let updateArgs: any;
  const stored = { userId: user.id, gcUsername: "Alice", publicStatsEnabled: false };
  const controller = new ProfileController({
    geocachingProfile: {
      findUnique: async () => stored,
      update: async (args: any) => {
        updateArgs = args;
        return { ...stored, ...args.data };
      }
    }
  } as any);

  const result = await controller.updatePublicStats(user, { publicStatsEnabled: true });

  assert.deepEqual(updateArgs, {
    where: { userId: user.id },
    data: { publicStatsEnabled: true }
  });
  assert.equal((result.profile as any).publicStatsEnabled, true);
});

test("rejects a whitespace-only Geocaching username", async () => {
  const controller = new ProfileController({} as any);

  await assert.rejects(
    () => controller.updateProfile(user, { gcUsername: "  ", timeZone: "Europe/Stockholm" } as any),
    (error: unknown) => error instanceof Error && error.message === "Geocaching username is required"
  );
});
