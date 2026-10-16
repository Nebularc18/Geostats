export type PublicRuntimeConfig = {
  apiUrl: string;
  authMode: string;
  authProviderName: string;
  clerkPublishableKey: string;
  devAutoLogin: boolean;
};

export const RUNTIME_CONFIG_ID = "geostats-runtime-config";

// Indexed reads keep deployment values out of Next.js build-time substitution.
export function readPublicRuntimeConfig(env: Record<string, string | undefined>): PublicRuntimeConfig {
  const value = (name: string) => env[name]?.trim() ?? "";
  return {
    apiUrl: (value("NEXT_PUBLIC_API_URL") || "http://localhost:3001").replace(/\/$/, ""),
    authMode: value("NEXT_PUBLIC_AUTH_MODE") || "clerk",
    authProviderName: value("NEXT_PUBLIC_AUTH_PROVIDER_NAME") || "Clerk",
    clerkPublishableKey: value("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
    devAutoLogin: value("NEXT_PUBLIC_DEV_AUTO_LOGIN") === "true"
  };
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  if (typeof document !== "undefined") {
    const json = document.getElementById(RUNTIME_CONFIG_ID)?.textContent;
    if (json) return JSON.parse(json) as PublicRuntimeConfig;
  }
  return readPublicRuntimeConfig(process.env);
}

export function isClerkEnabled(config: PublicRuntimeConfig): boolean {
  return Boolean(config.clerkPublishableKey) && config.authMode !== "password" && config.authMode !== "dev";
}

export function serializePublicRuntimeConfig(config: PublicRuntimeConfig): string {
  // Escape HTML delimiters so a configuration value cannot close the script tag.
  return JSON.stringify(config).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
