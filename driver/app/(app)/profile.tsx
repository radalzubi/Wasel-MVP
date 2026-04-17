import React, { useEffect, useState } from 'react';
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
  is_waitlist_member: boolean;
  waitlist_position: number | null;
}

const TIER_DATA = {
  1: {
    emoji: '🥈', nameKey: 'silver', descKey: 'tierSilverDesc',
    price: 20, weight: 40,
    borderColor: '#3A3A3A', badgeColor: '#2A2A2A', badgeText: '#AAA', accentColor: '#888',
    next: 2 as const,
  },
  2: {
    emoji: '🥇', nameKey: 'gold', descKey: 'tierGoldDesc',
    price: 35, weight: 70,
    borderColor: '#F5A623', badgeColor: '#F5A623', badgeText: '#000', accentColor: '#F5A623',
    next: 3 as const,
  },
  3: {
    emoji: '💎', nameKey: 'platinum', descKey: 'tierPlatinumDesc',
    price: 50, weight: 100,
    borderColor: '#8B5CF6', badgeColor: '#8B5CF6', badgeText: '#FFF', accentColor: '#8B5CF6',
    next: null,
  },
} as const;

function getTierInfo(tier: number) {
  return TIER_DATA[(tier as 1 | 2 | 3)] ?? TIER_DATA[1];
}

function formatDriverSince(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { t, language, toggleLanguage } = useLanguage();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      setLoading(true);
      setError(null);
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');

      const res = await fetch(`${API_URL}/api/drivers/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setProfile(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }

  function handleSignOut() {
    Alert.alert(
      t('signOutConfirm'),
      t('signOutMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('signOutConfirmBtn'), style: 'destructive', onPress: signOut },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator color="#F5A623" size="large" />
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Text style={styles.errorText}>{error || 'Profile unavailable'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchProfile}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const tierInfo = getTierInfo(profile.subscription_tier);
  const initials = (profile.name || '??').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('driverProfile')}</Text>
        </View>

        {/* Avatar + Info */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.avatarInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.driverName}>{profile.name}</Text>
                <View style={[styles.onlineDot, { backgroundColor: profile.is_online ? '#00C851' : '#555' }]} />
              </View>
              <Text style={styles.phoneText}>{profile.phone}</Text>
              <Text style={styles.sinceText}>
                {t('driverSince')} {formatDriverSince(profile.created_at)}
              </Text>
            </View>
          </View>
        </View>

        {/* Subscription Tier Card */}
        <View style={[styles.tierCard, { borderColor: tierInfo.borderColor }]}>
          {/* Header row */}
          <View style={styles.tierHeader}>
            <Text style={styles.tierSectionLabel}>{t('subscriptionTier')}</Text>
            <View style={[styles.tierBadge, { backgroundColor: tierInfo.badgeColor }]}>
              <Text style={[styles.tierBadgeText, { color: tierInfo.badgeText }]}>
                {tierInfo.emoji} {t(tierInfo.nameKey)}
              </Text>
            </View>
          </View>

          {/* Price + keep-all-fares */}
          <View style={styles.tierPriceRow}>
            <Text style={[styles.tierPriceAmount, { color: tierInfo.accentColor }]}>
              {tierInfo.price} JD
            </Text>
            <Text style={styles.tierPriceUnit}> / month</Text>
            <View style={styles.tierPriceSep} />
            <Text style={styles.tierKeepFare}>💰 {t('keepsFare')}</Text>
          </View>

          {/* Dispatch weight bar */}
          <View style={styles.tierWeightRow}>
            <Text style={styles.tierWeightLabel}>{t('dispatchWeight')}</Text>
            <View style={styles.tierWeightTrack}>
              <View style={[
                styles.tierWeightFill,
                { width: `${tierInfo.weight}%` as any, backgroundColor: tierInfo.accentColor },
              ]} />
            </View>
            <Text style={[styles.tierWeightPct, { color: tierInfo.accentColor }]}>
              {tierInfo.weight}%
            </Text>
          </View>

          <View style={styles.tierDivider} />
          <Text style={styles.tierNote}>{t('dispatchPriorityNote')}</Text>

          {/* Upgrade CTA (hidden for Platinum) */}
          {tierInfo.next && (() => {
            const next = TIER_DATA[tierInfo.next];
            return (
              <View style={styles.upgradeBox}>
                <View style={styles.upgradeBoxTop}>
                  <Text style={styles.upgradeBoxTitle}>
                    {t('upgradeTo')} {next.emoji} {t(next.nameKey)}
                  </Text>
                  <Text style={[styles.upgradeBoxPrice, { color: next.accentColor }]}>
                    {next.price} JD/mo
                  </Text>
                </View>
                <Text style={styles.upgradeBoxDesc}>{t('upgradeDesc')}</Text>
              </View>
            );
          })()}
        </View>

        {/* Vehicle Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardHeaderEmoji}>🚗</Text>
            <Text style={styles.cardHeaderTitle}>{t('vehicle')}</Text>
          </View>
          <View style={styles.vehicleRow}>
            <Text style={styles.vehicleValue}>{profile.vehicle_make} {profile.vehicle_model}</Text>
          </View>
          <View style={styles.plateRow}>
            <Text style={styles.plateLabel}>{t('vehiclePlate')}</Text>
            <View style={styles.plateBadge}>
              <Text style={styles.plateBadgeText}>{profile.vehicle_plate}</Text>
            </View>
          </View>
        </View>

        {/* Early Member Badge */}
        {profile.is_waitlist_member && (
          <View style={[styles.card, styles.earlyMemberCard]}>
            <View style={styles.earlyMemberRow}>
              <Text style={styles.earlyMemberIcon}>⭐</Text>
              <View style={styles.earlyMemberInfo}>
                <Text style={styles.earlyMemberTitle}>{t('earlyMemberTitle')}</Text>
                {profile.waitlist_position != null && (
                  <Text style={styles.earlyMemberPosition}>
                    {t('waitlistPosition')} #{profile.waitlist_position}
                  </Text>
                )}
                <Text style={styles.earlyMemberNote}>{t('earlyMemberNote')}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Settings Section */}
        <View style={styles.card}>
          {/* Language Toggle */}
          <TouchableOpacity style={styles.settingsRow} onPress={toggleLanguage}>
            <View style={styles.settingsRowLeft}>
              <Ionicons name="language" size={20} color="#F5A623" style={styles.settingsIcon} />
              <Text style={styles.settingsLabel}>{t('language')}</Text>
            </View>
            <View style={styles.settingsRowRight}>
              <Text style={styles.settingsValue}>{language === 'en' ? 'English' : 'العربية'}</Text>
              <Ionicons name="chevron-forward" size={16} color="#444" />
            </View>
          </TouchableOpacity>

          <View style={styles.settingsDivider} />

          {/* About */}
          <View style={styles.settingsRow}>
            <View style={styles.settingsRowLeft}>
              <Ionicons name="information-circle" size={20} color="#F5A623" style={styles.settingsIcon} />
              <Text style={styles.settingsLabel}>{t('aboutWaselDriver')}</Text>
            </View>
            <View style={styles.settingsRowRight}>
              <Text style={styles.settingsValue}>{t('version')} 1.0.0</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={18} color="#FF3B30" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>{t('signOutConfirmBtn')}</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0A0A0A' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },

  loadingContainer: {
    flex: 1, backgroundColor: '#0A0A0A',
    justifyContent: 'center', alignItems: 'center',
  },
  errorText: { color: '#FF3B30', fontSize: 15, marginBottom: 16, textAlign: 'center' },
  retryButton: {
    backgroundColor: '#F5A623', borderRadius: 10,
    paddingHorizontal: 24, paddingVertical: 10,
  },
  retryText: { color: '#000', fontWeight: '700', fontSize: 14 },

  header: { marginBottom: 20, marginTop: 8 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },

  card: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },

  // Avatar
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: '#000' },
  avatarInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  driverName: { fontSize: 20, fontWeight: '700', color: '#FFF', flex: 1 },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  phoneText: { fontSize: 14, color: '#888', marginBottom: 4 },
  sinceText: { fontSize: 13, color: '#555' },

  // Tier
  tierCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
  },
  tierHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  tierSectionLabel: {
    fontSize: 11, color: '#555', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1,
  },
  tierBadge: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  tierBadgeText: { fontSize: 13, fontWeight: '700' },

  // Price row
  tierPriceRow: {
    flexDirection: 'row', alignItems: 'baseline', marginBottom: 14, flexWrap: 'wrap', gap: 4,
  },
  tierPriceAmount: { fontSize: 28, fontWeight: '800' },
  tierPriceUnit: { fontSize: 14, color: '#666' },
  tierPriceSep: { width: 1, height: 16, backgroundColor: '#2A2A2A', marginHorizontal: 8, alignSelf: 'center' },
  tierKeepFare: { fontSize: 12, color: '#888' },

  // Weight bar
  tierWeightRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  tierWeightLabel: { fontSize: 11, color: '#555', width: 110 },
  tierWeightTrack: { flex: 1, height: 5, backgroundColor: '#1E1E1E', borderRadius: 3, overflow: 'hidden' },
  tierWeightFill: { height: 5, borderRadius: 3 },
  tierWeightPct: { fontSize: 12, fontWeight: '700', width: 38, textAlign: 'right' },

  tierDivider: { height: 1, backgroundColor: '#1E1E1E', marginBottom: 12 },
  tierNote: { fontSize: 12, color: '#555', lineHeight: 18, marginBottom: 0 },

  // Upgrade box
  upgradeBox: {
    marginTop: 14,
    backgroundColor: '#0D0D0D',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 12,
  },
  upgradeBoxTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  upgradeBoxTitle: { fontSize: 13, fontWeight: '700', color: '#CCC' },
  upgradeBoxPrice: { fontSize: 14, fontWeight: '800' },
  upgradeBoxDesc: { fontSize: 12, color: '#666', lineHeight: 18 },

  // Vehicle
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  cardHeaderEmoji: { fontSize: 18 },
  cardHeaderTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  vehicleRow: { marginBottom: 10 },
  vehicleValue: { fontSize: 18, fontWeight: '600', color: '#FFF' },
  plateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plateLabel: { fontSize: 13, color: '#666' },
  plateBadge: {
    backgroundColor: '#1E1E1E',
    borderRadius: 8, borderWidth: 1, borderColor: '#2A2A2A',
    paddingHorizontal: 12, paddingVertical: 5,
  },
  plateBadgeText: { color: '#F5A623', fontSize: 14, fontWeight: '700', letterSpacing: 1 },

  // Early member
  earlyMemberCard: { borderColor: '#F5A623' },
  earlyMemberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  earlyMemberIcon: { fontSize: 28, marginTop: 2 },
  earlyMemberInfo: { flex: 1 },
  earlyMemberTitle: { fontSize: 16, fontWeight: '700', color: '#F5A623', marginBottom: 4 },
  earlyMemberPosition: { fontSize: 13, color: '#888', marginBottom: 6 },
  earlyMemberNote: { fontSize: 13, color: '#666', lineHeight: 18 },

  // Settings
  settingsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10,
  },
  settingsRowLeft: { flexDirection: 'row', alignItems: 'center' },
  settingsIcon: { marginRight: 10 },
  settingsLabel: { fontSize: 15, color: '#FFF' },
  settingsRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  settingsValue: { fontSize: 14, color: '#666' },
  settingsDivider: { height: 1, backgroundColor: '#1E1E1E', marginVertical: 2 },

  // Sign out
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A0A0A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3D1515',
    paddingVertical: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  signOutText: { color: '#FF3B30', fontWeight: '700', fontSize: 16 },
});
