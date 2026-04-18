// Dynamic Expo config — replaces app.json so secrets can be injected
// via environment variables instead of being committed to source control.
//
// Local development:
//   Create rider/.env with GOOGLE_MAPS_API_KEY=<your-key>
//   The Expo CLI reads .env files automatically (SDK 49+).
//   For older SDK versions, add: require('dotenv').config() at the top.
//
// EAS Build / CI:
//   Set GOOGLE_MAPS_API_KEY as an EAS secret or CI environment variable.
//   It will be available as process.env.GOOGLE_MAPS_API_KEY at build time.
//
// IMPORTANT: The key that was previously hardcoded in app.json
// (<GOOGLE_MAPS_API_KEY>) is now in the git history
// and must be rotated in Google Cloud Console. The new key should only
// exist in .env (gitignored) and EAS secrets.

/** @type {import('@expo/config').ConfigContext} */
module.exports = ({ config }) => ({
  ...config,
  name:             'Wasel Rider',
  slug:             'wasel-rider',
  version:          '1.0.0',
  scheme:           'wasel-rider',
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
    bundleIdentifier: 'com.wasel.rider',
    supportsTablet:   false,
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
  },
  android: {
    package: 'com.wasel.rider',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0A0A',
    },
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: 'Wasel needs your location to find nearby drivers.',
        locationWhenInUsePermission:          'Wasel needs your location to find nearby drivers.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    eas: {
      projectId: '0cc4d834-9135-44ea-b41e-dd51fb20e007',
    },
  },
});
