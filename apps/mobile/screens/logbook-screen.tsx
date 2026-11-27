import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

type FetchFn = <T>(apiBaseUrl: string, path: string, token: string, init?: RequestInit) => Promise<T>;

type FindEntry = {
  id: string;
  gcCode: string;
  name: string;
  foundDate: string;
  cacheType: string | null;
  difficulty: number | null;
  terrain: number | null;
  isFtf: boolean;
  logText: string | null;
};

export function LogbookScreen({
  apiBaseUrl,
  token,
  apiFetch
}: {
  apiBaseUrl: string;
  token: string;
  apiFetch: FetchFn;
}) {
  const [query, setQuery] = useState("");
  const [finds, setFinds] = useState<FindEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFinds([]);
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ limit: "30", offset: String(offset), facets: "false" });
      if (query.trim()) params.set("q", query.trim());
      void apiFetch<{ finds: FindEntry[]; total: number; hasMore: boolean }>(apiBaseUrl, `/stats/finds?${params}`, token)
        .then((res) => {
          if (!active) return;
          setFinds(res.finds);
          setTotal(res.total);
          setHasMore(res.hasMore);
        })
        .catch(() => {
          if (active) setError("Could not load finds.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [apiBaseUrl, apiFetch, offset, query, retry, token]);

  return (
    <View style={localStyles.container}>
      <Text style={localStyles.eyebrow}>SEARCHABLE FIND ARCHIVE</Text>
      <Text style={localStyles.title}>Logbook ({total.toLocaleString()})</Text>
      <TextInput
        style={localStyles.input}
        placeholder="Search logs, names, GC codes..."
        placeholderTextColor="#7f9386"
        value={query}
        onChangeText={(value) => { setQuery(value); setOffset(0); }}
      />
      {loading ? <ActivityIndicator color="#7be08e" /> : null}
      {error ? (
        <View>
          <Text accessibilityRole="alert" style={localStyles.meta}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}>
            <Text style={localStyles.action}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {finds.map((find) => (
        <View key={find.id} style={localStyles.card}>
          <Text style={localStyles.cardTitle}>
            {find.gcCode} · {find.name}
          </Text>
          <Text style={localStyles.meta}>
            {find.foundDate} · {find.cacheType ?? "Unknown"}
            {find.difficulty != null && find.terrain != null ? ` · D${find.difficulty}/T${find.terrain}` : ""}
            {find.isFtf ? " · FTF" : ""}
          </Text>
          {find.logText ? <Text style={localStyles.log} numberOfLines={3}>{find.logText}</Text> : null}
        </View>
      ))}
      {!loading && !error && (offset > 0 || hasMore) ? (
        <View style={localStyles.pagination}>
          {offset > 0 ? <Pressable accessibilityRole="button" onPress={() => setOffset(Math.max(0, offset - 30))}><Text style={localStyles.action}>Previous page</Text></Pressable> : null}
          {hasMore ? <Pressable accessibilityRole="button" onPress={() => setOffset(offset + 30)}><Text style={localStyles.action}>Next page</Text></Pressable> : null}
        </View>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  action: { color: "#7be08e", paddingVertical: 10 },
  pagination: { flexDirection: "row", gap: 16 },
  container: { gap: 12 },
  eyebrow: { color: "#8fb39a", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#f1f6f2", fontSize: 22, fontWeight: "800" },
  input: { backgroundColor: "#14221a", color: "#f1f6f2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#253c2e" },
  card: { backgroundColor: "#121f18", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#22382b", gap: 4 },
  cardTitle: { color: "#f1f6f2", fontSize: 15, fontWeight: "700" },
  meta: { color: "#9eb5a5", fontSize: 12 },
  log: { color: "#d4e3d9", fontSize: 13, marginTop: 4 }
});
