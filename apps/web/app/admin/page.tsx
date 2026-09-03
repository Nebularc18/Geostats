"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  HardDrive,
  ListFilter,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  ScrollText,
  Users as UsersIcon,
} from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { StatCard } from "../../components/stat-card";
import { apiFetch } from "../../lib/api";

type ServiceKey = "database" | "importQueue" | "objectStorage";
type ServiceState = "ok" | "unhealthy";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt?: string;
  profile: { gcUsername: string } | null;
  _count: {
    finds: number;
    hides: number;
    imports: number;
    trackables?: number;
  };
};

type AdminImport = {
  id: string;
  fileName: string;
  fileType: string;
  source: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  user: { username: string; email: string };
  _count: { finds: number; hides: number };
};

type AdminOverview = {
  generatedAt: string;
  metrics: {
    users: number;
    profiles: number;
    caches: number;
    finds: number;
    hides: number;
    trackables: number;
    challengeCheckers: number;
    mysteries: number;
    importsLastSevenDays: number;
  };
  imports: {
    byStatus: Record<string, number>;
    failed: number;
    staleProcessing: number;
  };
  storage: { pendingDeletions: number };
  services: {
    status: "operational" | "degraded";
    checkedAt: string;
    checks: Record<ServiceKey, ServiceState>;
  };
  recentUsers: AdminUser[];
  recentImports: AdminImport[];
};

type UsersResponse = {
  users: AdminUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
};

type MissingCache = {
  gcCode: string;
  referenceCount: number;
  users: number;
  sources: {
    trackableLogs: number;
    mysteryWorkspaces: number;
    challengeCheckers: number;
  };
  name: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  region: string | null;
  county: string | null;
  lastSeenAt: string | null;
};

type MissingCachesResponse = {
  generatedAt: string;
  total: number;
  caches: MissingCache[];
};

type AdminCache = {
  id: string;
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  size: string | null;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
  county: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { finds: number; hides: number; trackableLogs: number };
};

type CachesResponse = {
  caches: AdminCache[];
  pagination: UsersResponse["pagination"];
};

type ImportsResponse = {
  imports: AdminImport[];
  filter: string;
  pagination: UsersResponse["pagination"];
};

type AdminActivity = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  admin: { username: string };
};

type ActivityResponse = {
  activities: AdminActivity[];
  pagination: UsersResponse["pagination"];
};

type CacheFormValues = {
  gcCode: string;
  name: string;
  latitude: string;
  longitude: string;
  cacheType: string;
  difficulty: string;
  terrain: string;
  size: string;
  country: string;
  region: string;
  county: string;
  hiddenDate: string;
  ownerName: string;
};

const DEV_OFFLINE =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEV_OFFLINE === "true";

const sourceLabels: Record<string, string> = {
  MY_FINDS_GPX: "My Finds GPX",
  MY_HIDES_GPX: "My Hides GPX",
  POCKET_QUERY: "Pocket Query",
  MANUAL_GPX: "Manual GPX",
  GEOCACHING_API: "Geocaching API",
  GSAK: "GSAK",
  GEOSTATS_EXPORT: "Geostats transfer",
};

const serviceLabels: Record<
  ServiceKey,
  { label: string; detail: string; icon: typeof Database }
> = {
  database: { label: "Database", detail: "Postgres", icon: Database },
  importQueue: {
    label: "Import queue",
    detail: "Redis + worker",
    icon: Activity,
  },
  objectStorage: {
    label: "Object storage",
    detail: "S3 bucket",
    icon: HardDrive,
  },
};

const devNow = new Date().toISOString();
const devUser: AdminUser = {
  id: "dev-user",
  username: "dev",
  email: "dev@local.geostats",
  createdAt: devNow,
  updatedAt: devNow,
  profile: { gcUsername: "dev" },
  _count: { finds: 5, hides: 0, imports: 2, trackables: 1 },
};

const developmentOverview: AdminOverview = {
  generatedAt: devNow,
  metrics: {
    users: 24,
    profiles: 19,
    caches: 8_462,
    finds: 52_913,
    hides: 1_284,
    trackables: 47,
    challengeCheckers: 18,
    mysteries: 91,
    importsLastSevenDays: 36,
  },
  imports: {
    byStatus: { COMPLETED: 142, QUEUED: 2, PROCESSING: 1, FAILED: 3 },
    failed: 3,
    staleProcessing: 1,
  },
  storage: { pendingDeletions: 2 },
  services: {
    status: "operational",
    checkedAt: devNow,
    checks: { database: "ok", importQueue: "ok", objectStorage: "ok" },
  },
  recentUsers: [devUser],
  recentImports: [
    {
      id: "dev-import-failed",
      fileName: "my-finds-2026-08.gpx",
      fileType: "GPX",
      source: "MY_FINDS_GPX",
      status: "FAILED",
      errorMessage: "The GPX file could not be parsed.",
      createdAt: devNow,
      updatedAt: devNow,
      user: { username: "dev", email: "dev@local.geostats" },
      _count: { finds: 0, hides: 0 },
    },
    {
      id: "dev-import-complete",
      fileName: "sweden-pocket-query.zip",
      fileType: "ZIP",
      source: "POCKET_QUERY",
      status: "COMPLETED",
      errorMessage: null,
      createdAt: devNow,
      updatedAt: devNow,
      user: { username: "northstar", email: "northstar@example.com" },
      _count: { finds: 314, hides: 0 },
    },
  ],
};

const developmentMissingCaches: MissingCache[] = [
  {
    gcCode: "GCDEMO1",
    referenceCount: 2,
    users: 1,
    sources: { trackableLogs: 0, mysteryWorkspaces: 2, challengeCheckers: 0 },
    name: "Example Mystery Cache",
    location: "Stockholm",
    latitude: 59.3293,
    longitude: 18.0686,
    country: "Sweden",
    region: "Stockholm",
    county: null,
    lastSeenAt: devNow,
  },
];

const developmentCaches: AdminCache[] = [
  {
    id: "dev-cache-1",
    gcCode: "GCDEMO1",
    name: "Example Mystery Cache",
    cacheType: "Mystery Cache",
    difficulty: 3,
    terrain: 2,
    size: "Small",
    latitude: 59.3293,
    longitude: 18.0686,
    country: "Sweden",
    region: "Stockholm",
    county: null,
    ownerName: "northstar",
    createdAt: devNow,
    updatedAt: devNow,
    _count: { finds: 12, hides: 0, trackableLogs: 3 },
  },
];

const developmentActivities: AdminActivity[] = [
  {
    id: "dev-activity-1",
    action: "CACHE_ADDED",
    targetType: "cache",
    targetId: "GCDEMO1",
    details: { linkedTrackableLogs: 3 },
    createdAt: devNow,
    admin: { username: "dev" },
  },
  {
    id: "dev-activity-2",
    action: "STATS_REBUILT",
    targetType: "user",
    targetId: "northstar",
    details: { totalFinds: 314 },
    createdAt: devNow,
    admin: { username: "dev" },
  },
];

function emptyCacheForm(): CacheFormValues {
  return {
    gcCode: "",
    name: "",
    latitude: "",
    longitude: "",
    cacheType: "",
    difficulty: "",
    terrain: "",
    size: "",
    country: "",
    region: "",
    county: "",
    hiddenDate: "",
    ownerName: "",
  };
}

function cacheFormFor(candidate: MissingCache): CacheFormValues {
  return {
    ...emptyCacheForm(),
    gcCode: candidate.gcCode,
    name: candidate.name ?? "",
    latitude: candidate.latitude == null ? "" : String(candidate.latitude),
    longitude: candidate.longitude == null ? "" : String(candidate.longitude),
    country: candidate.country ?? "",
    region: candidate.region ?? "",
    county: candidate.county ?? "",
  };
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatShortDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function number(value: number | undefined) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function statusClass(status: string) {
  return `admin-status ${status.toLowerCase()}`;
}

function initials(username: string) {
  return username.slice(0, 2).toUpperCase();
}

function missingCacheLocation(candidate: MissingCache) {
  const hierarchy = [candidate.county, candidate.region, candidate.country]
    .filter(Boolean)
    .join(", ");
  return candidate.location || hierarchy || "No location saved";
}

function missingCacheCoordinates(candidate: MissingCache) {
  return candidate.latitude != null && candidate.longitude != null
    ? `${candidate.latitude.toFixed(5)}, ${candidate.longitude.toFixed(5)}`
    : "Coordinates required";
}

const activityLabels: Record<string, string> = {
  CACHE_ADDED: "Added shared cache",
  IMPORT_RETRIED: "Retried import",
  STATS_REBUILT: "Rebuilt user stats",
};

function activityDescription(activity: AdminActivity) {
  const target = activity.targetId ?? "instance";
  if (activity.action === "IMPORT_RETRIED") {
    const fileName =
      typeof activity.details?.fileName === "string"
        ? activity.details.fileName
        : null;
    return fileName ? `${target} · ${fileName}` : target;
  }
  if (activity.action === "STATS_REBUILT") {
    const username =
      typeof activity.details?.username === "string"
        ? activity.details.username
        : null;
    const totalFinds =
      typeof activity.details?.totalFinds === "number"
        ? activity.details.totalFinds
        : null;
    const targetLabel = username ?? target;
    return totalFinds == null
      ? targetLabel
      : `${targetLabel} · ${number(totalFinds)} finds`;
  }
  if (activity.action === "CACHE_ADDED") {
    const linked =
      typeof activity.details?.linkedTrackableLogs === "number"
        ? activity.details.linkedTrackableLogs
        : 0;
    return linked
      ? `${target} · ${number(linked)} trackable logs linked`
      : target;
  }
  return target;
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(
    DEV_OFFLINE ? developmentOverview : null,
  );
  const [missingCaches, setMissingCaches] = useState<MissingCache[]>(
    DEV_OFFLINE ? developmentMissingCaches : [],
  );
  const [catalogCaches, setCatalogCaches] = useState<AdminCache[]>(
    DEV_OFFLINE ? developmentCaches : [],
  );
  const [catalogPagination, setCatalogPagination] = useState<
    CachesResponse["pagination"]
  >({
    page: 1,
    pageSize: 12,
    total: DEV_OFFLINE ? developmentCaches.length : 0,
    pageCount: 1,
  });
  const [users, setUsers] = useState<AdminUser[]>(DEV_OFFLINE ? [devUser] : []);
  const [pagination, setPagination] = useState<UsersResponse["pagination"]>({
    page: 1,
    pageSize: 12,
    total: DEV_OFFLINE ? 1 : 0,
    pageCount: 1,
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!DEV_OFFLINE);
  const [missingLoading, setMissingLoading] = useState(!DEV_OFFLINE);
  const [usersLoading, setUsersLoading] = useState(!DEV_OFFLINE);
  const [catalogLoading, setCatalogLoading] = useState(!DEV_OFFLINE);
  const [importsLoading, setImportsLoading] = useState(!DEV_OFFLINE);
  const [activityLoading, setActivityLoading] = useState(!DEV_OFFLINE);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyImport, setBusyImport] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [busyCache, setBusyCache] = useState<string | null>(null);
  const [gsakBusy, setGsakBusy] = useState(false);
  const [selectedMissingCode, setSelectedMissingCode] = useState<string | null>(
    null,
  );
  const [cacheForm, setCacheForm] = useState<CacheFormValues>(emptyCacheForm);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [importRows, setImportRows] = useState<AdminImport[]>(
    DEV_OFFLINE ? developmentOverview.recentImports : [],
  );
  const [importFilter, setImportFilter] = useState("ALL");
  const [importPagination, setImportPagination] = useState<
    ImportsResponse["pagination"]
  >({
    page: 1,
    pageSize: 12,
    total: DEV_OFFLINE ? developmentOverview.recentImports.length : 0,
    pageCount: 1,
  });
  const [activities, setActivities] = useState<AdminActivity[]>(
    DEV_OFFLINE ? developmentActivities : [],
  );
  const [activityPagination, setActivityPagination] = useState<
    ActivityResponse["pagination"]
  >({
    page: 1,
    pageSize: 12,
    total: DEV_OFFLINE ? developmentActivities.length : 0,
    pageCount: 1,
  });

  const loadUsers = useCallback(
    async (page = 1, search = query) => {
      if (DEV_OFFLINE) return;
      setUsersLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "12",
        });
        if (search.trim()) params.set("query", search.trim());
        const data = await apiFetch<UsersResponse>(
          `/admin/users?${params.toString()}`,
        );
        setUsers(data.users);
        setPagination(data.pagination);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load users.",
        );
      } finally {
        setUsersLoading(false);
      }
    },
    [query],
  );

  const loadCatalog = useCallback(
    async (page = 1, search = catalogQuery) => {
      if (DEV_OFFLINE) return;
      setCatalogLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "12",
        });
        if (search.trim()) params.set("query", search.trim());
        const data = await apiFetch<CachesResponse>(
          `/admin/caches?${params.toString()}`,
        );
        setCatalogCaches(data.caches);
        setCatalogPagination(data.pagination);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load the cache catalog.",
        );
      } finally {
        setCatalogLoading(false);
      }
    },
    [catalogQuery],
  );

  const loadImports = useCallback(
    async (page = 1, filter = importFilter) => {
      if (DEV_OFFLINE) return;
      setImportsLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: "12",
        });
        if (filter !== "ALL") params.set("status", filter);
        const data = await apiFetch<ImportsResponse>(
          `/admin/imports?${params.toString()}`,
        );
        setImportRows(data.imports);
        setImportPagination(data.pagination);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load import activity.",
        );
      } finally {
        setImportsLoading(false);
      }
    },
    [importFilter],
  );

  const loadActivity = useCallback(async (page = 1) => {
    if (DEV_OFFLINE) return;
    setActivityLoading(true);
    try {
      const data = await apiFetch<ActivityResponse>(
        `/admin/activity?page=${page}&pageSize=12`,
      );
      setActivities(data.activities);
      setActivityPagination(data.pagination);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load admin activity.",
      );
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const refresh = useCallback(async (requestedImportFilter = "ALL") => {
    if (DEV_OFFLINE) return;
    setLoading(true);
    setMissingLoading(true);
    setCatalogLoading(true);
    setImportsLoading(true);
    setActivityLoading(true);
    setError(null);
    try {
      const importParams = new URLSearchParams({
        page: "1",
        pageSize: "12",
      });
      if (requestedImportFilter !== "ALL") {
        importParams.set("status", requestedImportFilter);
      }
      const [
        overviewData,
        usersData,
        missingData,
        catalogData,
        importsData,
        activityData,
      ] = await Promise.all([
        apiFetch<AdminOverview>("/admin/overview"),
        apiFetch<UsersResponse>("/admin/users?page=1&pageSize=12"),
        apiFetch<MissingCachesResponse>("/admin/caches/missing"),
        apiFetch<CachesResponse>("/admin/caches?page=1&pageSize=12"),
        apiFetch<ImportsResponse>(`/admin/imports?${importParams.toString()}`),
        apiFetch<ActivityResponse>("/admin/activity?page=1&pageSize=12"),
      ]);
      setOverview(overviewData);
      setUsers(usersData.users);
      setPagination(usersData.pagination);
      setMissingCaches(missingData.caches);
      setCatalogCaches(catalogData.caches);
      setCatalogPagination(catalogData.pagination);
      setImportRows(importsData.imports);
      setImportFilter(importsData.filter);
      setImportPagination(importsData.pagination);
      setActivities(activityData.activities);
      setActivityPagination(activityData.pagination);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load the admin console.",
      );
    } finally {
      setLoading(false);
      setMissingLoading(false);
      setUsersLoading(false);
      setCatalogLoading(false);
      setImportsLoading(false);
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    await loadUsers(1, query);
  }

  async function searchCatalog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    await loadCatalog(1, catalogQuery);
  }

  function changeImportFilter(value: string) {
    setImportFilter(value);
    setNotice(null);
    void loadImports(1, value);
  }

  async function retryImport(importItem: AdminImport) {
    setBusyImport(importItem.id);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/admin/imports/${importItem.id}/retry`, {
        method: "POST",
      });
      setNotice(`Queued ${importItem.fileName} for another attempt.`);
      await refresh(importFilter);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not retry the import.",
      );
    } finally {
      setBusyImport(null);
    }
  }

  async function recalculateUser(user: AdminUser) {
    setBusyUser(user.id);
    setError(null);
    setNotice(null);
    try {
      const data = await apiFetch<{ totalFinds: number | null }>(
        `/admin/users/${user.id}/recalculate`,
        { method: "POST" },
      );
      setNotice(
        `Rebuilt the stats snapshot for ${user.username}${data.totalFinds == null ? "." : ` with ${number(data.totalFinds)} finds.`}`,
      );
      await refresh(importFilter);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not rebuild the snapshot.",
      );
    } finally {
      setBusyUser(null);
    }
  }

  function openMissingCache(candidate: MissingCache) {
    setSelectedMissingCode(candidate.gcCode);
    setCacheForm(cacheFormFor(candidate));
    setError(null);
    setNotice(null);
  }

  function updateCacheForm(field: keyof CacheFormValues, value: string) {
    setCacheForm((current) => ({ ...current, [field]: value }));
  }

  async function addMissingCache(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMissingCode) return;
    setBusyCache(selectedMissingCode);
    setError(null);
    setNotice(null);
    try {
      if (DEV_OFFLINE) {
        setMissingCaches((current) =>
          current.filter(
            (candidate) => candidate.gcCode !== selectedMissingCode,
          ),
        );
        setSelectedMissingCode(null);
        setNotice(`Demo cache ${selectedMissingCode} added.`);
        return;
      }
      const result = await apiFetch<{
        cache: { gcCode: string; name: string };
        linkedTrackableLogs: number;
      }>("/admin/caches", {
        method: "POST",
        body: JSON.stringify(cacheForm),
      });
      setSelectedMissingCode(null);
      setNotice(
        `Added ${result.cache.gcCode}${result.linkedTrackableLogs ? ` and linked ${number(result.linkedTrackableLogs)} trackable logs` : ""}.`,
      );
      await refresh(importFilter);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not add the cache.",
      );
    } finally {
      setBusyCache(null);
    }
  }

  async function downloadMissingGsakConnector() {
    setGsakBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (DEV_OFFLINE) {
        setNotice(
          "The admin GSAK connector is unavailable in offline demo mode.",
        );
        return;
      }
      const data = await apiFetch<{ fileName: string; macro: string }>(
        "/collector/gsak/admin-setup",
        { method: "POST" },
      );
      const url = URL.createObjectURL(
        new Blob([data.macro], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = data.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        "Admin GSAK connector downloaded. Install GeostatsMissingCaches.gsk in GSAK and run it, then refresh this page.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not prepare the admin GSAK connector.",
      );
    } finally {
      setGsakBusy(false);
    }
  }

  const serviceItems = useMemo(() => {
    if (!overview) return [];
    return (Object.keys(serviceLabels) as ServiceKey[]).map((key) => ({
      key,
      ...serviceLabels[key],
      status: overview.services.checks[key] ?? "unhealthy",
    }));
  }, [overview]);

  const overallHealthy = overview?.services.status === "operational";
  const selectedMissingCache = selectedMissingCode
    ? missingCaches.find(
        (candidate) => candidate.gcCode === selectedMissingCode,
      )
    : null;
  const statusRows: Array<[string, number, string]> = overview
    ? [
        ["Completed", overview.imports.byStatus.COMPLETED ?? 0, "completed"],
        ["Queued", overview.imports.byStatus.QUEUED ?? 0, "queued"],
        ["Processing", overview.imports.byStatus.PROCESSING ?? 0, "processing"],
        ["Failed", overview.imports.byStatus.FAILED ?? 0, "failed"],
      ]
    : [];

  return (
    <AppShell>
      <div className="admin-page">
        <header className="page-header admin-header">
          <div>
            <p className="eyebrow">Restricted workspace</p>
            <h1>Admin console</h1>
            <p className="page-lede">
              Keep an eye on the instance, find stuck imports, and see who is
              using Geostats.
            </p>
          </div>
          <div className="admin-header-actions">
            <span className="admin-access-pill">
              <ShieldCheck size={15} /> Admin access
            </span>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? "admin-spin" : ""} />
              Refresh data
            </button>
          </div>
        </header>

        {error ? (
          <div className="inline-notice admin-notice error-notice">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="inline-notice admin-notice">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
          </div>
        ) : null}

        {loading && !overview ? (
          <section className="panel admin-loading">
            <RefreshCw size={20} className="admin-spin" />
            <span>Loading platform data...</span>
          </section>
        ) : overview ? (
          <>
            <section
              className="stat-grid admin-stat-grid"
              aria-label="Platform totals"
            >
              <StatCard
                label="Accounts"
                value={number(overview.metrics.users)}
                detail={`${number(overview.metrics.profiles)} with a profile`}
              />
              <StatCard
                label="Caches indexed"
                value={number(overview.metrics.caches)}
                detail={`${number(overview.metrics.finds)} finds logged`}
              />
              <StatCard
                label="Imports this week"
                value={number(overview.metrics.importsLastSevenDays)}
                detail={`${number(overview.imports.failed)} need attention`}
              />
              <StatCard
                label="Trackables"
                value={number(overview.metrics.trackables)}
                detail="Tracked items"
              />
              <StatCard
                label="Challenge checkers"
                value={number(overview.metrics.challengeCheckers)}
                detail="Saved checkers"
              />
              <StatCard
                label="Mystery workspaces"
                value={number(overview.metrics.mysteries)}
                detail="Saved workspaces"
              />
            </section>

            <section className="admin-top-grid">
              <article className="panel admin-health-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Live checks</p>
                    <h2>System pulse</h2>
                  </div>
                  <span
                    className={`admin-health-summary ${overallHealthy ? "healthy" : "degraded"}`}
                  >
                    {overallHealthy ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertTriangle size={15} />
                    )}
                    {overallHealthy
                      ? "All systems operational"
                      : "Needs attention"}
                  </span>
                </div>
                <div className="admin-service-list">
                  {serviceItems.map((service) => {
                    const Icon = service.icon;
                    const healthy = service.status === "ok";
                    return (
                      <div className="admin-service-row" key={service.key}>
                        <span className="admin-service-icon">
                          <Icon size={17} />
                        </span>
                        <span>
                          <strong>{service.label}</strong>
                          <small>{service.detail}</small>
                        </span>
                        <span
                          className={`admin-service-status ${healthy ? "healthy" : "unhealthy"}`}
                        >
                          <i />
                          {healthy ? "Healthy" : "Offline"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <small className="admin-checked-at">
                  <Clock3 size={13} /> Checked{" "}
                  {formatDate(overview.services.checkedAt)}
                </small>
              </article>

              <article className="panel admin-attention-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Operator queue</p>
                    <h2>Needs attention</h2>
                  </div>
                  <ArrowUpRight size={18} className="muted" />
                </div>
                <div className="admin-attention-list">
                  <a
                    href="#imports"
                    className={
                      overview.imports.failed
                        ? "attention-item warning"
                        : "attention-item clear"
                    }
                  >
                    <span className="attention-count">
                      {number(overview.imports.failed)}
                    </span>
                    <span>
                      <strong>Failed imports</strong>
                      <small>
                        {overview.imports.failed
                          ? "Review and retry when ready"
                          : "Nothing failed recently"}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                  <a
                    href="#imports"
                    className={
                      overview.imports.staleProcessing
                        ? "attention-item warning"
                        : "attention-item clear"
                    }
                  >
                    <span className="attention-count">
                      {number(overview.imports.staleProcessing)}
                    </span>
                    <span>
                      <strong>Stale processing jobs</strong>
                      <small>
                        {overview.imports.staleProcessing
                          ? "Older than 30 minutes"
                          : "The queue is moving"}
                      </small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                  <div
                    className={
                      overview.storage.pendingDeletions
                        ? "attention-item warning"
                        : "attention-item clear"
                    }
                  >
                    <span className="attention-count">
                      {number(overview.storage.pendingDeletions)}
                    </span>
                    <span>
                      <strong>Storage cleanups</strong>
                      <small>
                        {overview.storage.pendingDeletions
                          ? "Waiting for object removal"
                          : "Storage is tidy"}
                      </small>
                    </span>
                    <HardDrive size={15} />
                  </div>
                  <a
                    href="#missing-caches"
                    className={
                      missingLoading
                        ? "attention-item"
                        : missingCaches.length
                          ? "attention-item warning"
                          : "attention-item clear"
                    }
                  >
                    <span className="attention-count">
                      {missingLoading ? "…" : number(missingCaches.length)}
                    </span>
                    <span>
                      <strong>Missing cache records</strong>
                      <small>
                        {missingLoading
                          ? "Checking imported references"
                          : missingCaches.length
                            ? "Review and add shared metadata"
                            : "All referenced caches are indexed"}
                      </small>
                    </span>
                    <Database size={15} />
                  </a>
                </div>
              </article>
            </section>

            <section className="panel admin-import-pulse-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Pipeline</p>
                  <h2>Import pulse</h2>
                </div>
                <span className="muted">
                  {number(overview.metrics.importsLastSevenDays)} new in the
                  last 7 days
                </span>
              </div>
              <div className="admin-import-statuses">
                {statusRows.map(([label, count, className]) => (
                  <div className="admin-import-status" key={label}>
                    <span className={`admin-status-dot ${className}`} />
                    <span>{label}</span>
                    <strong>{number(count)}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel admin-missing-panel" id="missing-caches">
              <div className="panel-heading admin-table-heading admin-missing-heading">
                <div>
                  <p className="eyebrow">Data integrity</p>
                  <h2>Missing caches</h2>
                  <p className="muted">
                    These cache codes are referenced by saved workspaces or
                    imported logs but do not have a shared cache record yet. Add
                    the metadata once so the rest of the app can use it.
                  </p>
                </div>
                <div className="admin-missing-heading-actions">
                  <span
                    className={`admin-missing-summary ${missingCaches.length ? "warning" : "clear"}`}
                  >
                    <Database size={15} />
                    {missingLoading
                      ? "Checking..."
                      : missingCaches.length
                        ? `${number(missingCaches.length)} to add`
                        : "Queue clear"}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void downloadMissingGsakConnector()}
                    disabled={
                      gsakBusy || missingLoading || !missingCaches.length
                    }
                  >
                    <Download size={16} />
                    {gsakBusy ? "Preparing connector..." : "Import from GSAK"}
                  </button>
                </div>
              </div>
              <p className="muted admin-gsak-help">
                Download the admin-only connector, run it in GSAK, and it will
                load and send only these unresolved cache records. It does not
                import finds or logs.
              </p>
              {missingLoading ? (
                <div className="admin-missing-loading">
                  <RefreshCw size={18} className="admin-spin" />
                  <span>Checking cache references...</span>
                </div>
              ) : missingCaches.length ? (
                <div className="admin-table admin-missing-table">
                  <div className="admin-table-row admin-table-header">
                    <span>Cache</span>
                    <span>Usage</span>
                    <span>Sources</span>
                    <span>Saved location</span>
                    <span />
                  </div>
                  {missingCaches.map((candidate) => (
                    <div className="admin-table-row" key={candidate.gcCode}>
                      <span className="admin-file-cell">
                        <strong>{candidate.gcCode}</strong>
                        <small>{candidate.name ?? "No cache name saved"}</small>
                      </span>
                      <span className="admin-activity-cell">
                        <strong>{number(candidate.referenceCount)}</strong> refs
                        <br />
                        <small>{number(candidate.users)} users</small>
                      </span>
                      <span className="admin-file-cell">
                        <strong>
                          {[
                            candidate.sources.mysteryWorkspaces
                              ? `${number(candidate.sources.mysteryWorkspaces)} mystery`
                              : null,
                            candidate.sources.challengeCheckers
                              ? `${number(candidate.sources.challengeCheckers)} checker`
                              : null,
                            candidate.sources.trackableLogs
                              ? `${number(candidate.sources.trackableLogs)} trackable`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Unknown source"}
                        </strong>
                        <small>
                          Last seen{" "}
                          {formatDate(candidate.lastSeenAt ?? undefined)}
                        </small>
                      </span>
                      <span className="admin-file-cell">
                        <strong>{missingCacheLocation(candidate)}</strong>
                        <small>
                          <MapPin size={12} />{" "}
                          {missingCacheCoordinates(candidate)}
                        </small>
                      </span>
                      <span className="admin-row-action">
                        <button
                          className="text-button"
                          type="button"
                          onClick={() => openMissingCache(candidate)}
                          disabled={busyCache !== null}
                        >
                          <Plus size={14} />
                          {selectedMissingCode === candidate.gcCode
                            ? "Editing"
                            : "Add cache"}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="admin-missing-empty">
                  <CheckCircle2 size={19} />
                  <span>No unresolved cache references were found.</span>
                </div>
              )}

              {selectedMissingCache ? (
                <form className="admin-cache-form" onSubmit={addMissingCache}>
                  <div className="admin-cache-form-heading">
                    <div>
                      <p className="eyebrow">Add shared metadata</p>
                      <h3>{selectedMissingCache.gcCode}</h3>
                      <p className="muted">
                        Review the prefilled details, then save this cache to
                        the global database.
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setSelectedMissingCode(null)}
                      disabled={busyCache !== null}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="admin-cache-form-grid">
                    <label>
                      <span>GC code</span>
                      <input value={cacheForm.gcCode} readOnly />
                    </label>
                    <label>
                      <span>Cache name</span>
                      <input
                        required
                        maxLength={500}
                        value={cacheForm.name}
                        onChange={(event) =>
                          updateCacheForm("name", event.target.value)
                        }
                        placeholder="Cache name"
                      />
                    </label>
                    <label>
                      <span>Latitude</span>
                      <input
                        required
                        type="number"
                        min="-90"
                        max="90"
                        step="0.000001"
                        value={cacheForm.latitude}
                        onChange={(event) =>
                          updateCacheForm("latitude", event.target.value)
                        }
                        placeholder="59.3293"
                      />
                    </label>
                    <label>
                      <span>Longitude</span>
                      <input
                        required
                        type="number"
                        min="-180"
                        max="180"
                        step="0.000001"
                        value={cacheForm.longitude}
                        onChange={(event) =>
                          updateCacheForm("longitude", event.target.value)
                        }
                        placeholder="18.0686"
                      />
                    </label>
                    <label>
                      <span>Cache type</span>
                      <input
                        maxLength={100}
                        value={cacheForm.cacheType}
                        onChange={(event) =>
                          updateCacheForm("cacheType", event.target.value)
                        }
                        placeholder="Mystery Cache"
                      />
                    </label>
                    <label>
                      <span>Difficulty</span>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        step="0.5"
                        value={cacheForm.difficulty}
                        onChange={(event) =>
                          updateCacheForm("difficulty", event.target.value)
                        }
                        placeholder="1–5"
                      />
                    </label>
                    <label>
                      <span>Terrain</span>
                      <input
                        type="number"
                        min="1"
                        max="5"
                        step="0.5"
                        value={cacheForm.terrain}
                        onChange={(event) =>
                          updateCacheForm("terrain", event.target.value)
                        }
                        placeholder="1–5"
                      />
                    </label>
                    <label>
                      <span>Size</span>
                      <input
                        maxLength={100}
                        value={cacheForm.size}
                        onChange={(event) =>
                          updateCacheForm("size", event.target.value)
                        }
                        placeholder="Regular"
                      />
                    </label>
                    <label>
                      <span>Country</span>
                      <input
                        maxLength={120}
                        value={cacheForm.country}
                        onChange={(event) =>
                          updateCacheForm("country", event.target.value)
                        }
                        placeholder="Sweden"
                      />
                    </label>
                    <label>
                      <span>Region</span>
                      <input
                        maxLength={160}
                        value={cacheForm.region}
                        onChange={(event) =>
                          updateCacheForm("region", event.target.value)
                        }
                        placeholder="Blekinge"
                      />
                    </label>
                    <label>
                      <span>County</span>
                      <input
                        maxLength={160}
                        value={cacheForm.county}
                        onChange={(event) =>
                          updateCacheForm("county", event.target.value)
                        }
                        placeholder="Karlskrona"
                      />
                    </label>
                    <label>
                      <span>Hidden date</span>
                      <input
                        type="date"
                        value={cacheForm.hiddenDate}
                        onChange={(event) =>
                          updateCacheForm("hiddenDate", event.target.value)
                        }
                      />
                    </label>
                    <label>
                      <span>Owner</span>
                      <input
                        maxLength={250}
                        value={cacheForm.ownerName}
                        onChange={(event) =>
                          updateCacheForm("ownerName", event.target.value)
                        }
                        placeholder="Geocaching username"
                      />
                    </label>
                  </div>
                  <div className="admin-cache-form-actions">
                    <span className="muted">
                      Name and coordinates are required; the rest is optional.
                    </span>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={busyCache !== null}
                    >
                      <Plus size={16} />
                      {busyCache ? "Adding cache..." : "Add cache to database"}
                    </button>
                  </div>
                </form>
              ) : null}
            </section>

            <section className="panel admin-catalog-panel" id="cache-catalog">
              <div className="panel-heading admin-table-heading admin-catalog-heading">
                <div>
                  <p className="eyebrow">Shared database</p>
                  <h2>Cache catalog</h2>
                  <p className="muted">
                    Search the cache records used by maps, statistics, finds,
                    hides, and trackable history.
                  </p>
                </div>
                <form className="admin-search-form" onSubmit={searchCatalog}>
                  <Search size={16} />
                  <input
                    aria-label="Search cache catalog"
                    value={catalogQuery}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                    placeholder="GC code, name, place"
                  />
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={catalogLoading}
                  >
                    Search
                  </button>
                </form>
              </div>
              <div className="admin-catalog-summary">
                <span>
                  <Database size={15} /> {number(catalogPagination.total)}{" "}
                  indexed records
                </span>
                <span className="muted">
                  {catalogQuery.trim()
                    ? `Matching “${catalogQuery.trim()}”`
                    : "Newest metadata first"}
                </span>
              </div>
              <div className="admin-table admin-catalog-table">
                <div className="admin-table-row admin-table-header">
                  <span>Cache</span>
                  <span>Profile</span>
                  <span>Usage</span>
                  <span>Location</span>
                  <span>Updated</span>
                </div>
                {catalogLoading && !catalogCaches.length ? (
                  <p className="muted admin-empty">Loading cache catalog...</p>
                ) : catalogCaches.length ? (
                  catalogCaches.map((cache) => (
                    <div className="admin-table-row" key={cache.id}>
                      <span className="admin-file-cell">
                        <a
                          className="admin-cache-link"
                          href={
                            "https://coord.info/" +
                            encodeURIComponent(cache.gcCode)
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          <strong>{cache.gcCode}</strong>
                          <ExternalLink size={13} />
                        </a>
                        <small>{cache.name}</small>
                      </span>
                      <span className="admin-file-cell">
                        <strong>{cache.cacheType ?? "Type unknown"}</strong>
                        <small>
                          D/T {cache.difficulty ?? "?"}/{cache.terrain ?? "?"}
                          {cache.size ? " · " + cache.size : ""}
                        </small>
                      </span>
                      <span className="admin-activity-cell">
                        <strong>{number(cache._count.finds)}</strong> finds{" "}
                        <strong>{number(cache._count.hides)}</strong> hides
                        <small>
                          {number(cache._count.trackableLogs)} trackable logs
                        </small>
                      </span>
                      <span className="admin-file-cell">
                        <strong>
                          {[cache.county, cache.region, cache.country]
                            .filter(Boolean)
                            .join(", ") || "No location metadata"}
                        </strong>
                        <small>
                          <MapPin size={12} /> {cache.latitude.toFixed(5)},{" "}
                          {cache.longitude.toFixed(5)}
                        </small>
                      </span>
                      <span className="admin-date-cell">
                        {formatShortDate(cache.updatedAt)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted admin-empty">
                    No cache records match that search.
                  </p>
                )}
              </div>
              <div className="admin-pagination">
                <span className="muted">
                  {catalogPagination.total
                    ? `${number((catalogPagination.page - 1) * catalogPagination.pageSize + 1)}-${number(Math.min(catalogPagination.page * catalogPagination.pageSize, catalogPagination.total))} of ${number(catalogPagination.total)}`
                    : "0 records"}
                </span>
                <div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadCatalog(catalogPagination.page - 1)}
                    disabled={catalogLoading || catalogPagination.page <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadCatalog(catalogPagination.page + 1)}
                    disabled={
                      catalogLoading ||
                      catalogPagination.page >= catalogPagination.pageCount
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            <section className="admin-content-grid" id="imports">
              <article className="panel admin-table-panel">
                <div className="panel-heading admin-table-heading">
                  <div>
                    <p className="eyebrow">Pipeline monitor</p>
                    <h2>Import activity</h2>
                  </div>
                  <label className="admin-filter-control">
                    <ListFilter size={15} />
                    <span className="sr-only">Filter imports by status</span>
                    <select
                      aria-label="Filter imports by status"
                      value={importFilter}
                      onChange={(event) =>
                        changeImportFilter(event.target.value)
                      }
                    >
                      <option value="ALL">All statuses</option>
                      <option value="PROCESSING">Processing</option>
                      <option value="QUEUED">Queued</option>
                      <option value="UPLOADED">Uploaded</option>
                      <option value="FAILED">Failed</option>
                      <option value="COMPLETED">Completed</option>
                    </select>
                  </label>
                </div>
                <div className="admin-table admin-import-table">
                  <div className="admin-table-row admin-table-header">
                    <span>File</span>
                    <span>Owner</span>
                    <span>Status</span>
                    <span>When</span>
                    <span />
                  </div>
                  {importsLoading && !importRows.length ? (
                    <p className="muted admin-empty">Loading imports...</p>
                  ) : importRows.length ? (
                    importRows.map((importItem) => (
                      <div className="admin-table-row" key={importItem.id}>
                        <span className="admin-file-cell">
                          <strong title={importItem.fileName}>
                            {importItem.fileName}
                          </strong>
                          <small>
                            {sourceLabels[importItem.source] ??
                              importItem.source}
                          </small>
                          {importItem.errorMessage ? (
                            <small
                              className="admin-error-detail"
                              title={importItem.errorMessage}
                            >
                              {importItem.errorMessage}
                            </small>
                          ) : null}
                        </span>
                        <span className="admin-owner-cell">
                          <span className="admin-avatar">
                            {initials(importItem.user.username)}
                          </span>
                          <strong>{importItem.user.username}</strong>
                        </span>
                        <span>
                          <span className={statusClass(importItem.status)}>
                            {importItem.status.toLowerCase()}
                          </span>
                        </span>
                        <span className="admin-date-cell">
                          {formatShortDate(importItem.createdAt)}
                        </span>
                        <span className="admin-row-action">
                          {importItem.status === "FAILED" ? (
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => void retryImport(importItem)}
                              disabled={busyImport === importItem.id}
                            >
                              <RotateCcw size={14} />
                              {busyImport === importItem.id
                                ? "Queueing"
                                : "Retry"}
                            </button>
                          ) : (
                            <span className="admin-count-note">
                              {number(importItem._count.finds)} finds
                            </span>
                          )}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted admin-empty">
                      No imports match this status.
                    </p>
                  )}
                </div>
                <div className="admin-pagination">
                  <span className="muted">
                    {importPagination.total
                      ? `${number((importPagination.page - 1) * importPagination.pageSize + 1)}-${number(Math.min(importPagination.page * importPagination.pageSize, importPagination.total))} of ${number(importPagination.total)}`
                      : "0 imports"}
                  </span>
                  <div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void loadImports(importPagination.page - 1)
                      }
                      disabled={importsLoading || importPagination.page <= 1}
                    >
                      Previous
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() =>
                        void loadImports(importPagination.page + 1)
                      }
                      disabled={
                        importsLoading ||
                        importPagination.page >= importPagination.pageCount
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>
              </article>

              <article className="panel admin-table-panel">
                <div className="panel-heading admin-table-heading">
                  <div>
                    <p className="eyebrow">New accounts</p>
                    <h2>Recent signups</h2>
                  </div>
                  <a className="text-button" href="#users">
                    All users <ArrowUpRight size={14} />
                  </a>
                </div>
                <div className="admin-signup-list">
                  {overview.recentUsers.map((user) => (
                    <div className="admin-signup-row" key={user.id}>
                      <span className="admin-avatar large">
                        {initials(user.username)}
                      </span>
                      <span className="admin-signup-main">
                        <strong>{user.username}</strong>
                        <small>{user.email}</small>
                      </span>
                      <span className="admin-signup-meta">
                        <strong>{number(user._count.finds)}</strong>
                        <small>finds</small>
                      </span>
                      <span className="admin-signup-meta">
                        <strong>{formatShortDate(user.createdAt)}</strong>
                        <small>joined</small>
                      </span>
                    </div>
                  ))}
                  {!overview.recentUsers.length ? (
                    <p className="muted admin-empty">No accounts yet.</p>
                  ) : null}
                </div>
              </article>
            </section>

            <section className="panel admin-users-panel" id="users">
              <div className="panel-heading admin-users-heading">
                <div>
                  <p className="eyebrow">Account directory</p>
                  <h2>Users</h2>
                  <p className="muted">
                    Search by username or email. Rebuild a snapshot when a
                    user's numbers look stale.
                  </p>
                </div>
                <form className="admin-search-form" onSubmit={searchUsers}>
                  <Search size={16} />
                  <input
                    aria-label="Search users"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search users"
                  />
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={usersLoading}
                  >
                    Search
                  </button>
                </form>
              </div>
              <div className="admin-table admin-users-table">
                <div className="admin-table-row admin-table-header">
                  <span>User</span>
                  <span>Geocaching profile</span>
                  <span>Activity</span>
                  <span>Joined</span>
                  <span />
                </div>
                {users.map((user) => (
                  <div className="admin-table-row" key={user.id}>
                    <span className="admin-user-cell">
                      <span className="admin-avatar">
                        {initials(user.username)}
                      </span>
                      <span>
                        <strong>{user.username}</strong>
                        <small>{user.email}</small>
                      </span>
                    </span>
                    <span>
                      {user.profile?.gcUsername ? (
                        <span className="admin-profile-chip">
                          {user.profile.gcUsername}
                        </span>
                      ) : (
                        <span className="muted">Not set up</span>
                      )}
                    </span>
                    <span className="admin-activity-cell">
                      <strong>{number(user._count.finds)}</strong> finds{" "}
                      <strong>{number(user._count.imports)}</strong> imports{" "}
                      <strong>{number(user._count.trackables ?? 0)}</strong>{" "}
                      trackables
                    </span>
                    <span className="admin-date-cell">
                      {formatShortDate(user.createdAt)}
                    </span>
                    <span className="admin-row-action">
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => void recalculateUser(user)}
                        disabled={busyUser === user.id}
                      >
                        <Calculator size={14} />
                        {busyUser === user.id ? "Rebuilding" : "Rebuild stats"}
                      </button>
                    </span>
                  </div>
                ))}
                {usersLoading && !users.length ? (
                  <p className="muted admin-empty">Loading users...</p>
                ) : null}
                {!usersLoading && !users.length ? (
                  <p className="muted admin-empty">
                    No users match that search.
                  </p>
                ) : null}
              </div>
              <div className="admin-pagination">
                <span className="muted">
                  {pagination.total
                    ? `${number((pagination.page - 1) * pagination.pageSize + 1)}-${number(Math.min(pagination.page * pagination.pageSize, pagination.total))} of ${number(pagination.total)}`
                    : "0 users"}
                </span>
                <div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadUsers(pagination.page - 1)}
                    disabled={usersLoading || pagination.page <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadUsers(pagination.page + 1)}
                    disabled={
                      usersLoading || pagination.page >= pagination.pageCount
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            <section className="panel admin-activity-panel" id="activity">
              <div className="panel-heading admin-table-heading">
                <div>
                  <p className="eyebrow">Operator history</p>
                  <h2>Admin activity</h2>
                  <p className="muted">
                    A lightweight audit trail for repairs, retries, and stats
                    rebuilds.
                  </p>
                </div>
                <ScrollText size={20} className="muted" />
              </div>
              <div className="admin-table admin-activity-table">
                <div className="admin-table-row admin-table-header">
                  <span>Action</span>
                  <span>Target</span>
                  <span>By</span>
                  <span>When</span>
                </div>
                {activityLoading && !activities.length ? (
                  <p className="muted admin-empty">Loading admin activity...</p>
                ) : activities.length ? (
                  activities.map((activity) => (
                    <div className="admin-table-row" key={activity.id}>
                      <span className="admin-file-cell">
                        <strong>
                          {activityLabels[activity.action] ?? activity.action}
                        </strong>
                        <small>{activity.targetType}</small>
                      </span>
                      <span className="admin-file-cell">
                        <strong>{activityDescription(activity)}</strong>
                      </span>
                      <span className="admin-owner-cell">
                        <span className="admin-avatar">
                          {initials(activity.admin.username)}
                        </span>
                        <strong>{activity.admin.username}</strong>
                      </span>
                      <span className="admin-date-cell">
                        {formatDate(activity.createdAt)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted admin-empty">
                    No admin actions recorded yet.
                  </p>
                )}
              </div>
              <div className="admin-pagination">
                <span className="muted">
                  {activityPagination.total
                    ? `${number((activityPagination.page - 1) * activityPagination.pageSize + 1)}-${number(Math.min(activityPagination.page * activityPagination.pageSize, activityPagination.total))} of ${number(activityPagination.total)}`
                    : "0 actions"}
                </span>
                <div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      void loadActivity(activityPagination.page - 1)
                    }
                    disabled={activityLoading || activityPagination.page <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      void loadActivity(activityPagination.page + 1)
                    }
                    disabled={
                      activityLoading ||
                      activityPagination.page >= activityPagination.pageCount
                    }
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            <section className="admin-footer-strip">
              <span>
                <Server size={16} />{" "}
                {overallHealthy
                  ? "The core services are responding."
                  : "One or more core services need a look."}
              </span>
              <span className="muted">
                Last refreshed {formatDate(overview.generatedAt)}
              </span>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
