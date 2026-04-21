import React, { createContext, useContext } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary, RecoveryShell, useStartupHealth } from '@wasel/shared';

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
