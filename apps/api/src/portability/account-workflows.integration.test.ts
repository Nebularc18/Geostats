import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@geostats/db";
import { normalizeTravelPlan, travelPlanGpx } from "@geostats/shared";
import { PrismaService } from "../common/prisma.service";
import { TravelPlansController } from "../map/travel-plans.controller";
import { MysteriesController } from "../mysteries/mysteries.controller";
import { PortabilityService } from "./portability.service";

const databaseUrl = process.env.GEOSTATS_TEST_DATABASE_URL;

test("account trips and private checkers survive a repeat restore, with account and revision isolation", {
  skip: !databaseUrl,
  timeout: 25_000
}, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } }) as PrismaService;
  const suffix = randomUUID().replaceAll("-", "");
  const source = { id: `source-${suffix}`, email: `source-${suffix}@example.test`, username: `source-${suffix}` };
  const destination = { id: `destination-${suffix}`, email: `destination-${suffix}@example.test`, username: `destination-${suffix}` };
  const gcCode = `GC${suffix.slice(0, 12).toUpperCase()}`;
  const trips = new TravelPlansController(prisma);
  const mysteries = new MysteriesController(prisma);
  const portability = new PortabilityService(prisma, {} as never);

  try {
    await prisma.user.createMany({ data: [source, destination] });
    const trip = normalizeTravelPlan({
      id: "local-trip", name: "Field trip", createdAt: "2026-01-01", mode: "nearby", radiusKm: 10,
      origin: { label: "Start", latitude: 59, longitude: 18 },
      caches: [
        { id: "point-1", gcCode, name: "Puzzle & route", latitude: 59.01, longitude: 18, distanceKm: 1 },
        { id: "point-2", gcCode: "GC2", name: "Second stop", latitude: 59.02, longitude: 18, distanceKm: 2 }
      ]
    })!;
    assert.ok(trip);
    await trips.migrate(source, [trip]);
    await trips.migrate(source, [trip]);
    assert.equal((await trips.list(source)).plans.length, 1);
    assert.deepEqual((await trips.list(destination)).plans, []);
    const reordered = { ...trip, caches: [...trip.caches].reverse() };
    await trips.save(source, trip.id, { plan: reordered, version: 1 });
    await assert.rejects(trips.save(source, trip.id, { plan: trip, version: 1 }), /changed on another device/);
    assert.match(travelPlanGpx(reordered), /Puzzle &amp; route/);

    await prisma.challengeChecker.create({ data: {
      userId: source.id, gcCode, name: "Find one", publicSlug: `published-${suffix}`,
      publishedAt: new Date(), rules: [{ type: "TOTAL_FINDS", minimum: 1 }]
    } });
    const backup = await portability.exportData(source);
    assert.equal(backup.version, 2);
    assert.deepEqual(backup.data.travelPlans, [reordered]);
    assert.ok(!JSON.stringify(backup).includes(`published-${suffix}`));
    const serialized = JSON.stringify(backup);
    const first = await portability.importData(destination, serialized);
    assert.equal(first.imported.challengeCheckers, 1);
    assert.equal(first.imported.travelPlans, 1);
    const repeated = await portability.importData(destination, serialized);
    assert.equal(repeated.imported.challengeCheckers, 0);
    assert.equal(repeated.imported.travelPlans, 0);
    assert.deepEqual((await trips.list(destination)).plans[0]?.caches, reordered.caches);
    const restored = await prisma.challengeChecker.findFirstOrThrow({ where: { userId: destination.id } });
    assert.equal(restored.publicSlug, null);
    assert.equal(restored.publishedAt, null);

    await trips.remove(destination, trip.id, 1);
    await trips.migrate(destination, [trip]);
    await portability.importData(destination, serialized);
    assert.deepEqual((await trips.list(destination)).plans, []);

    const mystery = { id: "local-mystery", gcCode, name: "Fixture puzzle", notes: "Original" };
    await mysteries.update(source, mystery.id, { mystery, baseRevision: 0, revision: 1 });
    const serverEdit = { ...mystery, notes: "Server edit" };
    await mysteries.update(source, mystery.id, { mystery: serverEdit, baseRevision: 1, revision: 2 });
    const response = await mysteries.update(source, mystery.id, {
      mystery: { ...mystery, notes: "Device edit" }, baseRevision: 1, revision: 2
    });
    assert.equal(response.revision, 2);
    assert.deepEqual(response.mystery, serverEdit);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [source.id, destination.id] } } });
    await prisma.cache.deleteMany({ where: { gcCode } });
    await prisma.$disconnect();
  }
});
