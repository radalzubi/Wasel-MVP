import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface RiderProfile {
  id: string;
  phone: string;
  created_at: string;
  is_waitlist_member: boolean;
  waitlist_joined_at?: string;
  waitlist_position?: number;
}

function formatPhone(raw: string): string {
  // Normalize: strip all non-digit characters except leading +
  const cleaned = raw.replace(/[^\d+]/g, '');
  // If it starts with +9627x, format as +962 7X XXX XXXX
  const m = cleaned.match(/^\+962(\d)(\d{3})(\d{4})$/);
  if (m) return `+962 ${m[1]}${m[2]} ${m[3]}`;
  // Fallback: just return as-is
  return raw;
}

function getInitials(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-4);
}

function formatMemberSince(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function SkeletonBlock({ width, height, style }: { width: number | string; height: number; style?: object }) {
  return (
    <View
      style={[
        { width, height, backgroundColor: '#1E1E1E', borderRadius: 8 },
        style,
      ]}
    />
  );
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t, language, toggleLanguage } = useLanguage();

  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  // Derive phone from Supabase user as fallback
  const fallbackPhone: string =
    user?.phone ?? user?.user_metadata?.phone ?? '';

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) throw new Error('No token');

        const res = await fetch(`${API_URL}/api/riders/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: RiderProfile = await res.json();
        setProfile(data);
      } catch {
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  function handleSignOut() {
    Alert.alert(
      t('signOutConfirm'),
      t('signOutMessage'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('signOutConfirmBtn'),
          style: 'destructive',
          onPress: signOut,
        },
      ],
    );
  }

  // Resolved display values
  const displayPhone = profile?.phone ?? fallbackPhone;
  const displayCreatedAt = profile?.created_at ?? user?.created_at ?? '';
  const isEarlyMember = profile?.is_waitlist_member ?? false;
  const waitlistPosition = profile?.waitlist_position;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('profile')}</Text>
        </View>

        {/* Avatar + identity */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>
              {displayPhone ? getInitials(displayPhone) : '••••'}
            </Text>
          </View>

          {loading ? (
            <>
              <SkeletonBlock width={160} height={18} style={{ marginTop: 16 }} />
              <SkeletonBlock width={110} height={13} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <Text style={styles.phoneText}>
                {displayPhone ? formatPhone(displayPhone) : '—'}
              </Text>
              {displayCreatedAt ? (
                <Text style={styles.memberSince}>
                  {t('memberSince')} {formatMemberSince(displayCreatedAt)}
                </Text>
              ) : null}
            </>
          )}
        </View>

        {/* Early Member Badge */}
        {!loading && isEarlyMember && (
          <View style={styles.earlyCard}>
            <View style={styles.earlyCardHeader}>
              <Text style={styles.earlyCardStar}>⭐</Text>
              <View style={styles.earlyCardTitles}>
                <Text style={styles.earlyCardTitle}>{t('earlyMemberTitle')}</Text>
                {waitlistPosition != null && (
                  <Text style={styles.earlyCardSubtitle}>
                    {t('waitlistPosition')} #{waitlistPosition}
                  </Text>
                )}
              </View>
            </View>
            <Text style={styles.earlyCardNote}>{t('earlyMemberNote')}</Text>
          </View>
        )}

        {/* Skeleton for early card while loading */}
        {loading && (
          <View style={styles.skeletonCard}>
            <SkeletonBlock width={40} height={40} style={{ borderRadius: 20 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock width="70%" height={14} />
              <SkeletonBlock width="50%" height={12} />
            </View>
          </View>
        )}

        {/* Settings Section */}
        <View style={styles.section}>
          {/* Language row */}
          <TouchableOpacity
            style={styles.row}
            onPress={toggleLanguage}
            activeOpacity={0.75}
          >
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}>
                <Text style={styles.rowIconText}>🌐</Text>
              </View>
              <Text style={styles.rowLabel}>{t('language')}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>
                {language === 'en' ? t('english') : t('arabic')}
              </Text>
              <Text style={styles.rowChevron}>›</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          {/* About Wasel row */}
          <View style={[styles.row, styles.rowNoAction]}>
            <View style={styles.rowLeft}>
              <View style={styles.rowIcon}>
                <Text style={styles.rowIconText}>ℹ️</Text>
              </View>
              <Text style={styles.rowLabel}>{t('aboutWasel')}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>{t('version')} 1.0.0</Text>
            </View>
          </View>
        </View>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>{t('signOutConfirmBtn')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 32,
  },

  // Header
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFF',
  },

  // Avatar section
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000',
    letterSpacing: 1,
  },
  phoneText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginTop: 16,
    letterSpacing: 0.5,
  },
  memberSince: {
    fontSize: 13,
    color: '#555',
    marginTop: 6,
  },

  // Early member card
  earlyCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    padding: 16,
    marginBottom: 20,
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 4,
  },
  earlyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  earlyCardStar: {
    fontSize: 28,
  },
  earlyCardTitles: {
    flex: 1,
    gap: 2,
  },
  earlyCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5A623',
  },
  earlyCardSubtitle: {
    fontSize: 12,
    color: '#C47C10',
  },
  earlyCardNote: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
  },

  // Skeleton card placeholder
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },

  // Settings section
  section: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowNoAction: {},
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  rowIconText: {
    fontSize: 16,
  },
  rowLabel: {
    fontSize: 15,
    color: '#FFF',
    fontWeight: '500',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 13,
    color: '#666',
  },
  rowChevron: {
    fontSize: 20,
    color: '#444',
    lineHeight: 22,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#1E1E1E',
    marginHorizontal: 16,
  },

  // Sign out
  signOutButton: {
    backgroundColor: 'rgba(220,53,69,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,53,69,0.35)',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  signOutText: {
    color: '#DC3545',
    fontSize: 16,
    fontWeight: '600',
  },
});
