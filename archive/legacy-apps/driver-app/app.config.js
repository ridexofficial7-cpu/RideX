const appJson = require("./app.json");

module.exports = ({ config }) => {
  const baseExpo = appJson?.expo || {};

  const baseConfig = {
    ...baseExpo,
    ...config,
  };

  const plugins = Array.isArray(baseConfig.plugins)
    ? [...baseConfig.plugins]
    : [];

  const withoutMapsPlugin = plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "react-native-maps";
  });

  withoutMapsPlugin.push([
    "react-native-maps",
    {
      androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
  ]);

  return {
    ...baseConfig,
    plugins: withoutMapsPlugin,
  };
};