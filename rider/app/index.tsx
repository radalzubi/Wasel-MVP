import { Redirect } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { View, ActivityIndicator } from 'react-native';

const WAITLIST_MODE = process.env.EXPO_PUBLIC_WAITLIST_MODE === 'true';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  if (WAITLIST_MODE) return <Redirect href="/waitlist" />;
  if (session) return <Redirect href="/(app)/home" />;
  return <Redirect href="/(auth)/login" />;
}
