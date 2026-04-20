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
  newArchEnabled:   false,
  splash: {
    image:           './assets/splash-icon.png',
    resizeMode:      'contain',
    backgroundColor: '#0A0A0A',
  },
  ios: {
    bundleIdentifier: 'com.waselapp.driver',
    supportsTablet:   false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // UIBackgroundModes is ignored by Expo Go (fixed binary) but takes effect
      // in every EAS build (dev-client, preview, production). The runtime code
      // already gates Location.requestBackgroundPermissionsAsync() behind
      // !IS_EXPO_GO so Expo Go never calls it; native builds get it correctly.
      UIBackgroundModes: ['location', 'fetch'],
      LSApplicationQueriesSchemes: ['comgooglemaps', 'googlemaps', 'maps'],
    },
    config: {
      // Fall back to empty string so the config plugin writes '' rather than
      // 'undefined' / null to the native plist. An empty key prevents the
      // Google Maps SDK from throwing NSInternalInconsistencyException on launch
      // when the env var is missing (e.g. local dev without a .env file).
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
    },
  },
  android: {
    package: 'com.waselapp.driver',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
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
        locationAlwaysAndWhenInUsePermission:
          'Wasel needs your location in the background to show riders your position while driving.',
        locationWhenInUsePermission:
          'Wasel needs your location to show you nearby trips.',
        isAndroidForegroundServiceEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        androidForegroundServiceNotificationTitle: 'Wasel Driver — Active',
        androidForegroundServiceNotificationBody:  'Your location is being shared with riders.',
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
