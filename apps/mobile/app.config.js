const fs = require("fs");
const path = require("path");
const { expo } = require("./app.json");

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}=`));
  return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") ?? "";
}

const androidGoogleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ??
  readEnvValue(path.join(__dirname, ".env"), "EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY");

module.exports = {
  expo: {
    ...expo,
    plugins: [
      ...(expo.plugins ?? []),
      [
        "react-native-maps",
        {
          androidGoogleMapsApiKey
        }
      ]
    ]
  }
};
