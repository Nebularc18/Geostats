"use client";

const CONFIGURED_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function apiUrl() {
  if (typeof window === "undefined") {
    return CONFIGURED_API_URL;
  }

  let configured: URL;
  try {
    configured = new URL(CONFIGURED_API_URL);
  } catch {
    return CONFIGURED_API_URL;
  }
  if (configured.hostname === "localhost" && window.location.hostname === "127.0.0.1") {
    configured.hostname = "127.0.0.1";
  }
  return configured.toString().replace(/\/$/, "");
}

export const API_URL = apiUrl();

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? "Request failed");
  }

  return response.json() as Promise<T>;
}
