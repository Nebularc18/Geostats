import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootConfig = require("../app.config.js").expo;
const mobileConfig = require("../apps/mobile/app.config.js").expo;
const eas = require("../eas.json");

for (const field of ["name", "slug", "version", "scheme"]) {
  assert.equal(
    rootConfig[field],
    mobileConfig[field],
    `Expo config mismatch for ${field}`,
  );
}

assert.equal(
  rootConfig.android?.package,
  mobileConfig.android?.package,
  "Expo config mismatch for android.package",
);
assert.equal(
  rootConfig.extra?.eas?.projectId,
  mobileConfig.extra?.eas?.projectId,
  "Expo config mismatch for extra.eas.projectId",
);
assert.deepEqual(
  rootConfig.runtimeVersion,
  mobileConfig.runtimeVersion,
  "Expo config mismatch for runtimeVersion",
);
assert.deepEqual(
  rootConfig.updates,
  mobileConfig.updates,
  "Expo config mismatch for updates",
);
assert.equal(
  eas.build.preview?.environment,
  "preview",
  "Preview builds must use the preview EAS environment",
);
assert.equal(
  eas.build.production?.environment,
  "production",
  "Production builds must use the production EAS environment",
);
assert.equal(
  eas.build.preview?.channel,
  "preview",
  "Preview builds must target the preview update channel",
);
assert.equal(
  eas.build.preview?.credentialsSource,
  "remote",
  "Preview builds must reuse the EAS-managed signing identity",
);
assert.equal(
  eas.build.preview?.autoIncrement,
  true,
  "Preview builds must increment the Android version code for in-place updates",
);
assert.equal(
  eas.build.production?.channel,
  "production",
  "Production builds must target the production update channel",
);
assert.match(
  rootConfig.version,
  /^\d+\.\d+\.\d+$/,
  "Mobile version must use X.Y.Z format",
);

console.log(
  `Mobile release configuration is consistent (v${rootConfig.version}).`,
);
