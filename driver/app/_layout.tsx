import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, Component } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { registerPushToken } from '@wasel/shared';

// ── Root-level ErrorBoundary ──────────────────────────────────────────────────
// Catches any synchronous throw from LanguageProvider, AuthProvider, AuthGuard,
// or child screens and renders a recovery UI instead of a silent native crash.
class RootErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }
  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[RootErrorBoundary] caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={eb.container}>
          <Text style={eb.title}>Something went wrong</Text>
          <Text style={eb.body}>{this.state.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}
const eb = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title:     { color: '#F5A623', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  body:      { color: '#888', fontSize: 14, textAlign: 'center' },
});

// Lives inside AuthProvider so it can call useAuth().
// Registers the Expo push token once the user signs in.
//
// Depends on user?.id (stable per identity), NOT session.access_token (rotates
// every hour with autoRefreshToken). The previous dep caused this effect to
// re-fire on every JWT refresh, burning an Expo SDK call + a backend PATCH
// hourly per active device.
function PushRegistration() {
  const { user, getAccessToken } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    const token = getAccessToken();
    if (!token) return;
    registerPushToken('driver', token);
  }, [user?.id, getAccessToken]);

  return null;
}

// Lives inside AuthProvider so it can call useAuth().
// Watches for sign-out and navigates to login.
//
// The `initialized` ref prevents navigating during the very first auth
// resolution — index.tsx owns that routing decision. AuthGuard only
// fires on a *subsequent* change (i.e. the user actually signs out while
// already inside the app), which avoids the "Cannot navigate before
// navigation has been mounted" error that Expo Router throws when
// router.replace is called during the initial render cycle.
function AuthGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const initialized = useRef(false);

  useEffect(() => {
    if (loading) return;

    // Skip the very first resolution — index.tsx handles initial routing.
    if (!initialized.current) {
      initialized.current = true;
      return;
    }

    // Subsequent auth changes: if the user signed out while inside the app,
    // redirect to login (unless already on an auth or waitlist screen).
    const inAuthGroup = (segments[0] as string) === '(auth)';
    const inWaitlist =
      (segments[0] as string) === 'waitlist' ||
      (segments[0] as string) === 'waitlist-success';

    if (!user && !inAuthGroup && !inWaitlist) {
      router.replace('/(auth)/login');
    }
  }, [user, loading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
    <LanguageProvider>
      <AuthProvider>
        <AuthGuard />
        <PushRegistration />
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0A0A' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="waitlist" />
          <Stack.Screen name="waitlist-success" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </AuthProvider>
    </LanguageProvider>
    </RootErrorBoundary>
  );
}
