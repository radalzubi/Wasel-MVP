import React, { createContext, useContext } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary, RecoveryShell, useStartupHealth } from '@wasel/shared';

// See rider/app/(app)/_layout.tsx for detailed rationale. Same breaker,
// different appName so the recovery UI is unambiguous.
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
  // bottom inset = home-indicator height (34pt on iPhone X+, 0 on older/Android)
  const { bottom } = useSafeAreaInsets();
  const health = useStartupHealth();

  if (health.bootState === 'recovery') {
    return <RecoveryShell appName="Wasel Driver" onContinue={health.exitRecoveryMode} />;
  }

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
          // Border replaced with a subtle shadow so the lip reads as a card edge
          borderTopWidth: 0,
          // Height grows to cover the home-indicator area so the background
          // extends all the way to the physical bottom of the screen (the "lip")
          height: 58 + bottom,
          paddingBottom: bottom > 0 ? bottom + 2 : 10,
          paddingTop: 8,
          // Shadow gives the tab bar a lifted feel, distinct from the map behind it
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
        name="dashboard"
        options={{
          title: t('dashboard'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="car" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="wallet-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
    </ErrorBoundary>
    </StartupHealthContext.Provider>
  );
}
