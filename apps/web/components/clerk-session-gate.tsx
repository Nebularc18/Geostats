"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiFetch, setStatsSummaryAccount } from "../lib/api";

type GateState = "waiting" | "ready" | "error";
type PendingMigration = { sessionId: string; submit: (password: string) => void };

let sessionSyncQueue: Promise<void> = Promise.resolve();

function enqueueSessionSync<T>(task: () => Promise<T>) {
  const next = sessionSyncQueue.then(task, task);
  sessionSyncQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export function ClerkSessionGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, sessionId, userId } = useAuth();
  const clerk = useClerk();
  const [state, setState] = useState<GateState>("waiting");
  const [syncedSessionId, setSyncedSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingMigration, setPendingMigration] = useState<PendingMigration | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }
    const clerkUserId = userId;
    const clerkSessionId = sessionId;
    setPendingMigration(null);
    setMigrationBusy(false);
    if (!isSignedIn || !clerkUserId || !clerkSessionId) {
      let active = true;
      setStatsSummaryAccount(null);
      setState("waiting");
      setErrorMessage(null);
      void enqueueSessionSync(async () => {
        if (!active) return;
        await apiFetch("/auth/logout", { method: "POST" });
      })
        .then(() => {
          if (!active) return;
          setSyncedSessionId(null);
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
    if (syncedSessionId === clerkSessionId) {
      setState("ready");
      return;
    }

    const activeSessionId = clerkSessionId;
    let active = true;
    let migrationInFlight = false;
    const isCurrent = () => active && clerk.session?.id === activeSessionId;
    setState("waiting");
    setErrorMessage(null);

    function submitMigration(password: string) {
      if (!isCurrent() || migrationInFlight) return;
      migrationInFlight = true;
      setMigrationBusy(true);
      setErrorMessage(null);
      void enqueueSessionSync(() => synchronizeSession(password)).finally(() => {
        if (isCurrent()) {
          migrationInFlight = false;
          setMigrationBusy(false);
        }
      });
    }

    async function synchronizeSession(migrationPassword?: string) {
      try {
        if (!isCurrent()) return;
        if (migrationPassword === undefined) {
          await apiFetch("/auth/logout", { method: "POST" });
        }
        const currentSession = clerk.session;
        if (!active || currentSession?.id !== activeSessionId) return;
        const token = await currentSession.getToken();
        if (!token) {
          throw new Error("Clerk did not return a session token");
        }
        if (!isCurrent()) return;
        const exchanged = await apiFetch<{ user?: { id?: unknown } }>("/auth/clerk/exchange", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          ...(migrationPassword === undefined ? {} : {
            body: JSON.stringify({ migrationPassword }),
            redirect: "error"
          })
        });
        if (isCurrent()) {
          setStatsSummaryAccount(typeof exchanged.user?.id === "string" ? exchanged.user.id : clerkUserId);
          setPendingMigration(null);
          setSyncedSessionId(activeSessionId);
          setState("ready");
        }
      } catch (error) {
        if (!isCurrent()) return;
        if (error instanceof ApiError && error.code === "CLERK_MIGRATION_REQUIRED") {
          setPendingMigration({ sessionId: activeSessionId, submit: submitMigration });
          setErrorMessage(migrationPassword === undefined ? null : error.message);
        } else if (migrationPassword !== undefined) {
          setErrorMessage("Could not link your account. Try again.");
        } else {
          setErrorMessage("Could not connect your Clerk session");
          setState("error");
        }
      }
    }

    void enqueueSessionSync(synchronizeSession);
    return () => {
      active = false;
    };
  }, [clerk, isLoaded, isSignedIn, sessionId, syncedSessionId, userId]);

  const sessionIsSynchronized =
    state === "ready" &&
    isLoaded &&
    ((isSignedIn && Boolean(sessionId) && syncedSessionId === sessionId) || (!isSignedIn && !userId && syncedSessionId === null));

  const migration = isSignedIn && pendingMigration?.sessionId === sessionId ? pendingMigration : null;
  if (migration) {
    const { submit: submitMigration } = migration;
    function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      const password = new FormData(event.currentTarget).get("migrationPassword");
      event.currentTarget.reset();
      if (typeof password === "string") submitMigration(password);
    }

    return (
      <main className="auth-page">
        <section className="auth-panel">
          <h1>Link your Geostats account</h1>
          <p className="muted">Enter the password you used for Geostats before moving to Clerk.</p>
          <form className="form" method="post" onSubmit={submit} key={migration.sessionId}>
            <label>
              Previous Geostats password
              <input name="migrationPassword" type="password" autoComplete="off" disabled={migrationBusy} />
            </label>
            {errorMessage ? <p className="error" role="alert">{errorMessage}</p> : null}
            <button className="primary-button" type="submit" disabled={migrationBusy}>
              {migrationBusy ? "Linking..." : "Link account"}
            </button>
            <button className="secondary-button" type="button" disabled={migrationBusy} onClick={() => {
              void clerk.signOut({ redirectUrl: "/login" }).catch(() => setErrorMessage("Could not sign out. Try again."));
            }}>
              Sign out
            </button>
          </form>
        </section>
      </main>
    );
  }

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
