import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { View, ActivityIndicator } from 'react-native';

const WAITLIST_MODE = process.env.EXPO_PUBLIC_WAITLIST_MODE === 'true';

// Possible states for a driver with an active session:
//   'approved'            → go straight to dashboard
//   'pending_approval'    → registered but admin hasn't approved yet
//   'pending_registration'→ OTP passed but registration form not submitted
//   null                  → still loading
type DriverState = 'approved' | 'pending_approval' | 'pending_registration' | null;

export default function Index() {
  const { session, loading } = useAuth();
  const [driverState, setDriverState] = useState<DriverState>(null);

  useEffect(() => {
    if (loading) return;
    if (!session?.user?.id) {
      setDriverState('approved'); // value unused — no session path renders login
      return;
    }

    // Check the driver's profile to decide where to route them.
    // This prevents a driver whose token is still valid but who hasn't been
    // approved yet from being routed straight to the dashboard on app restart.
    supabase
      .from('drivers')
      .select('is_approved')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) {
          // No driver profile yet — registration form was never submitted.
          setDriverState('pending_registration');
        } else if (data.is_approved) {
          setDriverState('approved');
        } else {
          setDriverState('pending_approval');
        }
      })
      .catch(() => {
        // On DB error fall back to dashboard; the dashboard has its own auth guard.
        setDriverState('approved');
      });
  }, [loading, session?.user?.id]);

  if (loading || (session && driverState === null)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#F5A623" />
      </View>
    );
  }

  if (WAITLIST_MODE) return <Redirect href="/waitlist" />;
  if (!session) return <Redirect href="/(auth)/login" />;
  if (driverState === 'pending_registration') return <Redirect href="/(auth)/register" />;
  if (driverState === 'pending_approval') return <Redirect href="/(auth)/pending" />;
  return <Redirect href="/(app)/dashboard" />;
}
