// Dynamic Expo config — replaces app.json so secrets can be injected
// via environment variables instead of being committed to source control.
//
// See rider/app.config.js for full documentation on the setup pattern.
//
// IMPORTANT: The key that was previously hardcoded in app.json
// (<GOOGLE_MAPS_API_KEY>) is now in the git history
// and must be rotated in Google Cloud Console. The new key should only
// exist in .env (gitignored) and EAS secrets.

/** @type {import('@expo/config').ConfigContext} */
module.exports = ({ config }) => ({
  ...config,
  name:             'Wasel Driver',
  slug:             'wasel-driver',
  version:          '1.0.0',
  scheme:           'wasel-driver',
  orientation:      'portrait',
  icon:             './assets/icon.png',
  userInterfaceStyle: 'dark',
  newArchEnabled:   true,
  splash: {
    image:           './assets/splash-icon.png',
    resizeMode:      'contain',
    backgroundColor: '#0A0A0A',
  },
  ios: {
    bundleIdentifier: 'com.wasel.driver',
    supportsTablet:   false,
    infoPlist: {
      // NOTE: UIBackgroundModes deliberately omitted — Expo Go's Info.plist does NOT
      // declare background modes, so requesting them here does nothing in Expo Go
      // and attempting background-gated APIs crashes. Ship via a dev-client build
      // (eas build --profile development) when you need true background location.
      LSApplicationQueriesSchemes: ['comgooglemaps', 'googlemaps', 'maps'],
    },
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
  },
  android: {
    package: 'com.wasel.driver',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    // googleServicesFile intentionally omitted — the file does not exist.
    // Re-add only when you have a real Firebase google-services.json to ship
    // (and guard it: `...(fs.existsSync(...) ? { googleServicesFile } : {})`).
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        // Permission strings only. Background/foreground-service flags removed —
        // they mutate the Android manifest at prebuild time and are ignored by
        // Expo Go (whose native binary is fixed). Re-enable in a dev-client
        // profile when you're ready to ship background-location for real.
        locationAlwaysAndWhenInUsePermission:
          'Wasel needs your location in the background to show riders your position while driving.',
        locationWhenInUsePermission:
          'Wasel needs your location to show you nearby trips.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/icon.png',
        color: '#F5A623',
        defaultChannel: 'wasel-trips',
        sounds: [],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: 'd1af7738-a8f5-4d66-a345-2edab1854b25',
    },
  },
});
