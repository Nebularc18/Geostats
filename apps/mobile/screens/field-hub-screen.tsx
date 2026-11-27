import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  a1z26Encode,
  atbash,
  formatCoordinateDd,
  formatCoordinateDdm,
  morseDecode,
  parseAnyCoordinate,
  projectCoordinate,
  rot13
} from "@geostats/shared";
import { loadOfflineFieldNotes, saveOfflineFieldNotes, type OfflineFieldNote } from "../offline-store";

type ToolMode = "notes" | "ciphers" | "project";

export function FieldHubScreen({ userId }: { userId: string }) {
  const [mode, setMode] = useState<ToolMode>("notes");

  // Offline field notes
  const [notes, setNotes] = useState<OfflineFieldNote[]>([]);
  const [gcCode, setGcCode] = useState("");
  const [noteText, setNoteText] = useState("");

  // Cipher helper
  const [cipherText, setCipherText] = useState("");

  // Waypoint projection
  const [originText, setOriginText] = useState("N 56° 09.672 E 015° 35.964");
  const [distance, setDistance] = useState("150");
  const [bearing, setBearing] = useState("90");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void loadOfflineFieldNotes(userId).then(setNotes);
  }, [userId]);

  async function addNote() {
    const cleanCode = gcCode.trim().toUpperCase();
    const cleanNote = noteText.trim();
    if (!cleanCode || !cleanNote) return;
    const next: OfflineFieldNote[] = [
      { id: `${Date.now()}`, gcCode: cleanCode, note: cleanNote, createdAt: new Date().toISOString() },
      ...notes
    ];
    setNotes(next);
    setGcCode("");
    setNoteText("");
    await saveOfflineFieldNotes(userId, next);
  }

  async function deleteNote(id: string) {
    const next = notes.filter((item) => item.id !== id);
    setNotes(next);
    await saveOfflineFieldNotes(userId, next);
  }

  const a1 = useMemo(() => a1z26Encode(cipherText), [cipherText]);
  const originCoord = useMemo(() => parseAnyCoordinate(originText), [originText]);
  const projected = useMemo(() => {
    const dist = Number(distance);
    const brg = Number(bearing);
    if (!originCoord || !Number.isFinite(dist) || dist < 0 || !Number.isFinite(brg)) return null;
    return projectCoordinate(originCoord.latitude, originCoord.longitude, dist, brg, "m");
  }, [originCoord, distance, bearing]);

  async function copyProjected() {
    if (!projected) return;
    await Clipboard.setStringAsync(formatCoordinateDdm(projected.latitude, projected.longitude));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <View style={localStyles.container}>
      <Text style={localStyles.eyebrow}>OFFLINE FIELD COMPANION</Text>
      <Text style={localStyles.title}>Field Toolkit</Text>

      <View style={localStyles.tabs}>
        {([
          { id: "notes", label: "Offline Notes" },
          { id: "ciphers", label: "Ciphers" },
          { id: "project", label: "Project" }
        ] as const).map((tab) => (
          <Pressable
            key={tab.id}
            style={[localStyles.tab, mode === tab.id && localStyles.tabActive]}
            onPress={() => setMode(tab.id)}
          >
            <Text style={[localStyles.tabText, mode === tab.id && localStyles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "notes" ? (
        <View style={localStyles.card}>
          <Text style={localStyles.sectionTitle}>Draft field note (saved offline on device)</Text>
          <TextInput
            style={localStyles.input}
            placeholder="GC code (e.g. GC9F3A2)"
            placeholderTextColor="#7f9386"
            value={gcCode}
            onChangeText={setGcCode}
            autoCapitalize="characters"
          />
          <TextInput
            style={[localStyles.input, { minHeight: 72, textAlignVertical: "top" }]}
            placeholder="Quick trail note, clue, or log draft..."
            placeholderTextColor="#7f9386"
            value={noteText}
            onChangeText={setNoteText}
            multiline
          />
          <Pressable style={localStyles.button} onPress={() => void addNote()}>
            <Text style={localStyles.buttonText}>Save offline note</Text>
          </Pressable>

          {notes.map((item) => (
            <View key={item.id} style={localStyles.noteRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={localStyles.noteCode}>{item.gcCode}</Text>
                <Text style={localStyles.noteBody}>{item.note}</Text>
              </View>
              <Pressable onPress={() => void deleteNote(item.id)}>
                <Text style={localStyles.remove}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {mode === "ciphers" ? (
        <View style={localStyles.card}>
          <Text style={localStyles.sectionTitle}>Instant offline cipher decoder</Text>
          <TextInput
            style={localStyles.input}
            placeholder="Enter puzzle text or Morse..."
            placeholderTextColor="#7f9386"
            value={cipherText}
            onChangeText={setCipherText}
          />
          {cipherText.trim() ? (
            <View style={{ gap: 8 }}>
              <Text style={localStyles.resultLine}>ROT13: {rot13(cipherText)}</Text>
              <Text style={localStyles.resultLine}>Atbash: {atbash(cipherText)}</Text>
              <Text style={localStyles.resultLine}>A1Z26: {a1.encoded} (sum {a1.wordValue}, root {a1.digitalRoot})</Text>
              <Text style={localStyles.resultLine}>Morse → Text: {morseDecode(cipherText)}</Text>
            </View>
          ) : (
            <Text style={localStyles.meta}>Works completely offline on the trail.</Text>
          )}
        </View>
      ) : null}

      {mode === "project" ? (
        <View style={localStyles.card}>
          <Text style={localStyles.sectionTitle}>Waypoint projection (meters + bearing)</Text>
          <TextInput
            style={localStyles.input}
            placeholder="Origin (DDM, DD, or DMS)"
            placeholderTextColor="#7f9386"
            value={originText}
            onChangeText={setOriginText}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[localStyles.input, { flex: 1 }]}
              placeholder="Meters"
              placeholderTextColor="#7f9386"
              keyboardType="numeric"
              value={distance}
              onChangeText={setDistance}
            />
            <TextInput
              style={[localStyles.input, { flex: 1 }]}
              placeholder="Bearing (°)"
              placeholderTextColor="#7f9386"
              keyboardType="numeric"
              value={bearing}
              onChangeText={setBearing}
            />
          </View>
          {projected ? (
            <View style={{ gap: 6 }}>
              <Text style={localStyles.resultLine}>DDM: {formatCoordinateDdm(projected.latitude, projected.longitude)}</Text>
              <Text style={localStyles.meta}>DD: {formatCoordinateDd(projected.latitude, projected.longitude)}</Text>
              <Pressable style={localStyles.button} onPress={() => void copyProjected()}>
                <Text style={localStyles.buttonText}>{copied ? "Copied!" : "Copy projected DDM"}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={localStyles.meta}>Enter valid origin coordinates, distance, and bearing.</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: { gap: 12 },
  eyebrow: { color: "#8fb39a", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: "#f1f6f2", fontSize: 22, fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: "#253c2e", alignItems: "center", backgroundColor: "#121f18" },
  tabActive: { borderColor: "#4fb46a", backgroundColor: "#1b3324" },
  tabText: { color: "#9eb5a5", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#a7f3bd" },
  card: { backgroundColor: "#121f18", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#22382b", gap: 10 },
  sectionTitle: { color: "#f1f6f2", fontSize: 15, fontWeight: "700" },
  input: { backgroundColor: "#0c1510", color: "#f1f6f2", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#253c2e" },
  button: { backgroundColor: "#4fb46a", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  buttonText: { color: "#07140b", fontWeight: "700" },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#1f3227" },
  noteCode: { color: "#5fbf85", fontWeight: "700", fontSize: 13 },
  noteBody: { color: "#d4e3d9", fontSize: 13 },
  remove: { color: "#f87171", fontSize: 12 },
  resultLine: { color: "#a7f3bd", fontSize: 13, fontWeight: "600" },
  meta: { color: "#9eb5a5", fontSize: 12 }
});
