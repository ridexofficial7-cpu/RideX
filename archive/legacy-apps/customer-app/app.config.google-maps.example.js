// Merge this Google Maps configuration into your existing Expo app.config.js/app.config.ts.
// Keep your existing Expo config; do not replace unrelated settings.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins || []).filter((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      return name !== 'react-native-maps';
    }),
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    ],
  ],
});
