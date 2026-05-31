"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Database, Flag, Globe2, Home, Map, Settings, Trophy, Upload } from "lucide-react";
import { apiFetch } from "../lib/api";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileChecked, setProfileChecked] = useState(false);

  useEffect(() => {
    let active = true;

    void apiFetch<{ profile: any }>("/profile")
      .then((data) => {
        if (!active) {
          return;
        }
        if (!data.profile && pathname !== "/onboarding") {
          router.replace("/onboarding");
          return;
        }
        setProfileChecked(true);
      })
      .catch(() => {
        if (active) {
          router.replace("/login");
        }
      });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" });
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
      </aside>
      <main className="content">{profileChecked ? children : null}</main>
    </div>
  );
}
