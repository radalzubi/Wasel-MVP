import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const WAITLIST_CACHE_KEY = '@wasel/waitlist-mode';

// Fetch waitlist mode from the backend /health endpoint.
// Returns the cached value immediately on subsequent launches (stale-while-revalidate),
// so the spinner is only shown on the very first ever launch.
async function fetchWaitlistMode(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    const mode = data.waitlistMode === true;
    await AsyncStorage.setItem(WAITLIST_CACHE_KEY, mode ? 'true' : 'false');
    return mode;
  } catch {
    // Network failed — default open so users aren't locked out by a backend hiccup.
    return false;
  }
}

export default function Index() {
  const { session, loading } = useAuth();
  const [waitlistMode, setWaitlistMode] = useState<boolean | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      // Use cached value first so there's no flicker on repeat launches.
      const cached = await AsyncStorage.getItem(WAITLIST_CACHE_KEY);
      if (cached !== null && mountedRef.current) {
        setWaitlistMode(cached === 'true');
        // Refresh silently in background — takes effect on the next launch.
        fetchWaitlistMode().then((mode) => {
          if (mountedRef.current) setWaitlistMode(mode);
        });
      } else {
        // First ever launch — must wait for the network response.
        const mode = await fetchWaitlistMode();
        if (mountedRef.current) setWaitlistMode(mode);
      }
    })();
  }, []);

  if (loading || waitlistMode === null) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  if (waitlistMode) return <Redirect href="/waitlist" />;
  if (session) return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/login" />;
}
