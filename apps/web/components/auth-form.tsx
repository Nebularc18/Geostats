"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div>
          <p className="eyebrow">Geocaching statistics</p>
          <h1>{mode === "login" ? "Welcome back" : "Create your local account"}</h1>
          <p className="muted">
            Import My Finds GPX files, keep ownership per user, and build a private statistics archive.
          </p>
        </div>
        <form onSubmit={submit} className="form">
          {mode === "register" ? (
            <label>
              Username
              <input name="username" required minLength={3} />
            </label>
          ) : null}
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required minLength={8} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? "Working..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="muted">
          {mode === "login" ? "No account yet? " : "Already have an account? "}
          <Link href={mode === "login" ? "/register" : "/login"}>
            {mode === "login" ? "Register" : "Sign in"}
          </Link>
        </p>
      </section>
    </main>
  );
}
