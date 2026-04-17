import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { LanguageProvider } from '../contexts/LanguageContext';

// Inner component — lives inside AuthProvider so it can call useAuth().
// Watches for sign-out and redirects to the login screen.
function AuthGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading) return;
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
