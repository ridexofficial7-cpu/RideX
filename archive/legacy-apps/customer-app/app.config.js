const appJson = require("./app.json");

module.exports = ({ config }) => {
  const baseExpo = appJson?.expo || {};
  const baseConfig = {
    ...baseExpo,
    ...config,
  };

  const plugins = Array.isArray(baseConfig.plugins) ? [...baseConfig.plugins] : [];
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || process.env.NODE_ENV || "").toLowerCase();
  const mapsKey = String(process.env.GOOGLE_MAPS_API_KEY || "").trim();
  if ((buildProfile === "production" || buildProfile === "prod") && !mapsKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required for a production RideX Customer build");
  }

  const withoutMapsPlugin = plugins.filter((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name !== "react-native-maps";
  });

  withoutMapsPlugin.push([
    "react-native-maps",
    {
      androidGoogleMapsApiKey: mapsKey,
      iosGoogleMapsApiKey: mapsKey,
    },
  ]);

  return {
    ...baseConfig,
    plugins: withoutMapsPlugin,
  };
};
