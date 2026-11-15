import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { mysteryBrowserCaptureScript } from "@geostats/shared";
import { browserCapturedMystery } from "./mystery-tools";
import { MAX_MYSTERY_SNAPSHOT_BYTES, mysterySnapshotByteLength } from "./mystery-storage";

type BrowserListing = NonNullable<ReturnType<typeof browserCapturedMystery>>;
export function MysteryBrowser({ gcCode, onImport, onClose }: { gcCode: string; onImport: (listing: BrowserListing) => void; onClose: () => void }) {
  const browser = useRef<WebView>(null);
  const manualCapture = useRef(false);
  const imported = useRef(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("Sign in on Geocaching if asked. The cache imports when its listing is available. Your login stays on this phone.");
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
        <Text style={styles.title}>{gcCode}</Text>
        <Pressable accessibilityRole="button" onPress={() => { manualCapture.current = true; browser.current?.injectJavaScript(mysteryBrowserCaptureScript()); }} style={styles.button}><Text style={styles.buttonText}>Import this page</Text></Pressable>
      </View>
      <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>
      {loading ? <ActivityIndicator color="#5fbf85" /> : null}
      <WebView ref={browser} source={{ uri: `https://www.geocaching.com/geocache/${gcCode}` }} style={styles.browser}
        sharedCookiesEnabled thirdPartyCookiesEnabled={false} setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => {
          if (request.isTopFrame === false) return true;
          try {
            const url = new URL(request.url);
            if (url.protocol === "https:" && (url.hostname === "geocaching.com" || url.hostname.endsWith(".geocaching.com"))) return true;
            if (url.protocol === "about:") return true;
            if (url.protocol === "https:") void Linking.openURL(url.href).catch(() => setNotice("Could not open this link."));
          } catch { /* Block malformed navigation. */ }
          return false;
        }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => { setLoading(false); browser.current?.injectJavaScript(mysteryBrowserCaptureScript()); }}
        onError={() => { setLoading(false); setNotice("Could not load Geocaching. Check your connection, reload the page, or import a GPX instead."); }}
        onMessage={(event) => {
          if (imported.current || event.nativeEvent.data.length > 300_000) return;
          try {
            const source = new URL(event.nativeEvent.url);
            if (source.protocol !== "https:" || !["www.geocaching.com", "geocaching.com"].includes(source.hostname)) return;
            const message = JSON.parse(event.nativeEvent.data);
            if (message.type !== "geostats-mystery-page") return;
            const listing = browserCapturedMystery(message.data, gcCode);
            if (!listing) {
              if (manualCapture.current) setNotice("Open this cache's full listing and coordinates first. Sign in or check your access on Geocaching if needed.");
              manualCapture.current = false;
              return;
            }
            if (mysterySnapshotByteLength(listing) > MAX_MYSTERY_SNAPSHOT_BYTES - 2000) { setNotice("This listing is too large to sync. Use a GPX with a shorter description."); return; }
            imported.current = true;
            onImport(listing);
          } catch { setNotice("Could not read this listing. Try Import this page again."); }
        }} />
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0d120f" }, browser: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 8, gap: 8 },
  title: { color: "#edf4e8", fontWeight: "700" }, button: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  buttonText: { color: "#5fbf85", fontWeight: "600" }, notice: { color: "#d6e2d5", padding: 12 }
});
