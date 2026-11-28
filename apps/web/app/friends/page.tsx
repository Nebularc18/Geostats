"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/copy-text";
import { comparisonBucketRows, comparisonCountries, FriendComparison, readSavedFriends } from "../../lib/friend-comparison";

const SAVED_FRIENDS_KEY = "geostats-saved-friends";

type SharedFind = {
  gcCode: string;
  name: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  country: string | null;
  yourFoundAt: string;
};

type RichFriendComparison = FriendComparison & {
  sharedFindsCount?: number;
  recentSharedFinds?: SharedFind[];
  dtOverlap?: { both: number; onlyYou: number; onlyFriend: number };
  jasmerOverlap?: { both: number; onlyYou: number; onlyFriend: number };
};

type LeaderboardRow = {
  username: string;
  isYou: boolean;
  stats: FriendComparison["you"]["stats"];
};

type SavedFriends = {
  accountId: string;
  friendStatsEnabled: boolean;
  friends: string[];
  leaderboard: LeaderboardRow[];
};

const metrics: Array<{
  key: keyof FriendComparison["you"]["stats"];
  label: string;
}> = [
  { key: "totalFinds", label: "Finds" },
  { key: "totalHides", label: "Hides" },
  { key: "countryCount", label: "Countries" },
  { key: "cacheTypeCount", label: "Cache types" },
  { key: "difficultyTerrainCount", label: "D/T combinations" },
  { key: "longestStreak", label: "Longest streak" },
  { key: "currentStreak", label: "Current streak" },
  { key: "ftfCount", label: "FTFs" }
];

type LeaderboardMetric = "totalFinds" | "countryCount" | "difficultyTerrainCount" | "longestStreak" | "ftfCount";

function formatImportDate(value: string | null) {
  if (!value) {
    return "No completed import";
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `Updated ${date.toLocaleDateString()}` : "Import date unavailable";
}

function CountryList({ title, countries }: { title: string; countries: string[] }) {
  return (
    <div className="friend-country-group">
      <h3>{title}</h3>
      {countries.length > 0 ? (
        <div className="friend-tags">
          {countries.map((country) => (
            <span key={country}>{country}</span>
          ))}
        </div>
      ) : (
        <p className="muted">None yet.</p>
      )}
    </div>
  );
}

export default function FriendsPage() {
  const [username, setUsername] = useState("");
  const [savedFriends, setSavedFriends] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [sortMetric, setSortMetric] = useState<LeaderboardMetric>("totalFinds");
  const [comparison, setComparison] = useState<RichFriendComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [friendStatsEnabled, setFriendStatsEnabled] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [hasLegacyBookmarks, setHasLegacyBookmarks] = useState(false);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyStatus, setLegacyStatus] = useState<string | null>(null);
  const latestRequestRef = useRef(0);
  const pendingUsernameRef = useRef<string | null>(null);

  const myUsername = useMemo(
    () => leaderboard.find((row) => row.isYou)?.username ?? comparison?.you.username ?? null,
    [leaderboard, comparison]
  );

  useEffect(() => {
    let active = true;
    async function loadSaved() {
      try {
        const res = await apiFetch<SavedFriends>("/stats/friends");
        if (!active) return;
        setAccountId(res.accountId);
        setFriendStatsEnabled(res.friendStatsEnabled);
        setSavedFriends(res.friends);
        setLeaderboard(res.leaderboard);
      } catch {
        if (active) setError("Could not load saved friends.");
      }
    }
    void loadSaved();
    const invited = new URLSearchParams(window.location.search).get("add")?.trim();
    if (invited) setUsername(invited);
    try {
      setHasLegacyBookmarks(Boolean(localStorage.getItem(SAVED_FRIENDS_KEY)));
    } catch {
      // The server list is available even when the browser blocks storage.
    }
    return () => {
      active = false;
    };
  }, []);

  const countryGroups = useMemo(() => (comparison ? comparisonCountries(comparison.you.stats.countries, comparison.friend.stats.countries) : null), [comparison]);
  const cacheTypeRows = useMemo(() => (comparison ? comparisonBucketRows(comparison.you.stats.cacheTypes, comparison.friend.stats.cacheTypes) : []), [comparison]);
  const sortedLeaderboard = useMemo(
    () => [...leaderboard].sort((a, b) => Number(b.stats[sortMetric]) - Number(a.stats[sortMetric]) || a.username.localeCompare(b.username)),
    [leaderboard, sortMetric]
  );

  async function compareWith(candidate: string) {
    if (!accountId) return;
    const cleanUsername = candidate.trim();
    if (!cleanUsername) {
      setError("Enter a geocaching username.");
      return;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    pendingUsernameRef.current = cleanUsername;
    setLoading(true);
    setError(null);
    try {
      const headers = { "x-geostats-account-id": accountId };
      const result = await apiFetch<RichFriendComparison>(`/stats/compare/${encodeURIComponent(cleanUsername)}`, { headers });
      if (requestId !== latestRequestRef.current) {
        return;
      }
      setComparison(result);
      setUsername(result.friend.username);

      const saved = await apiFetch<SavedFriends>("/stats/friends", {
        method: "POST",
        headers,
        body: JSON.stringify({ username: result.friend.username })
      });
      if (requestId === latestRequestRef.current) {
        setSavedFriends(saved.friends);
        setLeaderboard(saved.leaderboard);
      }
    } catch (requestError) {
      if (requestId !== latestRequestRef.current) {
        return;
      }
      setComparison(null);
      setError(requestError instanceof Error ? requestError.message : "Could not compare profiles.");
    } finally {
      if (requestId === latestRequestRef.current) {
        pendingUsernameRef.current = null;
        setLoading(false);
      }
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void compareWith(username);
  }

  async function removeFriend(friend: string) {
    if (!accountId) return;
    const normalizedFriend = friend.trim().toLowerCase();
    if (pendingUsernameRef.current?.trim().toLowerCase() === normalizedFriend) {
      latestRequestRef.current += 1;
      pendingUsernameRef.current = null;
      setLoading(false);
    }
    try {
      const updated = await apiFetch<{ friends: string[]; leaderboard: LeaderboardRow[] }>(
        `/stats/friends/${encodeURIComponent(friend)}`,
        { method: "DELETE", headers: { "x-geostats-account-id": accountId } }
      );
      setSavedFriends(updated.friends);
      setLeaderboard(updated.leaderboard);
      if (comparison?.friend.username.trim().toLowerCase() === normalizedFriend) {
        setComparison(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Could not remove ${friend}.`);
    }
  }

  async function updateSharing(enabled: boolean) {
    if (!accountId) return;
    setSharingBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<{ friendStatsEnabled: boolean }>("/profile/friend-stats", {
        method: "PUT",
        headers: { "x-geostats-account-id": accountId },
        body: JSON.stringify({ friendStatsEnabled: enabled })
      });
      setFriendStatsEnabled(updated.friendStatsEnabled);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update friend sharing.");
    } finally {
      setSharingBusy(false);
    }
  }

  async function importLegacyBookmarks() {
    if (!accountId) return;
    setLegacyBusy(true);
    setLegacyStatus(null);
    try {
      const stored = localStorage.getItem(SAVED_FRIENDS_KEY);
      const alreadySaved = new Set(savedFriends.map((friend) => friend.toLowerCase()));
      const bookmarks = readSavedFriends(stored).filter((friend) => !alreadySaved.has(friend.toLowerCase()));
      const remaining: string[] = [];
      const headers = { "x-geostats-account-id": accountId };
      for (const friend of bookmarks) {
        try {
          const result = await apiFetch<SavedFriends>("/stats/friends", {
            method: "POST", headers, body: JSON.stringify({ username: friend })
          });
          setSavedFriends(result.friends);
          setLeaderboard(result.leaderboard);
        } catch {
          remaining.push(friend);
        }
      }
      if (localStorage.getItem(SAVED_FRIENDS_KEY) === stored) {
        if (remaining.length) localStorage.setItem(SAVED_FRIENDS_KEY, JSON.stringify(remaining));
        else localStorage.removeItem(SAVED_FRIENDS_KEY);
      }
      setHasLegacyBookmarks(Boolean(localStorage.getItem(SAVED_FRIENDS_KEY)));
      setLegacyStatus(remaining.length
        ? "Some bookmarks could not be imported and are still on this browser. Their owners may need to enable friend sharing."
        : "Browser bookmarks imported.");
    } catch {
      setLegacyStatus("Could not read the browser bookmarks.");
    } finally {
      setLegacyBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!myUsername) return;
    const url = `${window.location.origin}/friends?add=${encodeURIComponent(myUsername)}`;
    const copied = await copyText(url).catch(() => false);
    if (copied) {
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2500);
    } else {
      setError(`Could not copy automatically. Share this link: ${url}`);
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <p className="eyebrow">Account-synced friends & group stats</p>
          <h1>Friends</h1>
        </div>
        {myUsername && friendStatsEnabled ? (
          <button type="button" className="secondary-button" onClick={() => void copyInviteLink()}>
            {inviteCopied ? <Check size={16} /> : <Share2 size={16} />}
            {inviteCopied ? "Invite link copied!" : "Copy invite link"}
          </button>
        ) : null}
      </header>

      <section className="panel">
        <label>
          <input type="checkbox" checked={friendStatsEnabled} disabled={!myUsername || !accountId || sharingBusy}
            onChange={(event) => void updateSharing(event.target.checked)} />
          Share my stats with signed-in Geostats users who know my Geocaching username
        </label>
        <p className="muted">People can compare your summary and see overlapping finds. Anyone who saves you can see whether you found a cache. Your visit times stay private.</p>
      </section>

      <section className="panel friend-search-panel">
        <div>
          <h2>Find & save a friend</h2>
          <p className="muted">Friends appear here after they enable sharing. Your saved list syncs across devices.</p>
        </div>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="friend-username">
            Geocaching username
          </label>
          <input id="friend-username" maxLength={100} onChange={(event) => setUsername(event.target.value)} placeholder="Geocaching username" value={username} />
          <button className="primary-button" disabled={loading || !accountId} type="submit">
            {loading ? "Comparing..." : "Compare"}
          </button>
        </form>
        {error ? <p className="notice error">{error}</p> : null}
      </section>

      {hasLegacyBookmarks || legacyStatus ? (
        <section className="panel">
          {hasLegacyBookmarks ? (
            <>
              <p className="muted">This browser has old friend bookmarks. Import them only if they belong to you.</p>
              <button type="button" className="secondary-button" disabled={!accountId || legacyBusy} onClick={() => void importLegacyBookmarks()}>
                {legacyBusy ? "Importing…" : "Import my browser bookmarks"}
              </button>
            </>
          ) : null}
          {legacyStatus ? <p role="status">{legacyStatus}</p> : null}
        </section>
      ) : null}

      {sortedLeaderboard.length > 1 ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Group leaderboard</h2>
              <small className="muted">You and your saved friends ranked side by side.</small>
            </div>
            <select aria-label="Sort leaderboard by" value={sortMetric} onChange={(event) => setSortMetric(event.target.value as LeaderboardMetric)}>
              <option value="totalFinds">Total finds</option>
              <option value="countryCount">Countries</option>
              <option value="difficultyTerrainCount">D/T grid</option>
              <option value="longestStreak">Longest streak</option>
              <option value="ftfCount">FTFs</option>
            </select>
          </div>
          <div className="leaderboard-table">
            <div className="leaderboard-row leaderboard-head">
              <span>#</span>
              <span>Geocacher</span>
              <span>Finds</span>
              <span>Countries</span>
              <span>D/T</span>
              <span>Streak</span>
              <span>FTFs</span>
            </div>
            {sortedLeaderboard.map((entry, index) => (
              <div key={entry.username} className={`leaderboard-row${entry.isYou ? " is-you" : ""}`}>
                <strong>{index + 1}</strong>
                <span>
                  {entry.isYou ? (
                    <strong>{entry.username} (You)</strong>
                  ) : (
                    <button type="button" className="text-button" onClick={() => void compareWith(entry.username)}>
                      {entry.username}
                    </button>
                  )}
                </span>
                <strong>{entry.stats.totalFinds.toLocaleString()}</strong>
                <span>{entry.stats.countryCount}</span>
                <span>{entry.stats.difficultyTerrainCount}/81</span>
                <span>{entry.stats.longestStreak}d</span>
                <span>{entry.stats.ftfCount}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {savedFriends.length > 0 ? (
        <section className="panel friend-saved-panel">
          <h2>Saved friends</h2>
          <div className="friend-saved-list">
            {savedFriends.map((friend) => (
              <div key={friend}>
                <button className="text-button" onClick={() => void compareWith(friend)} type="button">
                  {friend}
                </button>
                <button aria-label={`Remove ${friend}`} className="friend-remove-button" onClick={() => void removeFriend(friend)} type="button">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {comparison ? (
        <>
          <section className="panel friend-comparison-panel">
            <div className="friend-comparison-heading">
              <div>
                <strong>{comparison.you.username}</strong>
                <small>{formatImportDate(comparison.you.latestImportAt)}</small>
              </div>
              <span>compared with</span>
              <div>
                <strong>{comparison.friend.username}</strong>
              </div>
            </div>
            <div className="friend-metric-table">
              <div className="friend-metric-header">
                <strong>{comparison.you.username}</strong>
                <span>Stat</span>
                <strong>{comparison.friend.username}</strong>
              </div>
              {metrics.map((metric) => {
                const you = comparison.you.stats[metric.key] as number;
                const friend = comparison.friend.stats[metric.key] as number;
                return (
                  <div key={metric.key}>
                    <strong className={you > friend ? "leader" : ""}>{you.toLocaleString()}</strong>
                    <span>{metric.label}</span>
                    <strong className={friend > you ? "leader" : ""}>{friend.toLocaleString()}</strong>
                  </div>
                );
              })}
            </div>
          </section>

          {comparison.dtOverlap || comparison.jasmerOverlap ? (
            <section className="panel">
              <h2>Grid overlap</h2>
              <div className="friend-overlap-grid">
                {comparison.dtOverlap ? (
                  <div className="friend-overlap-card">
                    <h3>D/T Matrix</h3>
                    <p>
                      <strong>{comparison.dtOverlap.both}</strong> shared ·{" "}
                      <strong>{comparison.dtOverlap.onlyYou}</strong> only {comparison.you.username} ·{" "}
                      <strong>{comparison.dtOverlap.onlyFriend}</strong> only {comparison.friend.username}
                    </p>
                  </div>
                ) : null}
                {comparison.jasmerOverlap ? (
                  <div className="friend-overlap-card">
                    <h3>Jasmer (Hidden months)</h3>
                    <p>
                      <strong>{comparison.jasmerOverlap.both}</strong> shared ·{" "}
                      <strong>{comparison.jasmerOverlap.onlyYou}</strong> only {comparison.you.username} ·{" "}
                      <strong>{comparison.jasmerOverlap.onlyFriend}</strong> only {comparison.friend.username}
                    </p>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="panel">
            <h2>Shared finds ({comparison.sharedFindsCount ?? 0})</h2>
            {comparison.recentSharedFinds && comparison.recentSharedFinds.length > 0 ? (
              <div className="table-list">
                {comparison.recentSharedFinds.map((find) => (
                  <div key={find.gcCode} className="table-row">
                    <a className="cache-link" href={`https://coord.info/${find.gcCode}`} rel="noreferrer" target="_blank">
                      <strong>{find.gcCode}</strong> {find.name}
                    </a>
                    <small className="muted">
                      You found it on {find.yourFoundAt.slice(0, 10)}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No caches found by both accounts yet.</p>
            )}
          </section>

          <section className="panel">
            <h2>Countries</h2>
            <div className="friend-country-grid">
              <CountryList title={`Both (${countryGroups?.shared.length ?? 0})`} countries={countryGroups?.shared ?? []} />
              <CountryList title={`Only ${comparison.you.username}`} countries={countryGroups?.onlyYou ?? []} />
              <CountryList title={`Only ${comparison.friend.username}`} countries={countryGroups?.onlyFriend ?? []} />
            </div>
          </section>

          <section className="panel">
            <h2>Finds by cache type</h2>
            <div className="friend-bucket-table">
              <div>
                <strong>Type</strong>
                <strong>{comparison.you.username}</strong>
                <strong>{comparison.friend.username}</strong>
              </div>
              {cacheTypeRows.map((row) => (
                <div key={row.key}>
                  <span>{row.key}</span>
                  <strong>{row.you.toLocaleString()}</strong>
                  <strong>{row.friend.toLocaleString()}</strong>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}
