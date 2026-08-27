import assert from "node:assert/strict";
import test from "node:test";
import { AuthController } from "../auth/auth.controller";
import { HealthController } from "../health/health.controller";
import { StatsController } from "../stats/stats.controller";
import { PublicStatsController } from "../stats/public-stats.controller";
import { APP_THROTTLERS } from "./rate-limits";

const LIMIT_METADATA = "THROTTLER:LIMITdefault";
const SKIP_METADATA = "THROTTLER:SKIPdefault";

test("rate limiting uses one default policy with route-specific overrides", () => {
  assert.deepEqual(APP_THROTTLERS, [{ ttl: 60_000, limit: 100 }]);
  assert.equal(Reflect.getMetadata(LIMIT_METADATA, StatsController.prototype.summary), undefined);
  assert.equal(Reflect.getMetadata(LIMIT_METADATA, AuthController.prototype.login), 5);
  assert.equal(Reflect.getMetadata(LIMIT_METADATA, AuthController.prototype.mobileExchange), 10);
  assert.equal(Reflect.getMetadata(LIMIT_METADATA, PublicStatsController.prototype.profileStats), 20);
  assert.equal(Reflect.getMetadata(LIMIT_METADATA, PublicStatsController.prototype.profileStatsImage), 30);
  assert.equal(Reflect.getMetadata(SKIP_METADATA, HealthController.prototype.health), true);
  assert.equal(Reflect.getMetadata("THROTTLER:LIMITauth", AuthController.prototype.login), undefined);
  assert.equal(Reflect.getMetadata("THROTTLER:LIMITpublic", PublicStatsController.prototype.profileStats), undefined);
});
