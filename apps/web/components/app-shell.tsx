"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Database, Flag, Globe2, Home, Map, Settings, Trophy, Upload } from "lucide-react";
import { API_URL, apiFetch } from "../lib/api";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/imports", label: "Imports", icon: Database },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/ftf", label: "FTF", icon: Trophy },
  { href: "/hides", label: "Hides", icon: Flag },
  { href: "/milestones", label: "Milestones", icon: Flag },
  { href: "/map", label: "Map", icon: Map },
  { href: "/scratch", label: "Scratch Map", icon: Globe2 },
  { href: "/settings/profile", label: "Profile", icon: Settings }
];

let hasCompletedProfileCheck = false;

const DEV_AUTO_LOGIN = process.env.NEXT_PUBLIC_DEV_AUTO_LOGIN === "true";
const DEV_AUTO_LOGIN_ATTEMPT_KEY = "geostats_dev_auto_login_attempted";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileChecked, setProfileChecked] = useState(hasCompletedProfileCheck);

  useEffect(() => {
    if (hasCompletedProfileCheck) {
      return;
    }

    let active = true;

    void apiFetch<{ profile: any }>("/profile")
      .then((data) => {
        if (!active) {
          return;
        }
        if (!data.profile) {
          router.replace("/onboarding");
          return;
        }
        hasCompletedProfileCheck = true;
        setProfileChecked(true);
      })
      .catch(() => {
        if (!active) {
          return;
        }
        if (DEV_AUTO_LOGIN) {
          void apiFetch<{ mode: string }>("/auth/config")
            .then((config) => {
              if (!active) {
                return;
              }
              if (config.mode === "dev") {
                if (sessionStorage.getItem(DEV_AUTO_LOGIN_ATTEMPT_KEY) === "true") {
                  sessionStorage.removeItem(DEV_AUTO_LOGIN_ATTEMPT_KEY);
                  router.replace("/login");
                  return;
                }
                sessionStorage.setItem(DEV_AUTO_LOGIN_ATTEMPT_KEY, "true");
                const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                window.location.href = `${API_URL}/auth/dev?returnTo=${encodeURIComponent(returnTo)}`;
                return;
              }
              sessionStorage.removeItem(DEV_AUTO_LOGIN_ATTEMPT_KEY);
              router.replace("/login");
            })
            .catch(() => {
              if (active) {
                sessionStorage.removeItem(DEV_AUTO_LOGIN_ATTEMPT_KEY);
                router.replace("/login");
              }
            });
          return;
        }
        router.replace("/login");
      });

    return () => {
      active = false;
    };
  }, [router]);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
    hasCompletedProfileCheck = false;
    router.push("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <img className="brand-mark" src="/geostats-icon.svg" alt="" aria-hidden="true" />
          <span>
            <strong>Geostats</strong>
            <small>local first cache analytics</small>
          </span>
        </Link>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} className={pathname === item.href ? "active" : ""} href={item.href}>
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button className="ghost-button" type="button" onClick={logout}>
          Sign out
        </button>
        <p className="sidebar-attribution">Inspired by Project-GC</p>
      </aside>
      <main className="content">{profileChecked ? children : null}</main>
    </div>
  );
}
