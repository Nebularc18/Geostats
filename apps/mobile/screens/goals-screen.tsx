import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type FetchFn = <T>(apiBaseUrl: string, path: string, token: string, init?: RequestInit) => Promise<T>;

type GoalItem = {
  id: string;
  title: string;
  kind: string;
  target: number;
  current: number;
  remaining: number;
  percent: number;
  completed: boolean;
  archived: boolean;
};

export function GoalsScreen({
  apiBaseUrl,
  token,
  apiFetch
}: {
  apiBaseUrl: string;
  token: string;
  apiFetch: FetchFn;
}) {
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ goals: GoalItem[] }>(apiBaseUrl, "/goals", token);
      setGoals(data.goals);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load goals");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [apiBaseUrl, token]);

  async function quickAdd(title: string, kind: string, target: number) {
    try {
      await apiFetch(apiBaseUrl, "/goals", token, {
        method: "POST",
        body: JSON.stringify({ title, kind, target })
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create goal");
    }
  }

  async function toggleArchive(goal: GoalItem) {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<{ goal: GoalItem }>(apiBaseUrl, `/goals/${goal.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ archived: !goal.archived })
      });
      setGoals((current) => current.map((item) => item.id === goal.id ? response.goal : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update goal");
    } finally {
      setBusy(false);
    }
  }

  const activeGoals = goals.filter((goal) => !goal.archived);
  const archivedGoals = goals.filter((goal) => goal.archived);

  return (
    <View style={localStyles.container}>
      <Text style={localStyles.eyebrow}>ACCOUNT-SYNCED TARGETS</Text>
      <Text style={localStyles.title}>Goals</Text>
      {error ? <Text style={localStyles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color="#7be08e" /> : null}
      {!loading && activeGoals.length === 0 ? (
        <View style={localStyles.card}>
          <Text style={localStyles.meta}>No active goals. Add a starter goal:</Text>
          <Pressable style={localStyles.button} onPress={() => void quickAdd("Complete the 81 D/T grid", "DT_GRID", 81)}>
            <Text style={localStyles.buttonText}>+ Complete 81 D/T Grid</Text>
          </Pressable>
        </View>
      ) : null}
      {activeGoals.map((goal) => (
        <View key={goal.id} style={[localStyles.card, goal.completed && localStyles.cardDone]}>
          <Text style={localStyles.cardTitle}>{goal.title}</Text>
          <Text style={localStyles.meta}>
            {goal.current.toLocaleString()} / {goal.target.toLocaleString()} ({goal.percent}%)
          </Text>
          <View style={localStyles.track}>
            <View style={[localStyles.fill, { width: `${goal.percent}%` }]} />
          </View>
          <Pressable accessibilityRole="button" disabled={busy} style={localStyles.button} onPress={() => void toggleArchive(goal)}>
            <Text style={localStyles.buttonText}>Archive</Text>
          </Pressable>
        </View>
      ))}
      {archivedGoals.length > 0 ? <Text style={localStyles.title}>Archived goals</Text> : null}
      {archivedGoals.map((goal) => (
        <View key={goal.id} style={localStyles.card}>
          <Text style={localStyles.cardTitle}>{goal.title}</Text>
          <Pressable accessibilityRole="button" disabled={busy} style={localStyles.button} onPress={() => void toggleArchive(goal)}>
            <Text style={localStyles.buttonText}>Restore</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: { gap: 12 },
  eyebrow: { color: "#8fb39a", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#f1f6f2", fontSize: 22, fontWeight: "800" },
  error: { color: "#f87171" },
  card: { backgroundColor: "#121f18", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#22382b", gap: 8 },
  cardDone: { borderColor: "#4fb46a" },
  cardTitle: { color: "#f1f6f2", fontSize: 16, fontWeight: "700" },
  meta: { color: "#9eb5a5", fontSize: 13 },
  track: { height: 8, backgroundColor: "#22382b", borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: "#4fb46a", borderRadius: 999 },
  button: { backgroundColor: "#4fb46a", borderRadius: 10, padding: 10, alignItems: "center" },
  buttonText: { color: "#07140b", fontWeight: "700" }
});
