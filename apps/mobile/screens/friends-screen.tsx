import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type FetchFn = <T>(apiBaseUrl: string, path: string, token: string, init?: RequestInit) => Promise<T>;

type LeaderboardRow = {
  username: string;
  isYou: boolean;
  stats: {
    totalFinds: number;
    countryCount: number;
    difficultyTerrainCount: number;
    longestStreak: number;
    ftfCount: number;
  };
};

export function FriendsScreen({
  apiBaseUrl,
  token,
  apiFetch
}: {
  apiBaseUrl: string;
  token: string;
  apiFetch: FetchFn;
}) {
  const [username, setUsername] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ friends: string[]; leaderboard: LeaderboardRow[] }>(apiBaseUrl, "/stats/friends", token);
      setLeaderboard(data.leaderboard);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load friends");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiBaseUrl, token]);

  async function addFriend() {
    if (!username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<{ friends: string[]; leaderboard: LeaderboardRow[] }>(apiBaseUrl, "/stats/friends", token, {
        method: "POST",
        body: JSON.stringify({ username: username.trim() })
      });
      setLeaderboard(data.leaderboard);
      setUsername("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add friend");
    } finally {
      setBusy(false);
    }
  }

  async function removeFriend(name: string) {
    setBusy(true);
    try {
      const data = await apiFetch<{ friends: string[]; leaderboard: LeaderboardRow[] }>(
        apiBaseUrl,
        `/stats/friends/${encodeURIComponent(name)}`,
        token,
        { method: "DELETE" }
      );
      setLeaderboard(data.leaderboard);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove friend");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...leaderboard].sort((a, b) => b.stats.totalFinds - a.stats.totalFinds);

  return (
    <View style={localStyles.container}>
      <Text style={localStyles.eyebrow}>ACCOUNT-SYNCED FRIENDS</Text>
      <Text style={localStyles.title}>Friends & Leaderboard</Text>
      <View style={localStyles.row}>
        <TextInput
          style={localStyles.input}
          placeholder="Geocaching username"
          placeholderTextColor="#7f9386"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <Pressable style={localStyles.button} disabled={busy} onPress={() => void addFriend()}>
          <Text style={localStyles.buttonText}>{busy ? "..." : "Add"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={localStyles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color="#7be08e" /> : null}
      {sorted.map((entry, index) => (
        <View key={entry.username} style={[localStyles.card, entry.isYou && localStyles.cardYou]}>
          <View style={localStyles.cardTop}>
            <Text style={localStyles.cardTitle}>
              #{index + 1} {entry.username}
              {entry.isYou ? " (You)" : ""}
            </Text>
            {!entry.isYou ? (
              <Pressable onPress={() => void removeFriend(entry.username)}>
                <Text style={localStyles.remove}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={localStyles.meta}>
            {entry.stats.totalFinds.toLocaleString()} finds · {entry.stats.countryCount} countries · {entry.stats.difficultyTerrainCount}/81 D/T · {entry.stats.ftfCount} FTFs
          </Text>
        </View>
      ))}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: { gap: 12 },
  eyebrow: { color: "#8fb39a", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#f1f6f2", fontSize: 22, fontWeight: "800" },
  row: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: "#14221a", color: "#f1f6f2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#253c2e" },
  button: { backgroundColor: "#4fb46a", borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  buttonText: { color: "#07140b", fontWeight: "700" },
  error: { color: "#f87171" },
  card: { backgroundColor: "#121f18", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#22382b", gap: 4 },
  cardYou: { borderColor: "#4fb46a" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: "#f1f6f2", fontSize: 16, fontWeight: "700" },
  remove: { color: "#f87171", fontSize: 13 },
  meta: { color: "#9eb5a5", fontSize: 13 }
});
