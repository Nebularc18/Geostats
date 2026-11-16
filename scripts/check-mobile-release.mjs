import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootConfig = require("../app.config.js").expo;
const eas = require("../eas.json");

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

// Expo and Clerk may resolve nested peer dependencies instead of the root copy.
// React DOM validates exact React versions when imported, including native startup.
const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expoRuntimeVersions = mobileRequire("expo/bundledNativeModules.json");
const runtimeScopes = [
  ["workspace root", require],
  ["mobile app", mobileRequire],
  ...["expo", "@clerk/expo"].map((name) => [name, createRequire(mobileRequire.resolve(name))])
];
for (const [scope, scopedRequire] of runtimeScopes) {
  const reactVersion = scopedRequire("react/package.json").version;
  const rendererVersion = scopedRequire("react-dom/package.json").version;
  assert.equal(reactVersion, expoRuntimeVersions.react, `${scope} must use the React version required by this Expo SDK.`);
  assert.equal(rendererVersion, reactVersion, `${scope} resolves React ${reactVersion} and React DOM ${rendererVersion}. Native startup requires identical versions.`);
  scopedRequire("react-dom/client");
}

console.log(
  `Mobile release configuration is consistent (v${rootConfig.version}).`,
);
