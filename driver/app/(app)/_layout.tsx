import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLanguage } from '../../contexts/LanguageContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@wasel/shared';

export default function AppLayout() {
  const { t } = useLanguage();
  // bottom inset = home-indicator height (34pt on iPhone X+, 0 on older/Android)
  const { bottom } = useSafeAreaInsets();

  return (
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
  );
}
