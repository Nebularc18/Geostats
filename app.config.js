const fs = require("fs");
const path = require("path");

const projectId = "08a3cc2d-e083-4cda-b8ad-96301c663253";

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") ?? "";
}

const androidGoogleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  readEnvValue(path.join(__dirname, "apps", "mobile", ".env"), "EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY");

module.exports = {
  expo: {
    name: "Geostats",
    slug: "geostats",
    scheme: "geostats",
    version: "0.2.0",
    runtimeVersion: { policy: "appVersion" },
    updates: {
      url: `https://u.expo.dev/${projectId}`,
      checkAutomatically: "ON_LOAD"
    },
    orientation: "portrait",
    icon: "./apps/mobile/assets/icon.png",
    userInterfaceStyle: "dark",
    ios: {
      supportsTablet: true
    },
    android: {
      package: "com.hampu.geostats",
      versionCode: 5,
      adaptiveIcon: {
        backgroundColor: "#07110d",
        foregroundImage: "./apps/mobile/assets/android-icon-foreground.png",
        backgroundImage: "./apps/mobile/assets/android-icon-background.png",
        monochromeImage: "./apps/mobile/assets/android-icon-monochrome.png"
      },
      predictiveBackGestureEnabled: false
    },
    web: {
      favicon: "./apps/mobile/assets/favicon.png"
    },
    extra: {
      eas: {
        projectId
      }
    },
    plugins: [
      "expo-secure-store",
      [
        "react-native-maps",
        {
          androidGoogleMapsApiKey
        }
      ]
    ]
  }
};
