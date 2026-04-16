import { Redirect } from 'expo-router';

const WAITLIST_MODE = process.env.EXPO_PUBLIC_WAITLIST_MODE === 'true';

export default function Index() {
  if (WAITLIST_MODE) return <Redirect href="/waitlist" />;
  return <Redirect href="/(app)/dashboard" />;
}
