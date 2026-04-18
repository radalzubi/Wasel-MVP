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
    bundleIdentifier: 'com.wasel.driver',
    supportsTablet:   false,
    infoPlist: {
      UIBackgroundModes: ['location', 'fetch'],
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
    googleServicesFile: './google-services.json',
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
      projectId: 'DRIVER_EAS_PROJECT_ID',
    },
  },
});
