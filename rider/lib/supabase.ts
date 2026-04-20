import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
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

/**
 * SecureStore adapter for @supabase/supabase-js storage option.
 * Uses expo-secure-store (iOS Keychain / Android Keystore) on native,
 * falls back to AsyncStorage on web (where SecureStore is unavailable).
 *
 * Key length is capped at 255 chars because SecureStore rejects longer keys.
 */
const ExpoSecureStoreAdapter = {
  getItem: (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') return AsyncStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
    return SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string): Promise<void> => {
    if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
    return SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Unique key prevents session collision with the driver app when both are
    // run in the same Expo Go instance (which shares SecureStore namespace).
    storageKey: 'wasel-rider-session',
  },
});
