const WEAK_VALUES = new Set(["", "change-me-in-production", "geostats", "geostats-secret"]);
const REQUIRED_RUNTIME_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "WEB_ORIGIN",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY"
];

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  if (process.env.NODE_ENV === "production" && WEAK_VALUES.has(value)) {
    throw new Error(`${name} must not use a development value in production`);
  }
  return value;
}

export function integerEnvOrDefault(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return fallback;
  }
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

export function validateRuntimeEnv() {
  for (const name of REQUIRED_RUNTIME_ENV) {
    requiredEnv(name);
  }
  integerEnvOrDefault("API_PORT", 3001);
}

export function envOrDefault(name: string, fallback: string): string {
  const configured = process.env[name]?.trim();
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error(`${name} must be set in production`);
  }
  const value = configured || fallback;
  if (process.env.NODE_ENV === "production" && WEAK_VALUES.has(value)) {
    throw new Error(`${name} must not use a development value in production`);
  }
  return value;
}
