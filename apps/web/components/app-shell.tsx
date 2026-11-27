"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Compass,
  Database,
  Home,
  LogOut,
  Map,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sun,
  Users
} from "lucide-react";
import { API_URL, apiFetch, invalidateStatsSummaryCache, setStatsSummaryAccount } from "../lib/api";
import { ClerkSignOutButton } from "./clerk-sign-out-button";
import { CommandPalette } from "./command-palette";
import { GlobalDropImport } from "./global-drop-import";
import { getPublicRuntimeConfig, isClerkEnabled } from "../lib/runtime-config";

type SubTab = { href: string; label: string; adminOnly?: boolean };
type Workspace = {
  id: string;
  href: string;
  label: string;
  icon: typeof Home;
  tabs?: SubTab[];
};

const workspaces: Workspace[] = [
  { id: "dashboard", href: "/dashboard", label: "Dashboard", icon: Home },
  {
    id: "map",
    href: "/map",
    label: "Map",
    icon: Map,
    tabs: [
      { href: "/map", label: "Spatial Map" },
      { href: "/scratch", label: "Scratch Map" },
      { href: "/travel", label: "Travel Planner" }
    ]
  },
  {
    id: "stats",
    href: "/stats",
    label: "Stats",
    icon: BarChart3,
    tabs: [
      { href: "/stats", label: "Overview" },
      { href: "/logbook", label: "Logbook" },
      { href: "/goals", label: "Goals" },
      { href: "/milestones", label: "Milestones" },
      { href: "/ftf", label: "FTF" },
      { href: "/profile-html", label: "Profile HTML" }
    ]
  },
  {
    id: "field",
    href: "/mysteries",
    label: "Field",
    icon: Compass,
    tabs: [
      { href: "/mysteries", label: "Mysteries" },
      { href: "/challenge-checkers", label: "Challenge Checkers" },
      { href: "/trackables", label: "Trackables" }
    ]
  },
  {
    id: "community",
    href: "/hides",
    label: "Community",
    icon: Users,
    tabs: [
      { href: "/hides", label: "Hides & Maintenance" },
      { href: "/friends", label: "Friends" }
    ]
  },
  {
    id: "data",
    href: "/upload",
    label: "Data & Account",
    icon: Database,
    tabs: [
      { href: "/upload", label: "Upload" },
      { href: "/imports", label: "Imports" },
      { href: "/settings/profile", label: "Profile" },
      { href: "/admin", label: "Admin", adminOnly: true }
    ]
  }
];

function workspaceForPath(pathname: string): Workspace | null {
  for (const workspace of workspaces) {
    if (pathname === workspace.href || pathname.startsWith(`${workspace.href}/`)) {
      return workspace;
    }
    if (workspace.tabs?.some((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))) {
      return workspace;
    }
  }
  return null;
}

let hasCompletedProfileCheck = false;

const RUNTIME_CONFIG = getPublicRuntimeConfig();
const DEV_AUTO_LOGIN = RUNTIME_CONFIG.devAutoLogin;
const DEV_OFFLINE = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_OFFLINE === "true";
const DEV_AUTO_LOGIN_ATTEMPT_KEY = "geostats_dev_auto_login_attempted";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "geostats_sidebar_collapsed";
const THEME_STORAGE_KEY = "geostats_theme";
const CLERK_ENABLED = isClerkEnabled(RUNTIME_CONFIG);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profileChecked, setProfileChecked] = useState(hasCompletedProfileCheck || DEV_OFFLINE);
  const [adminAccess, setAdminAccess] = useState(DEV_OFFLINE);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(() => workspaceForPath(pathname)?.id ?? null);
  const [freshness, setFreshness] = useState<{ label: string; stale: boolean } | null>(null);

  useEffect(() => {
    const activeId = workspaceForPath(pathname)?.id ?? null;
    if (activeId) {
      setExpandedWorkspaceId(activeId);
    }
  }, [pathname]);

  useEffect(() => {
    if (DEV_OFFLINE) return;
    let active = true;
    let pollTimer: number | undefined;
    let pollFailures = 0;
    let wasSyncing = false;
    let requestSeq = 0;
    type ImportRecord = { status: string; finishedAt?: string | null; createdAt?: string | null };
    const fetchFreshness = () => {
      const seq = ++requestSeq;
      void apiFetch<ImportRecord[] | { imports?: ImportRecord[] }>("/imports")
        .then((res) => {
          if (!active || seq !== requestSeq) return;
          pollFailures = 0;
          const items = Array.isArray(res) ? res : (res?.imports ?? []);
          const pending = items.find((item) => item.status === "QUEUED" || item.status === "PROCESSING");
          if (pending) {
            wasSyncing = true;
            setFreshness({ label: "Syncing import…", stale: false });
            window.clearTimeout(pollTimer);
            pollTimer = window.setTimeout(fetchFreshness, 4000);
            return;
          }
          wasSyncing = false;
          const completed = items.find((item) => item.status === "COMPLETED");
          const stamp = completed?.finishedAt ?? completed?.createdAt ?? null;
          if (!stamp) {
            setFreshness({ label: "No imports yet", stale: true });
            return;
          }
          const days = Math.floor((Date.now() - new Date(stamp).getTime()) / (1000 * 60 * 60 * 24));
          if (!Number.isFinite(days) || days <= 0) {
            setFreshness({ label: "Synced today", stale: false });
          } else if (days <= 14) {
            setFreshness({ label: `Synced ${days}d ago`, stale: false });
          } else {
            setFreshness({ label: `Needs sync (${days}d)`, stale: true });
          }
        })
        .catch(() => {
          if (!active || seq !== requestSeq || !wasSyncing) return;
          pollFailures += 1;
          if (pollFailures <= 3) {
            window.clearTimeout(pollTimer);
            pollTimer = window.setTimeout(fetchFreshness, 6000);
          } else {
            wasSyncing = false;
            setFreshness({ label: "Check imports", stale: true });
          }
        });
    };
    fetchFreshness();
    const onImportsUpdated = () => {
      wasSyncing = true;
      pollFailures = 0;
      fetchFreshness();
    };
    window.addEventListener("geostats:imports-updated", onImportsUpdated);
    return () => {
      active = false;
      window.clearTimeout(pollTimer);
      window.removeEventListener("geostats:imports-updated", onImportsUpdated);
    };
  }, []);

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true");
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCmdkOpen((current) => {
          if (!current && document.querySelector('[role="dialog"][aria-modal="true"]')) {
            return false;
          }
          return !current;
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (DEV_OFFLINE) return;

    let active = true;
    void apiFetch<{ isAdmin: boolean }>("/admin/access")
      .then((data) => { if (active) setAdminAccess(data.isAdmin); })
      .catch(() => { if (active) setAdminAccess(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (DEV_OFFLINE) {
      hasCompletedProfileCheck = true;
      setProfileChecked(true);
      return;
    }
    if (hasCompletedProfileCheck) return;

    let active = true;
    void apiFetch<{ profile: any }>("/profile")
      .then((data) => {
        if (!active) return;
        setStatsSummaryAccount(typeof data.profile?.userId === "string" ? data.profile.userId : null);
        if (!data.profile) {
          if (pathname === "/admin" || pathname.startsWith("/admin/")) {
            void apiFetch<{ isAdmin: boolean }>("/admin/access")
              .then((access) => {
                if (!active) return;
                if (!access.isAdmin) { router.replace("/onboarding"); return; }
                setProfileChecked(true);
              })
              .catch(() => { if (active) router.replace("/login"); });
            return;
          }
          router.replace("/onboarding");
          return;
        }
        sessionStorage.removeItem(DEV_AUTO_LOGIN_ATTEMPT_KEY);
        hasCompletedProfileCheck = true;
        setProfileChecked(true);
      })
      .catch(() => {
        if (!active) return;
        if (DEV_AUTO_LOGIN) {
          void apiFetch<{ mode: string }>("/auth/config")
            .then((config) => {
              if (!active) return;
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

    return () => { active = false; };
  }, [pathname, router]);

  async function clearLocalSession() {
    invalidateStatsSummaryCache();
    setStatsSummaryAccount(null);
    if (DEV_OFFLINE) return;
    await apiFetch("/auth/logout", { method: "POST" });
    hasCompletedProfileCheck = false;
  }

  async function logout() {
    await clearLocalSession();
    router.push("/login");
  }

  function toggleSidebar() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(nextCollapsed));
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }

  const activeWorkspace = workspaceForPath(pathname);
  const visibleTabs = activeWorkspace?.tabs?.filter((tab) => !tab.adminOnly || adminAccess) ?? [];

  return (
    <div className={`shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-header">
          <Link className="brand" href="/dashboard" aria-label="Geostats dashboard">
            <img className="brand-mark" src="/geostats-icon.svg" alt="" aria-hidden="true" />
            <span>
              <strong>Geostats</strong>
              <small>Local-first cache analytics</small>
            </span>
          </Link>
          <button
            className="sidebar-toggle"
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-controls="primary-navigation"
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        </div>

        <button
          type="button"
          className="sidebar-search-btn"
          onClick={() => setCmdkOpen(true)}
          aria-label="Open command palette"
          title="Quick search (Ctrl+K / ⌘K)"
        >
          <span>
            <Search size={15} aria-hidden="true" />
            {!sidebarCollapsed ? "Quick search…" : null}
          </span>
          {!sidebarCollapsed ? <kbd>⌘K</kbd> : null}
        </button>

        <nav id="primary-navigation" aria-label="Primary">
          <p className="nav-group-label">{!sidebarCollapsed ? "Workspaces" : ""}</p>
          {workspaces.map((workspace) => {
            const Icon = workspace.icon;
            const NavigationLink = workspace.href === "/mysteries" ? "a" : Link;
            const active = activeWorkspace?.id === workspace.id;
            const subTabs = workspace.tabs?.filter((tab) => !tab.adminOnly || adminAccess) ?? [];
            const hasSubTabs = subTabs.length > 1;
            const isExpanded = !sidebarCollapsed && hasSubTabs && expandedWorkspaceId === workspace.id;
            return (
              <div key={workspace.id} className="sidebar-workspace-item">
                <div className="sidebar-workspace-row">
                  <NavigationLink
                    className={active ? "active" : ""}
                    href={workspace.href}
                    aria-label={workspace.label}
                    aria-current={pathname === workspace.href ? "page" : undefined}
                    title={sidebarCollapsed ? workspace.label : undefined}
                    onClick={() => {
                      if (hasSubTabs) {
                        setExpandedWorkspaceId((current) =>
                          active && current === workspace.id ? null : workspace.id
                        );
                      }
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="nav-label">{workspace.label}</span>
                  </NavigationLink>
                  {!sidebarCollapsed && hasSubTabs ? (
                    <button
                      type="button"
                      className="sidebar-expand-btn"
                      aria-label={isExpanded ? `Collapse ${workspace.label} menu` : `Expand ${workspace.label} menu`}
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedWorkspaceId((current) => (current === workspace.id ? null : workspace.id))}
                    >
                      {isExpanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                    </button>
                  ) : null}
                </div>
                {isExpanded ? (
                  <div className="sidebar-submenu" role="group" aria-label={`${workspace.label} pages`}>
                    {subTabs.map((tab) => {
                      const TabLink = tab.href === "/mysteries" ? "a" : Link;
                      const isTabActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                      return (
                        <TabLink
                          key={tab.href}
                          href={tab.href}
                          className={isTabActive ? "active" : ""}
                          aria-current={isTabActive ? "page" : undefined}
                        >
                          {tab.label}
                        </TabLink>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        {freshness ? (
          <Link
            href="/upload"
            className={`sidebar-freshness-pill${freshness.stale ? " stale" : ""}`}
            title={`${freshness.label} — click to import a fresh GPX or ZIP`}
          >
            <span className="freshness-dot" aria-hidden="true" />
            <span>{freshness.label}</span>
          </Link>
        ) : null}

        <div className="sidebar-footer-actions">
          <button
            className="ghost-button"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            <span className="nav-label">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
          </button>
          {!DEV_OFFLINE &&
            (CLERK_ENABLED ? (
              <ClerkSignOutButton collapsed={sidebarCollapsed} onLocalLogout={clearLocalSession} />
            ) : (
              <button
                className="ghost-button"
                type="button"
                onClick={() => void logout()}
                aria-label="Sign out"
                title={sidebarCollapsed ? "Sign out" : undefined}
              >
                <LogOut size={17} aria-hidden="true" />
                <span className="nav-label">Sign out</span>
              </button>
            ))}
        </div>
        <p className="sidebar-attribution">Inspired by Project-GC</p>
      </aside>

      <main className="content">
        {visibleTabs.length > 1 ? (
          <div className="ds-subnav" role="navigation" aria-label={`${activeWorkspace?.label} sections`}>
            {visibleTabs.map((tab) => {
              const TabLink = tab.href === "/mysteries" ? "a" : Link;
              const isTabActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <TabLink
                  key={tab.href}
                  href={tab.href}
                  className={isTabActive ? "active" : ""}
                  aria-current={isTabActive ? "page" : undefined}
                >
                  {tab.label}
                </TabLink>
              );
            })}
          </div>
        ) : null}
        {profileChecked ? children : null}
      </main>

      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
      <GlobalDropImport onOpen={() => setCmdkOpen(false)} />
    </div>
  );
}
