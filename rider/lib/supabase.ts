import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Fail loudly at import time with a clear message instead of letting createClient
// crash deep inside its own code with "undefined is not a string" — that form of
// crash presents as an instant dismiss back to the iOS home screen with no RedBox,
// which looks identical to a native crash and wastes hours of debugging.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[rider/supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Check rider/.env is present and that `expo start` picked it up (env: load .env line should appear in Metro output).'
  );
}

// AsyncStorage is used instead of expo-secure-store because Supabase sessions
// exceed the 2048-byte iOS Keychain value limit, causing SecureStore to throw
// and the SDK to fire SIGNED_OUT immediately after login. AsyncStorage has no
// size limit and is standard for React Native Supabase apps.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Unique key prevents session collision with the driver app.
    storageKey: 'wasel-rider-session',
  },
});
