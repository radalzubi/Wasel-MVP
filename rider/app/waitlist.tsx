import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../contexts/LanguageContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function WaitlistScreen() {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
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
          role: 'rider',
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
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>واصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
          <Text style={styles.tagline}>{t('taglineRider')}</Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.sectionTitle}>{t('beFirstToRide')}</Text>

          <Text style={styles.label}>{t('fullName')}</Text>
          <TextInput
            style={styles.input}
            placeholder="Ahmad Al-Khalidi"
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
            placeholder="ahmad@example.com"
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

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleJoin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>{t('joinWaitlist')}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>{t('waitlistDisclaimer')}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 60, fontWeight: '700', color: '#F5A623' },
  logoEn: { fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginTop: -8, letterSpacing: 4 },
  tagline: { fontSize: 14, color: '#666', marginTop: 12, textAlign: 'center' },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 20 },
  form: {},
  label: { color: '#AAA', fontSize: 13, marginBottom: 6, marginTop: 14 },
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
  button: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 17 },
  disclaimer: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 18, lineHeight: 18 },
});
