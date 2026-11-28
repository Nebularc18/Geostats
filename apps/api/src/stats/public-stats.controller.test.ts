import assert from "node:assert/strict";
import test from "node:test";
import { HEADERS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { PublicStatsController } from "./public-stats.controller";
import { StatsController } from "./stats.controller";

test("public profile images allow embedding on other websites", () => {
  for (const handler of [
    PublicStatsController.prototype.profileStatsImage,
    PublicStatsController.prototype.profileExtremesImage,
    PublicStatsController.prototype.profileScratchMapImage
  ]) {
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{
      name: string;
      value: string;
    }>;
    assert.equal(
      headers.find((header) => header.name === "Cross-Origin-Resource-Policy")?.value,
      "cross-origin"
    );
  }
});

test("public profile responses are never cached after consent is revoked", () => {
  for (const handler of [
    PublicStatsController.prototype.profileStats,
    PublicStatsController.prototype.profileStatsImage,
    PublicStatsController.prototype.profileExtremesImage,
    PublicStatsController.prototype.profileScratchMapImage
  ]) {
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{
      name: string;
      value: string;
    }>;
    assert.equal(headers.find((header) => header.name === "Cache-Control")?.value, "no-store");
  }
});

test("public HTML profile responses disallow script execution", () => {
  const headers = Reflect.getMetadata(
    HEADERS_METADATA,
    PublicStatsController.prototype.profileStats
  ) as Array<{ name: string; value: string }>;

  const policy = headers.find((header) => header.name === "Content-Security-Policy")?.value;
  assert.match(policy ?? "", /default-src 'none'/);
  assert.doesNotMatch(policy ?? "", /script-src|https:/);
});

test("generated SVG responses are sandboxed as standalone documents", () => {
  for (const handler of [
    PublicStatsController.prototype.profileStatsImage,
    PublicStatsController.prototype.profileExtremesImage,
    PublicStatsController.prototype.profileScratchMapImage,
    StatsController.prototype.scratchMapImage,
  ]) {
    const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{ name: string; value: string }>;
    const policy = headers.find((header) => header.name === "Content-Security-Policy")?.value;
    assert.match(policy ?? "", /default-src 'none'; sandbox;/);
    assert.doesNotMatch(policy ?? "", /allow-scripts|allow-same-origin/);
  }
});

test("every published asset offers a profile ID route and a legacy alias route", () => {
  const endpoints = {
    profileStats: "profile-stats",
    profileStatsImage: "profile-stats-image",
    profileExtremesImage: "profile-extremes-image",
    profileScratchMapImage: "profile-scratch-map-image"
  } as const;

  for (const [method, path] of Object.entries(endpoints)) {
    assert.deepEqual(Reflect.getMetadata(PATH_METADATA, PublicStatsController.prototype[method as keyof typeof endpoints]), [
      `${path}/:username`, `${path}/by-id/:profileId`
    ]);
  }
});

test("published HTML points to the same profile's stable scratch map link", async () => {
  const controller = new PublicStatsController({
    publicSnapshotForLink: async (username?: string, profileId?: string) => {
      assert.equal(username, "legacy-name");
      assert.equal(profileId, undefined);
      return { profile: { id: "stable-profile-id", gcUsername: "Current name" }, stats: {} };
    }
  } as never);

  const html = await controller.profileStats("legacy-name");
  assert.match(html, /src="\/public\/profile-scratch-map-image\/by-id\/stable-profile-id"/);
});
