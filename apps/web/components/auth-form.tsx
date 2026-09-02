"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignIn, SignUp } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { API_URL, apiFetch } from "../lib/api";

type AuthMode = "dev" | "clerk" | "password";
type AuthConfig = {
  mode: AuthMode;
  providerName: string;
};

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const action = mode === "login" ? "Sign in" : "Create account";
  const authMode = config?.mode;
  const isDevMode = authMode === "dev";
  const isClerkMode = authMode === "clerk";
  const clerkIsConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<AuthConfig>("/auth/config")
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({
            mode: (process.env.NEXT_PUBLIC_AUTH_MODE as AuthMode | undefined) ?? (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? "clerk" : "password"),
            providerName: process.env.NEXT_PUBLIC_AUTH_PROVIDER_NAME ?? "Clerk"
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
          <h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted">
            Import My Finds GPX files, keep ownership per user, and build a private statistics archive.
          </p>
        </div>
        {!config ? (
          <p className="muted">Loading sign-in options...</p>
        ) : isDevMode ? (
          <a className="primary-button oauth-button" href={`${API_URL}/auth/dev`}>
            <LogIn aria-hidden="true" size={18} />
            Continue in dev mode
          </a>
        ) : isClerkMode ? (
          clerkIsConfigured ? (
            <div className="clerk-auth-card">
              {mode === "login" ? (
                <SignIn
                  routing="path"
                  path="/login"
                  signUpUrl="/register"
                  fallbackRedirectUrl="/dashboard"
                />
              ) : (
                <SignUp
                  routing="path"
                  path="/register"
                  signInUrl="/login"
                  fallbackRedirectUrl="/onboarding"
                />
              )}
            </div>
          ) : (
            <div className="auth-setup-card">
              <h2>Clerk is selected</h2>
              <p className="muted">
                Add <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> to the web app and <code>CLERK_SECRET_KEY</code> to the API to enable sign-in.
              </p>
            </div>
          )
        ) : (
          <>
            <form onSubmit={submit} className="form">
              {mode === "register" ? (
                <label>
                  Username
                  <input name="username" required minLength={3} autoComplete="username" />
                </label>
              ) : null}
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </label>
              {error ? <p className="error">{error}</p> : null}
              <button className="primary-button" disabled={loading} type="submit">
                {loading ? "Working..." : action}
              </button>
            </form>
            <p className="muted">
              {mode === "login" ? "No account yet? " : "Already have an account? "}
              <Link href={mode === "login" ? "/register" : "/login"}>
                {mode === "login" ? "Register" : "Sign in"}
              </Link>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
