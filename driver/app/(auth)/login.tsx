import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useLanguage } from '../../contexts/LanguageContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function DriverLoginScreen() {
  const { t, language, toggleLanguage } = useLanguage();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSendOTP() {
    const cleaned = phone.trim();
    if (!cleaned) {
      Alert.alert(t('enterPhone'));
      return;
    }

    const formatted = cleaned.startsWith('+') ? cleaned : `+962${cleaned.replace(/^0/, '')}`;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formatted }),
      });
      const data = await res.json();
      if (res.status === 503) {
        // Backend is in waitlist mode — send the user to the waitlist screen.
        router.replace('/waitlist');
        return;
      }
      if (!res.ok) {
        Alert.alert(t('error'), data.error || t('otpSendFailed'));
        return;
      }
    } catch {
      Alert.alert(t('error'), t('otpSendFailed'));
      return;
    } finally {
      setLoading(false);
    }

    router.push({ pathname: '/(auth)/verify', params: { phone: formatted } });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {/* Language toggle */}
        <View style={styles.langRow}>
          <TouchableOpacity style={styles.langToggle} onPress={toggleLanguage}>
            <Text style={styles.langToggleText}>{language === 'en' ? 'AR' : 'EN'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <Text style={styles.logo}>واصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
          <Text style={styles.role}>Driver</Text>
        </View>

        <Text style={styles.title}>{t('enterPhone')}</Text>
        <Text style={styles.subtitle}>{t('sendCodeSubtitle')}</Text>

        <View style={styles.inputRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryCodeText}>+962</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder={t('phonePlaceholder')}
            placeholderTextColor="#555"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSendOTP}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.buttonText}>{t('sendCode')}</Text>
          }
        </TouchableOpacity>

        <Text style={styles.disclaimer}>{t('driverApproval')}</Text>

        {__DEV__ && (
          <TouchableOpacity
            style={styles.devHint}
            onPress={() => setPhone('790000002')}
            activeOpacity={0.7}
          >
            <Text style={styles.devHintText}>
              Dev mode · Phone: +962790000002 · Code: 123456
            </Text>
            <Text style={styles.devHintSub}>Tap to pre-fill phone</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  langRow: { alignItems: 'flex-end', marginBottom: 16 },
  langToggle: {
    backgroundColor: '#161616', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  langToggleText: { color: '#F5A623', fontSize: 13, fontWeight: '700' },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 52, fontWeight: '700', color: '#F5A623' },
  logoEn: { fontSize: 28, fontWeight: '700', color: '#FFF', marginTop: -6, letterSpacing: 4 },
  role: { fontSize: 13, color: '#F5A623', letterSpacing: 3, marginTop: 6, fontWeight: '600' },
  title: { fontSize: 24, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 28 },
  inputRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  countryCode: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  countryCodeText: { color: '#FFF', fontSize: 15 },
  input: {
    flex: 1,
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    color: '#FFF',
    letterSpacing: 2,
  },
  button: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 17 },
  disclaimer: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 20 },
  devHint: {
    marginTop: 32,
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#1E3A1E',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  devHintText: { color: '#4CAF50', fontSize: 12, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  devHintSub: { color: '#2A5C2A', fontSize: 11, marginTop: 4 },
});
