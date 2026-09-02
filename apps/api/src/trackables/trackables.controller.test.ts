import assert from "node:assert/strict";
import test from "node:test";
import { TrackablesController } from "./trackables.controller";

function movement(id: string, loggedAt: string, sequence: number) {
  return {
    id,
    trackable: {
      id: "trackable-1",
      trackingCode: "TB123",
      name: "A traveller",
    },
    cache: null,
    gcCode: "GC123",
    cacheName: "Journey cache",
    logType: "VISITED",
    loggedAt: new Date(loggedAt),
    locationName: null,
    holderName: null,
    latitude: 56 + sequence / 100,
    longitude: 15 + sequence / 100,
    notes: null,
    raw: {},
    sequence,
  };
}

test("map keeps the newest window, preserves sequence totals, and reports truncation", async () => {
  let findManyInput: any;
  const rows = [
    movement("log-3", "2024-01-03T00:00:00.000Z", 3),
    movement("log-2", "2024-01-02T00:00:00.000Z", 2),
  ];
  const prisma = {
    trackableLog: {
      findMany: async (input: any) => {
        findManyInput = input;
        return rows;
      },
      groupBy: async () => [
        { trackableId: "trackable-1", _count: { _all: 3 } },
      ],
    },
  };
  const controller = new TrackablesController(prisma as any, {} as any);

  const result = await controller.map({ id: "user-1" } as any);

  assert.deepEqual(findManyInput.orderBy, [
    { loggedAt: "desc" },
    { id: "desc" },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, true);
  assert.deepEqual(
    result.points.map((point) => [
      point.id,
      point.sequence,
      point.sequenceTotal,
    ]),
    [
      ["log-2", 2, 3],
      ["log-3", 3, 3],
    ],
  );
  assert.equal(result.points[0]?.gcCode, "GC123");
  assert.equal(result.points[0]?.cacheName, "Journey cache");
});
