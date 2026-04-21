import React, { createContext, useContext } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary, RecoveryShell, useStartupHealth, useJSHeartbeat } from '@wasel/shared';

// Context exposing the startup-health hook so tab screens (home.tsx, etc.)
// can call markBootstrapDone() after their own bootstrap and read
// shouldSkipRestore to skip the restore fetch when needed.
//
// Consumed by tab screens via `useStartupHealthCtx()`. The values are the
// exact return shape of useStartupHealth; see packages/shared/src/startupHealth.ts.
interface StartupHealthCtx {
  shouldSkipRestore: boolean;
  markBootstrapDone: () => void;
}
const StartupHealthContext = createContext<StartupHealthCtx>({
  shouldSkipRestore: false,
  markBootstrapDone: () => {},
});
export function useStartupHealthCtx() { return useContext(StartupHealthContext); }

export default function AppLayout() {
  const { t } = useLanguage();
  const { bottom } = useSafeAreaInsets();
  const health = useStartupHealth();

  // JS-thread heartbeat. On a stall longer than the threshold (3s) this
  // fires — we log it and, if the stall looks like a crash-precursor,
  // the user's app isn't dead yet: the breaker's pendingSince mark is
  // still set, so a hard termination will count as unhealthy and the
  // next launch either resolves cleanly or enters RecoveryShell. We
  // intentionally don't bump a recovery epoch here because that would
  // tear down subscriptions during a transient GC pause — worse UX
  // than just riding it out. Tight scope for now: observe + log.
  useJSHeartbeat((stallMs) => {
    console.warn(`[rider] JS thread stalled ${stallMs}ms`);
  });

  // Crash-loop breaker: if the previous N launches never marked healthy,
  // we're in recovery mode. Show a safe UI instead of mounting the live-trip
  // screen + map, which is where the crash surface lives.
  if (health.bootState === 'recovery') {
    return <RecoveryShell appName="Wasel" onContinue={health.exitRecoveryMode} />;
  }

  // A brief booting phase while AsyncStorage read resolves. Pure black +
  // spinner — no network, no native modules, no MapView. The read is
  // milliseconds on warm device storage.
  if (health.bootState === 'booting') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  return (
    <StartupHealthContext.Provider
      value={{
        shouldSkipRestore: health.shouldSkipRestore,
        markBootstrapDone: health.markBootstrapDone,
      }}
    >
    <ErrorBoundary>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#111',
          borderTopWidth: 0,
          height: 58 + bottom,
          paddingBottom: bottom > 0 ? bottom + 2 : 10,
          paddingTop: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.4,
          shadowRadius: 10,
          elevation: 20,
        },
        tabBarActiveTintColor: '#F5A623',
        tabBarInactiveTintColor: '#3A3A3A',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('exploreAmman'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </ErrorBoundary>
    </StartupHealthContext.Provider>
  );
}
