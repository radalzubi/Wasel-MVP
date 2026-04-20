import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

// PendingApprovalScreen — shown after a driver submits the registration form
// but before an admin approves them. Polls the drivers row via Supabase Realtime
// CDC so the driver navigates straight to the dashboard the moment their
// `is_approved` flips to true — without having to sign out and back in.
export default function PendingApprovalScreen() {
  const { signOut, user } = useAuth();
  const isMounted = useRef(true);

  useEffect(() => {
    return () => { isMounted.current = false; };
  }, []);

  // Shared approval check — polls the DB once, navigates on approval.
  const checkApproval = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('drivers')
        .select('is_approved')
        .eq('id', user.id)
        .maybeSingle();
      if (!isMounted.current) return;
      if (data?.is_approved === true) {
        router.replace('/(app)/dashboard' as any);
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => {
    if (!user?.id) return;

    // 1. Check immediately — approval may have arrived between registration
    //    and this screen mounting (race with admin SQL UPDATE).
    checkApproval();

    // 2. Subscribe to Realtime UPDATE events on this driver's row so we
    //    navigate the instant `is_approved` flips to true.
    const channelName = `driver-approval-${user.id}`;
    // Remove any orphaned channel from a prior mount (React Strict Mode, fast nav).
    const existing = supabase.getChannels().find(
      (c) => c.topic.endsWith(channelName),
    );
    if (existing) {
      try { supabase.removeChannel(existing); } catch { /* ignore */ }
    }

    const ch = supabase
      .channel(channelName)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'drivers',
        filter: `id=eq.${user.id}`,
      }, (payload) => {
        if (!isMounted.current) return;
        if (payload.new?.is_approved === true) {
          router.replace('/(app)/dashboard' as any);
        }
      })
      .subscribe();

    // 3. Periodic DB fallback (every 30 s) — catches approvals that arrived
    //    while the Realtime WebSocket was disconnected (network drop, background
    //    kill, etc.). Supabase Realtime does NOT re-deliver missed events on
    //    reconnect, so without this a driver could sit here indefinitely if their
    //    approval event was missed during a disconnect window.
    const pollInterval = setInterval(checkApproval, 30_000);

    // 4. Re-check on app foreground — fastest recovery path after background kill.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkApproval();
    });

    return () => {
      clearInterval(pollInterval);
      appStateSub.remove();
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <View style={s.icon}>
          <Ionicons name="time-outline" size={48} color="#F5A623" />
        </View>
        <Text style={s.title}>Application Submitted</Text>
        <Text style={s.body}>
          Your driver application is under review. You'll be taken to the dashboard
          automatically as soon as you're approved — no need to sign out and back in.
        </Text>
        <TouchableOpacity onPress={signOut} style={s.link}>
          <Text style={s.linkTxt}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0A0A0A' },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon:    { marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12, textAlign: 'center' },
  body:    { fontSize: 15, color: '#666', lineHeight: 24, textAlign: 'center', marginBottom: 32 },
  link:    { padding: 12 },
  linkTxt: { color: '#F5A623', fontWeight: '600', fontSize: 15 },
});
