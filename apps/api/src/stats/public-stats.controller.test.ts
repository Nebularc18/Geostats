import assert from "node:assert/strict";
import test from "node:test";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { PublicStatsController } from "./public-stats.controller";

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
