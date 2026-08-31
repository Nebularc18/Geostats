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
});

test("rejects a whitespace-only Geocaching username", async () => {
  const controller = new ProfileController({} as any);

  await assert.rejects(
    () => controller.updateProfile(user, { gcUsername: "  ", timeZone: "Europe/Stockholm" } as any),
    (error: unknown) => error instanceof Error && error.message === "Geocaching username is required"
  );
});
