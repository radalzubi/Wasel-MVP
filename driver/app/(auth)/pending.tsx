import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
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

  useEffect(() => {
    if (!user?.id) return;

    // Check immediately in case approval happened between registration and
    // arriving on this screen (the /register response races with the admin's
    // SQL UPDATE in rare cases).
    (async () => {
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
      } catch { /* non-fatal — Realtime subscription below will catch it */ }
    })();

    // Subscribe to UPDATE events on this driver's row. When `is_approved`
    // transitions to true, navigate to the dashboard.
    const channelName = `driver-approval-${user.id}`;
    const existing = supabase.getChannels().find(
      (c) => c.topic === channelName || c.topic === `realtime:${channelName}`,
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

    return () => {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
    };
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
