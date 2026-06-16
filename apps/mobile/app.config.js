const { expo } = require("./app.json");

const androidGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ?? "";

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
