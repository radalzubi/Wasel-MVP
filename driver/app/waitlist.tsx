import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../contexts/LanguageContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Minibus'];

// Tier pricing is the core of the model — defined once, used in two places
const TIERS = [
  {
    tier: 1,
    emoji: '🥈',
    nameKey: 'silver' as const,
    price: 20,
    descKey: 'tierSilverDesc' as const,
    borderColor: '#3A3A3A',
    accentColor: '#888',
    weight: 40,
  },
  {
    tier: 2,
    emoji: '🥇',
    nameKey: 'gold' as const,
    price: 35,
    descKey: 'tierGoldDesc' as const,
    borderColor: '#F5A623',
    accentColor: '#F5A623',
    weight: 70,
  },
  {
    tier: 3,
    emoji: '💎',
    nameKey: 'platinum' as const,
    price: 50,
    descKey: 'tierPlatinumDesc' as const,
    borderColor: '#8B5CF6',
    accentColor: '#8B5CF6',
    weight: 100,
  },
] as const;

export default function DriverWaitlistScreen() {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert(t('missingInfo'), t('enterNamePhone'));
      return;
    }

    // Normalize phone: strip spaces/dashes, ensure +962 prefix
    let normalizedPhone = phone.trim().replace(/[\s\-]/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.startsWith('0')
        ? `+962${normalizedPhone.slice(1)}`
        : `+962${normalizedPhone}`;
    }
    const jordanPhoneRegex = /^\+9627[789]\d{7}$/;
    if (!jordanPhoneRegex.test(normalizedPhone)) {
      Alert.alert(t('error'), 'Please enter a valid Jordanian mobile number (e.g. 07X XXX XXXX).');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: normalizedPhone,
          email: email.trim() || undefined,
          city: city.trim() || undefined,
          vehicle_type: vehicleType || undefined,
          role: 'driver',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');
      router.replace('/waitlist-success');
    } catch (err: unknown) {
      Alert.alert(t('error'), err instanceof Error ? err.message : t('somethingWrong'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ── Logo ── */}
        <View style={styles.logoBlock}>
          <Text style={styles.logo}>وصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
        </View>

        {/* ── Model pitch ── */}
        <View style={styles.pitchBlock}>
          <Text style={styles.pitchHeadline}>{t('modelHeadline')}</Text>
          <Text style={styles.pitchSubtitle}>{t('modelSubtitle')}</Text>
        </View>

        {/* ── Tier cards ── */}
        <View style={styles.tiersBlock}>
          {TIERS.map((tier) => (
            <View
              key={tier.tier}
              style={[styles.tierCard, { borderColor: tier.borderColor }]}
            >
              {/* tier badge */}
              <View style={styles.tierCardTop}>
                <Text style={styles.tierEmoji}>{tier.emoji}</Text>
                <View style={styles.tierNameBlock}>
                  <Text style={[styles.tierName, { color: tier.accentColor }]}>
                    {t(tier.nameKey)}
                  </Text>
                  <Text style={styles.tierDesc}>{t(tier.descKey)}</Text>
                </View>
                <Text style={[styles.tierPrice, { color: tier.accentColor }]}>
                  {tier.price} JD{t('perMonth')}
                </Text>
              </View>

              {/* dispatch weight bar */}
              <View style={styles.weightRow}>
                <Text style={styles.weightLabel}>{t('dispatchWeight')}</Text>
                <View style={styles.weightBarTrack}>
                  <View
                    style={[
                      styles.weightBarFill,
                      { width: `${tier.weight}%` as any, backgroundColor: tier.accentColor },
                    ]}
                  />
                </View>
                <Text style={[styles.weightPct, { color: tier.accentColor }]}>{tier.weight}%</Text>
              </View>
            </View>
          ))}

          <Text style={styles.tierStartNote}>{t('tierStartNote')}</Text>
        </View>

        {/* ── Form ── */}
        <View style={styles.form}>
          <Text style={styles.sectionTitle}>{t('joinAsDriver')}</Text>

          <Text style={styles.label}>{t('fullName')}</Text>
          <TextInput
            style={styles.input}
            placeholder="Mohammad Al-Ahmad"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>{t('phoneNumber')}</Text>
          <TextInput
            style={styles.input}
            placeholder="+962 7X XXX XXXX"
            placeholderTextColor="#555"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="mohammad@example.com"
            placeholderTextColor="#555"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>{t('cityOptional')}</Text>
          <TextInput
            style={styles.input}
            placeholder="Amman, Zarqa, Irbid..."
            placeholderTextColor="#555"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
          />

          <Text style={styles.label}>{t('vehicleType')}</Text>
          <View style={styles.vehicleRow}>
            {VEHICLE_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.vehicleChip, vehicleType === type && styles.vehicleChipSelected]}
                onPress={() => setVehicleType(vehicleType === type ? '' : type)}
              >
                <Text style={[styles.vehicleChipText, vehicleType === type && styles.vehicleChipTextSelected]}>
                  {type}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.buttonText}>{t('joinAsDriverBtn')}</Text>
            }
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{t('driverDisclaimer')}</Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 52 },

  // Logo
  logoBlock: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 56, fontWeight: '700', color: '#F5A623' },
  logoEn: { fontSize: 28, fontWeight: '700', color: '#FFF', marginTop: -8, letterSpacing: 4 },

  // Model pitch
  pitchBlock: { marginBottom: 28 },
  pitchHeadline: {
    fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 12, lineHeight: 32,
  },
  pitchSubtitle: {
    fontSize: 14, color: '#888', lineHeight: 22,
  },

  // Tier cards
  tiersBlock: { marginBottom: 36 },
  tierCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  tierCardTop: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
  },
  tierEmoji: { fontSize: 22 },
  tierNameBlock: { flex: 1 },
  tierName: { fontSize: 14, fontWeight: '700' },
  tierDesc: { fontSize: 12, color: '#666', marginTop: 2 },
  tierPrice: { fontSize: 16, fontWeight: '800' },

  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightLabel: { fontSize: 11, color: '#555', width: 100 },
  weightBarTrack: {
    flex: 1, height: 4, backgroundColor: '#222', borderRadius: 2, overflow: 'hidden',
  },
  weightBarFill: { height: 4, borderRadius: 2 },
  weightPct: { fontSize: 11, fontWeight: '700', width: 36, textAlign: 'right' },

  tierStartNote: {
    fontSize: 12, color: '#555', textAlign: 'center', marginTop: 8, lineHeight: 18,
  },

  // Form
  form: {},
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#FFF', marginBottom: 20 },
  label: { color: '#888', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFF',
  },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  vehicleChip: {
    borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 100,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  vehicleChipSelected: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  vehicleChipText: { color: '#888', fontSize: 14 },
  vehicleChipTextSelected: { color: '#000', fontWeight: '700' },
  button: {
    backgroundColor: '#F5A623', borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 28,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 17 },
  disclaimer: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 18, lineHeight: 18 },
});
