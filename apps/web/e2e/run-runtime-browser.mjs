import { spawnSync } from "node:child_process";

// Build without deployment configuration, even if the caller has it exported.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !name.startsWith("NEXT_PUBLIC_") && name !== "CLERK_SECRET_KEY"
));
for (const args of [
  ["--filter", "@geostats/shared", "build"],
  ["build"],
  ["exec", "playwright", "test", "--config", "e2e/runtime.config.mjs"]
]) {
  const result = spawnSync("corepack", ["pnpm", ...args], { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
