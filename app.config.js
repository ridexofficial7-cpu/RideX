module.exports = ({ config }) => ({
  ...config,
  plugins: [
    "./plugins/withRideXAuroraCanvas",
    ...(config.plugins || []).filter((plugin) => {
      if (Array.isArray(plugin)) {
        return plugin[0] !== "react-native-maps";
      }
      return plugin !== "react-native-maps";
    }),
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey:
          process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
          process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
      },
    ],
  ],
});