import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { View, ActivityIndicator } from 'react-native';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

// Fetch waitlist mode from the backend /health endpoint.
async function fetchWaitlistMode(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json();
    return data.waitlistMode === true;
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
    // Always fetch fresh — the health endpoint is fast (<300 ms) and this
    // ensures WAITLIST_MODE changes on Railway take effect on the very next
    // app open instead of being stuck in a stale AsyncStorage cache.
    fetchWaitlistMode().then((mode) => {
      if (mountedRef.current) setWaitlistMode(mode);
    });
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
