const WEAK_VALUES = new Set(["", "change-me-in-production", "geostats", "geostats-secret"]);

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
