"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

type GateState = "waiting" | "ready" | "error";

export function ClerkSessionGate({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const [state, setState] = useState<GateState>("waiting");
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    const clerkUserId = userId;
    if (!isSignedIn || !clerkUserId) {
      let active = true;
      setState("waiting");
      setErrorMessage(null);
      void apiFetch("/auth/logout", { method: "POST" })
        .then(() => {
          if (!active) return;
          setSyncedUserId(null);
          setState("ready");
        })
        .catch(() => {
          if (!active) return;
          setErrorMessage("Could not clear your local session");
          setState("error");
        });
      return () => {
        active = false;
      };
    }
    if (syncedUserId === clerkUserId) {
      setState("ready");
      return;
    }

    let active = true;
    setState("waiting");
    setErrorMessage(null);

    async function synchronizeSession() {
      try {
        await apiFetch("/auth/logout", { method: "POST" });
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
          setErrorMessage("Could not connect your Clerk session");
          setState("error");
        }
      }
    }

    void synchronizeSession();
    return () => {
      active = false;
    };
  }, [getToken, isLoaded, isSignedIn, syncedUserId, userId]);

  const sessionIsSynchronized =
    state === "ready" &&
    isLoaded &&
    ((isSignedIn && Boolean(userId) && syncedUserId === userId) || (!isSignedIn && !userId && syncedUserId === null));

  if (state === "error") {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">Geocaching statistics</p>
          <h1>{errorMessage ?? "Could not connect your Clerk session"}</h1>
          <p className="muted">
            {errorMessage === "Could not clear your local session"
              ? "Try again when the API is available."
              : "Check the API Clerk keys and try signing in again."}
          </p>
        </section>
      </main>
    );
  }

  if (!sessionIsSynchronized) {
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
