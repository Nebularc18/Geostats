"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type GateState = "waiting" | "ready" | "error";

export function ClerkSessionGate({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const [state, setState] = useState<GateState>("waiting");
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    const clerkUserId = userId;
    if (!isSignedIn || !clerkUserId) {
      setSyncedUserId(null);
      setState("ready");
      return;
    }
    if (syncedUserId === clerkUserId) {
      setState("ready");
      return;
    }

    let active = true;

    async function synchronizeSession() {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Clerk did not return a session token");
        }
        await apiFetch("/auth/clerk/exchange", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        });
        if (active) {
          setSyncedUserId(clerkUserId);
          setState("ready");
        }
      } catch {
        if (active) {
          setState("error");
        }
      }
    }

    void synchronizeSession();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, syncedUserId, userId]);

  if (state === "error") {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Geocaching statistics</p>
          <h1>Could not connect your Clerk session</h1>
          <p className="muted">Check the API Clerk keys and try signing in again.</p>
        </section>
      </main>
    );
  }

  if (state !== "ready") {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Geocaching statistics</p>
          <p className="muted">Connecting your Clerk session...</p>
        </section>
      </main>
    );
  }

  return children;
}
