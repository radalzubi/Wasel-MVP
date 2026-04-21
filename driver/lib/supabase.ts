import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Log a clear warning if env vars are missing rather than throwing at module
// scope. A module-level throw bypasses React's ErrorBoundary entirely — it
// crashes the JS runtime before any component mounts, showing a blank white
// screen on iOS with no recovery path. console.error gives the same
// diagnostic signal in Metro/Flipper without killing the app.
if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[driver/supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Check driver/.env is present and that `expo start` picked it up.'
  );
}

// AsyncStorage is used instead of expo-secure-store because Supabase sessions
// exceed the 2048-byte iOS Keychain value limit, causing SecureStore to throw
// and the SDK to fire SIGNED_OUT immediately after login. AsyncStorage has no
// size limit and is standard for React Native Supabase apps.
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Unique key prevents session collision with the rider app.
    storageKey: 'wasel-driver-session',
  },
});
