import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { LanguageProvider } from '../contexts/LanguageContext';

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
  }, [user, loading]);

  return null;
}

export default function RootLayout() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AuthGuard />
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
  );
}
