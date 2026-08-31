"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../../components/app-shell";
import { apiFetch } from "../../lib/api";
import { comparisonBucketRows, comparisonCountries, FriendComparison, readSavedFriends } from "../../lib/friend-comparison";

const SAVED_FRIENDS_KEY = "geostats-saved-friends";

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
  const [comparison, setComparison] = useState<FriendComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSavedFriends(readSavedFriends(localStorage.getItem(SAVED_FRIENDS_KEY)));
  }, []);

  const countryGroups = useMemo(() => (comparison ? comparisonCountries(comparison.you.stats.countries, comparison.friend.stats.countries) : null), [comparison]);
  const cacheTypeRows = useMemo(() => (comparison ? comparisonBucketRows(comparison.you.stats.cacheTypes, comparison.friend.stats.cacheTypes) : []), [comparison]);

  function storeFriends(friends: string[]) {
    setSavedFriends(friends);
    localStorage.setItem(SAVED_FRIENDS_KEY, JSON.stringify(friends));
  }

  async function compareWith(candidate: string) {
    const cleanUsername = candidate.trim();
    if (!cleanUsername) {
      setError("Enter a geocaching username.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<FriendComparison>(`/stats/compare/${encodeURIComponent(cleanUsername)}`);
      setComparison(result);
      setUsername(result.friend.username);
      storeFriends([result.friend.username, ...savedFriends.filter((friend) => friend.toLowerCase() !== result.friend.username.toLowerCase())].slice(0, 20));
    } catch (requestError) {
      setComparison(null);
      setError(requestError instanceof Error ? requestError.message : "Could not compare profiles.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void compareWith(username);
  }

  function removeFriend(friend: string) {
    storeFriends(savedFriends.filter((candidate) => candidate !== friend));
    if (comparison?.friend.username === friend) {
      setComparison(null);
    }
  }

  return (
    <AppShell>
      <header className="page-header">
        <p className="eyebrow">Side-by-side stats</p>
        <h1>Friend comparison</h1>
      </header>

      <section className="panel friend-search-panel">
        <div>
          <h2>Find a friend</h2>
          <p className="muted">They need a Geostats profile. Search by their exact geocaching username.</p>
        </div>
        <form onSubmit={submit}>
          <label className="sr-only" htmlFor="friend-username">
            Geocaching username
          </label>
          <input id="friend-username" maxLength={100} onChange={(event) => setUsername(event.target.value)} placeholder="Geocaching username" value={username} />
          <button className="primary-button" disabled={loading} type="submit">
            {loading ? "Comparing..." : "Compare"}
          </button>
        </form>
        {error ? <p className="notice error">{error}</p> : null}
      </section>

      {savedFriends.length > 0 ? (
        <section className="panel friend-saved-panel">
          <h2>Saved on this device</h2>
          <div className="friend-saved-list">
            {savedFriends.map((friend) => (
              <div key={friend}>
                <button className="text-button" onClick={() => void compareWith(friend)} type="button">
                  {friend}
                </button>
                <button aria-label={`Remove ${friend}`} className="friend-remove-button" onClick={() => removeFriend(friend)} type="button">
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
                <small>{formatImportDate(comparison.friend.latestImportAt)}</small>
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
