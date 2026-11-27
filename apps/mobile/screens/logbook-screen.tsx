import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "30" });
      if (query.trim()) params.set("q", query.trim());
      void apiFetch<{ finds: FindEntry[]; total: number }>(apiBaseUrl, `/stats/finds?${params.toString()}`, token)
        .then((res) => {
          if (active) {
            setFinds(res.finds);
            setTotal(res.total);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [apiBaseUrl, query, token]);

  return (
    <View style={localStyles.container}>
      <Text style={localStyles.eyebrow}>SEARCHABLE FIND ARCHIVE</Text>
      <Text style={localStyles.title}>Logbook ({total.toLocaleString()})</Text>
      <TextInput
        style={localStyles.input}
        placeholder="Search logs, names, GC codes..."
        placeholderTextColor="#7f9386"
        value={query}
        onChangeText={setQuery}
      />
      {loading ? <ActivityIndicator color="#7be08e" /> : null}
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
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: { gap: 12 },
  eyebrow: { color: "#8fb39a", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#f1f6f2", fontSize: 22, fontWeight: "800" },
  input: { backgroundColor: "#14221a", color: "#f1f6f2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#253c2e" },
  card: { backgroundColor: "#121f18", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#22382b", gap: 4 },
  cardTitle: { color: "#f1f6f2", fontSize: 15, fontWeight: "700" },
  meta: { color: "#9eb5a5", fontSize: 12 },
  log: { color: "#d4e3d9", fontSize: 13, marginTop: 4 }
});
