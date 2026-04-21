import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
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
    // Network failed — default open so drivers aren't locked out by a backend hiccup.
    return false;
  }
}

// Possible states for a driver with an active session:
//   'approved'            → go straight to dashboard
//   'pending_approval'    → registered but admin hasn't approved yet
//   'pending_registration'→ OTP passed but registration form not submitted
//   null                  → still loading
type DriverState = 'approved' | 'pending_approval' | 'pending_registration' | null;

export default function Index() {
  const { session, loading } = useAuth();
  const [driverState, setDriverState] = useState<DriverState>(null);
  const [waitlistMode, setWaitlistMode] = useState<boolean | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Fetch waitlist mode in parallel with auth loading.
  // Always fetch fresh — the health endpoint is fast (<300 ms) and this
  // ensures WAITLIST_MODE changes on Railway take effect on the very next
  // app open instead of being stuck in a stale AsyncStorage cache.
  useEffect(() => {
    fetchWaitlistMode().then((mode) => {
      if (mountedRef.current) setWaitlistMode(mode);
    });
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!session?.user?.id) {
      setDriverState('approved'); // value unused — no session path renders login
      return;
    }

    // Guards against setState-after-unmount if the user signs out mid-query.
    let cancelled = false;

    // Timeout safety net — if the Supabase query hangs (network dead, PostgREST
    // timing out, Supabase edge degraded), the UI is stuck on a loading spinner
    // and iOS will watchdog-kill the app at ~20 s. Fall back to 'approved' after
    // 6 s so the dashboard renders; the dashboard's own auth + profile gates
    // take over from there.
    const timeoutHandle = setTimeout(() => {
      if (cancelled) return;
      console.warn('[driver/index] drivers row query timed out — falling back to dashboard');
      setDriverState('approved');
    }, 6_000);

    // Check the driver's profile to decide where to route them.
    // This prevents a driver whose token is still valid but who hasn't been
    // approved yet from being routed straight to the dashboard on app restart.
    (async () => {
      try {
        const { data } = await supabase
          .from('drivers')
          .select('is_approved')
          .eq('id', session.user.id)
          .maybeSingle();
        if (cancelled) return;
        clearTimeout(timeoutHandle);
        if (!data) {
          // No driver profile yet — registration form was never submitted.
          setDriverState('pending_registration');
        } else if (data.is_approved) {
          setDriverState('approved');
        } else {
          setDriverState('pending_approval');
        }
      } catch {
        if (cancelled) return;
        clearTimeout(timeoutHandle);
        // On DB error fall back to dashboard; the dashboard has its own auth guard.
        setDriverState('approved');
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timeoutHandle);
    };
  }, [loading, session?.user?.id]);

  if (loading || waitlistMode === null || (session && driverState === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  if (waitlistMode) return <Redirect href="/waitlist" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (driverState === 'pending_registration') return <Redirect href="/(auth)/register" />;
  if (driverState === 'pending_approval') return <Redirect href="/(auth)/pending" />;
  return <Redirect href="/(app)/dashboard" />;
}
