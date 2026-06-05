const WEAK_VALUES = new Set(["", "change-me-in-production", "geostats", "geostats-secret"]);
const PLACEHOLDER_PATTERN = /(?:^|[/:@?=])replace-with-[a-z0-9-]+(?:$|[/?@:])/i;
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const REQUIRED_RUNTIME_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
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
  if (process.env.NODE_ENV === "production") {
    validateProductionValue(name, value);
  }
  return value;
}

export function optionalPositiveIntegerEnv(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return fallback;
  }
  const value = Number(configured);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function validateRuntimeEnv() {
  for (const name of REQUIRED_RUNTIME_ENV) {
    requiredEnv(name);
  }
  optionalPositiveIntegerEnv("IMPORT_WORKER_CONCURRENCY", 2);
}

export function envOrDefault(name: string, fallback: string): string {
  const configured = process.env[name]?.trim();
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error(`${name} must be set in production`);
  }
  const value = configured || fallback;
  if (process.env.NODE_ENV === "production") {
    validateProductionValue(name, value);
  }
  return value;
}

function validateProductionValue(name: string, value: string) {
  if (WEAK_VALUES.has(value) || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${name} must not use a development value in production`);
  }
  if (isSecretEnv(name) && value.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(`${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
  }
}

function isSecretEnv(name: string): boolean {
  return /(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY)$/i.test(name);
}
