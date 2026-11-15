const fs = require("fs");
const path = require("path");

const projectId = "08a3cc2d-e083-4cda-b8ad-96301c663253";

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`));
  return (
    line
      ?.slice(line.indexOf("=") + 1)
      .trim()
      .replace(/^["']|["']$/g, "") ?? ""
  );
}

const androidGoogleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  readEnvValue(
    path.join(__dirname, "..", "apps", "mobile", ".env"),
    "EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY",
  );

module.exports = function expoConfig(assetRoot) {
  return {
    expo: {
      name: "Geostats",
      slug: "geostats",
      scheme: "geostats",
      version: "0.3.0",
      runtimeVersion: { policy: "appVersion" },
      updates: {
        url: `https://u.expo.dev/${projectId}`,
        checkAutomatically: "ON_ERROR_RECOVERY",
      },
      orientation: "portrait",
      icon: `${assetRoot}/icon.png`,
      userInterfaceStyle: "dark",
      ios: {
        supportsTablet: true,
        bundleIdentifier: "com.hampu.geostats",
      },
      android: {
        package: "com.hampu.geostats",
        versionCode: 6,
        adaptiveIcon: {
          backgroundColor: "#07110d",
          foregroundImage: `${assetRoot}/android-icon-foreground.png`,
          monochromeImage: `${assetRoot}/android-icon-monochrome.png`,
        },
        predictiveBackGestureEnabled: false,
      },
      web: {
        favicon: `${assetRoot}/favicon.png`,
      },
      extra: {
        eas: {
          projectId,
        },
      },
      plugins: [
        "@clerk/expo",
        "expo-secure-store",
        [
          "expo-sharing",
          {
            android: {
              enabled: true,
              singleShareMimeTypes: ["text/plain", "text/uri-list"],
            },
            ios: {
              enabled: true,
              activationRule: { supportsText: true, supportsWebUrlWithMaxCount: 1 },
            },
          },
        ],
        [
          "react-native-maps",
          {
            androidGoogleMapsApiKey,
          },
        ],
      ],
    },
  };
};
