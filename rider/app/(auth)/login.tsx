import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [devLoading, setDevLoading] = useState(false);

  async function handleDevLogin() {
    setDevLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'rider' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Dev login failed');
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      // AuthContext picks up the session change automatically
    } catch (err: unknown) {
      Alert.alert('Dev login failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDevLoading(false);
    }
  }

  async function handleSendOTP() {
    const cleaned = phone.trim();
    if (!cleaned) {
      Alert.alert('Enter your phone number');
      return;
    }

    // Ensure it starts with + for international format
    const formatted = cleaned.startsWith('+') ? cleaned : `+962${cleaned.replace(/^0/, '')}`;

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: formatted });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    router.push({ pathname: '/(auth)/verify', params: { phone: formatted } });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>وصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
        </View>

        <Text style={styles.title}>Enter your phone number</Text>
        <Text style={styles.subtitle}>We'll send you a verification code</Text>

        <View style={styles.inputRow}>
          <View style={styles.countryCode}>
            <Text style={styles.countryCodeText}>🇯🇴 +962</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="7X XXX XXXX"
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
            : <Text style={styles.buttonText}>Send Code</Text>
          }
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By continuing you agree to our Terms of Service
        </Text>

        {__DEV__ && (
          <TouchableOpacity
            style={styles.devButton}
            onPress={handleDevLogin}
            disabled={devLoading}
            activeOpacity={0.7}
          >
            {devLoading
              ? <ActivityIndicator color="#F5A623" size="small" />
              : <Text style={styles.devButtonText}>⚡ Dev: Skip Auth (Rider)</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  header: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 52, fontWeight: '700', color: '#F5A623' },
  logoEn: { fontSize: 28, fontWeight: '700', color: '#FFF', marginTop: -6, letterSpacing: 4 },
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
  devButton: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    opacity: 0.7,
  },
  devButtonText: { color: '#F5A623', fontSize: 13, fontWeight: '600' },
});
