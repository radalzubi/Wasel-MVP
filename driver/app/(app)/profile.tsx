import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface DriverProfile {
  id: string;
  phone: string;
  name: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_plate: string;
  subscription_tier: number;
  is_online: boolean;
  created_at: string;
}

const TIER: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'Silver',   color: '#AAA', bg: '#2A2A2A' },
  2: { label: 'Gold',     color: '#000', bg: '#F5A623' },
  3: { label: 'Platinum', color: '#FFF', bg: '#8B5CF6' },
};

function formatSince(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { t, language, toggleLanguage } = useLanguage();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Prevents setState after unmount (e.g. user navigates away before the fetch completes)
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true); setError(null);
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');
      const res = await fetch(`${API_URL}/api/drivers/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!isMounted.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (isMounted.current) setProfile(data);
    } catch (e: unknown) {
      if (isMounted.current) setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }

  function handleSignOut() {
    Alert.alert(t('signOutConfirm'), t('signOutMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signOutConfirmBtn'), style: 'destructive', onPress: signOut },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#F5A623" size="large" />
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.errText}>{error || 'Profile unavailable'}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load}>
          <Text style={s.retryTxt}>Try again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const tier = TIER[profile.subscription_tier] ?? TIER[1];
  const initials = (profile.name || '??').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Avatar card ──────────────────────────────────────── */}
        <View style={s.avatarCard}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{profile.name}</Text>
            <Text style={s.phone}>{profile.phone}</Text>
            <Text style={s.since}>Driver since {formatSince(profile.created_at)}</Text>
          </View>
          <View style={[s.tierPill, { backgroundColor: tier.bg }]}>
            <Text style={[s.tierPillTxt, { color: tier.color }]}>{tier.label}</Text>
          </View>
        </View>

        {/* ── Vehicle ──────────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardRow}>
            <Ionicons name="car-outline" size={18} color="#F5A623" />
            <Text style={s.cardLabel}>{t('vehicle')}</Text>
          </View>
          <Text style={s.vehicleName}>{profile.vehicle_make} {profile.vehicle_model}</Text>
          <View style={s.plateRow}>
            <Text style={s.plateLabel}>{t('vehiclePlate')}</Text>
            <View style={s.plateBadge}>
              <Text style={s.plateTxt}>{profile.vehicle_plate || '—'}</Text>
            </View>
          </View>
        </View>

        {/* ── Subscription ─────────────────────────────────────── */}
        <View style={s.card}>
          <View style={s.cardRow}>
            <Ionicons name="ribbon-outline" size={18} color="#F5A623" />
            <Text style={s.cardLabel}>{t('subscriptionTier')}</Text>
          </View>
          <View style={s.subRow}>
            <View style={[s.tierPill, { backgroundColor: tier.bg }]}>
              <Text style={[s.tierPillTxt, { color: tier.color }]}>{tier.label}</Text>
            </View>
            <Text style={s.subNote}>You keep 100% of every fare</Text>
          </View>
        </View>

        {/* ── Settings ─────────────────────────────────────────── */}
        <View style={s.card}>
          <TouchableOpacity style={s.settingRow} onPress={toggleLanguage}>
            <Ionicons name="language-outline" size={18} color="#888" />
            <Text style={s.settingLabel}>{t('language')}</Text>
            <Text style={s.settingVal}>{language === 'en' ? 'English' : 'العربية'}</Text>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </TouchableOpacity>
          <View style={s.divider} />
          <View style={s.settingRow}>
            <Ionicons name="information-circle-outline" size={18} color="#888" />
            <Text style={s.settingLabel}>{t('aboutWaselDriver')}</Text>
            <Text style={s.settingVal}>v1.0.0</Text>
          </View>
        </View>

        <TouchableOpacity style={s.signOut} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={18} color="#FF3B30" />
          <Text style={s.signOutTxt}>{t('signOutConfirmBtn')}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0A0A0A' },
  center:  { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' },
  scroll:  { paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 24 },
  errText: { color: '#FF3B30', fontSize: 15, marginBottom: 16 },
  retryBtn:{ backgroundColor: '#F5A623', borderRadius: 10, paddingHorizontal: 24, paddingVertical: 10 },
  retryTxt:{ color: '#000', fontWeight: '700' },

  avatarCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 20, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: '#1E1E1E',
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#F5A623', alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { fontSize: 22, fontWeight: '800', color: '#000' },
  name:     { fontSize: 18, fontWeight: '700', color: '#FFF', marginBottom: 2 },
  phone:    { fontSize: 13, color: '#888', marginBottom: 2 },
  since:    { fontSize: 12, color: '#555' },

  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  cardLabel:{ fontSize: 13, color: '#888', fontWeight: '600' },

  vehicleName: { fontSize: 20, fontWeight: '700', color: '#FFF', marginBottom: 10 },
  plateRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plateLabel:  { fontSize: 13, color: '#666' },
  plateBadge:  { backgroundColor: '#1E1E1E', borderRadius: 8, borderWidth: 1, borderColor: '#2A2A2A', paddingHorizontal: 12, paddingVertical: 5 },
  plateTxt:    { color: '#F5A623', fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  subRow:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  subNote: { fontSize: 13, color: '#666', flex: 1 },

  tierPill:    { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, alignSelf: 'flex-start' },
  tierPillTxt: { fontSize: 13, fontWeight: '700' },

  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  settingLabel:{ flex: 1, fontSize: 15, color: '#FFF' },
  settingVal:  { fontSize: 14, color: '#666', marginRight: 4 },
  divider:     { height: 1, backgroundColor: '#1E1E1E' },

  signOut: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#1A0A0A', borderRadius: 14, borderWidth: 1, borderColor: '#3D1515',
    paddingVertical: 16, marginTop: 6,
  },
  signOutTxt: { color: '#FF3B30', fontWeight: '700', fontSize: 16 },
});
