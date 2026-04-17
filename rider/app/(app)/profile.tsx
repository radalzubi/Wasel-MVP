import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ScrollView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
  const cleaned = raw.replace(/[^\d+]/g, '');
  const m = cleaned.match(/^\+962(\d)(\d{3})(\d{4})$/);
  if (m) return `+962 ${m[1]}${m[2]} ${m[3]}`;
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

// ── SettingsRow ──────────────────────────────────────────────────────────────
interface RowProps {
  icon: string;
  label: string;
  value?: string;
  chevron?: boolean;
  onPress?: () => void;
  iconColor?: string;
  children?: React.ReactNode;
}

function SettingsRow({ icon, label, value, chevron = false, onPress, iconColor = '#888', children }: RowProps) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon as any} size={18} color={iconColor} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        {children ? <View style={styles.rowChildren}>{children}</View> : null}
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue}>{value}</Text> : null}
        {chevron ? <Ionicons name="chevron-forward" size={16} color="#444" /> : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

// ── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t, language, toggleLanguage } = useLanguage();

  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

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
        {/* ── Page Header ── */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('settings')}</Text>
        </View>

        {/* ── Avatar + identity ── */}
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

        {/* ── Early Member Badge ── */}
        {!loading && isEarlyMember && (
          <View style={styles.earlyCard}>
            <View style={styles.earlyCardHeader}>
              <Ionicons name="star" size={20} color="#F5A623" />
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

        {/* Skeleton placeholder for early card area while loading */}
        {loading && (
          <View style={styles.skeletonCard}>
            <SkeletonBlock width={40} height={40} style={{ borderRadius: 20 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock width="70%" height={14} />
              <SkeletonBlock width="50%" height={12} />
            </View>
          </View>
        )}

        {/* ── ACCOUNT ── */}
        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="person-outline"
            label="Display name"
            value={user?.user_metadata?.full_name || 'Not set'}
            chevron
            onPress={() => Alert.alert('Display Name', 'Coming soon')}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="call-outline"
            label="Phone number"
            value={displayPhone ? formatPhone(displayPhone) : '—'}
          />
        </View>

        {/* ── TRAVEL ── */}
        <Text style={styles.sectionHeader}>TRAVEL</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="bookmark-outline"
            label="Saved places"
            chevron
            onPress={() => Alert.alert('Saved Places', 'Saved places coming soon')}
          >
            <View style={styles.chipsRow}>
              <View style={styles.chip}><Text style={styles.chipText}>Home</Text></View>
              <View style={styles.chip}><Text style={styles.chipText}>Work</Text></View>
            </View>
          </SettingsRow>
        </View>

        {/* ── PAYMENTS ── */}
        <Text style={styles.sectionHeader}>PAYMENTS</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="card-outline"
            label="Payment methods"
            value="Cash"
            chevron
            onPress={() => Alert.alert('Payment Methods', 'Card payments coming soon')}
          />
        </View>

        {/* ── TRIPS ── */}
        <Text style={styles.sectionHeader}>TRIPS</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="time-outline"
            label="Trip history"
            chevron
            onPress={() => Alert.alert('Trip History', 'Trip history coming soon')}
          />
        </View>

        {/* ── PREFERENCES ── */}
        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="notifications-outline"
            label="Notifications"
            chevron
            onPress={() => Alert.alert('Notifications', 'Notification settings coming soon')}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="language-outline"
            label="Language"
            value={language === 'en' ? 'English' : 'العربية'}
            chevron
            onPress={toggleLanguage}
          />
        </View>

        {/* ── HELP & SUPPORT ── */}
        <Text style={styles.sectionHeader}>HELP & SUPPORT</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="help-circle-outline"
            label="FAQ"
            chevron
            onPress={() => Alert.alert('FAQ', 'FAQ coming soon')}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="chatbubble-outline"
            label="Contact support"
            chevron
            onPress={() => Alert.alert('Contact Support', 'Opens email/chat: support@wasel.jo')}
          />
        </View>

        {/* ── SAFETY ── */}
        <Text style={styles.sectionHeader}>SAFETY</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="shield-outline"
            label="Emergency contact"
            chevron
            onPress={() => Alert.alert('Emergency Contact', 'Emergency contact coming soon')}
          />
        </View>

        {/* ── LEGAL ── */}
        <Text style={styles.sectionHeader}>LEGAL</Text>
        <View style={styles.section}>
          <SettingsRow
            icon="document-text-outline"
            label="Privacy policy"
            chevron
            onPress={() => Alert.alert('Privacy Policy', 'https://wasel.jo/privacy')}
          />
          <View style={styles.rowDivider} />
          <SettingsRow
            icon="document-text-outline"
            label="Terms of service"
            chevron
            onPress={() => Alert.alert('Terms of Service', 'https://wasel.jo/terms')}
          />
        </View>

        {/* ── About row (standalone) ── */}
        <View style={styles.aboutRow}>
          <Text style={styles.aboutText}>Wasel · Version 1.0.0</Text>
        </View>

        {/* ── Sign Out ── */}
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

// ── Styles ───────────────────────────────────────────────────────────────────
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
    paddingBottom: Platform.OS === 'ios' ? 48 : 36,
  },

  // ── Header ──
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFF',
  },

  // ── Avatar section ──
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

  // ── Early member card ──
  earlyCard: {
    backgroundColor: 'rgba(245,166,35,0.06)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.35)',
    padding: 16,
    marginBottom: 24,
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

  // ── Skeleton card ──
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },

  // ── Section header label ──
  sectionHeader: {
    fontSize: 11,
    fontWeight: '600',
    color: '#555',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },

  // ── Section card ──
  section: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    marginBottom: 20,
    overflow: 'hidden',
  },

  // ── Row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
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
    flexShrink: 0,
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  rowLabel: {
    fontSize: 15,
    color: '#FFF',
    fontWeight: '500',
  },
  rowChildren: {
    marginTop: 4,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  rowValue: {
    fontSize: 13,
    color: '#666',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#1A1A1A',
    marginLeft: 52,
  },

  // ── Chips (Saved Places) ──
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    backgroundColor: '#1E1E1E',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  chipText: {
    fontSize: 11,
    color: '#888',
    fontWeight: '500',
  },

  // ── About row ──
  aboutRow: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 8,
  },
  aboutText: {
    fontSize: 13,
    color: '#333',
  },

  // ── Sign out ──
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
