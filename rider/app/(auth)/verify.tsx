import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { t } = useLanguage();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(30);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const interval = setInterval(() => {
      setResendTimer((t) => (t > 0 ? t - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

  async function handleVerify() {
    if (otp.length < 6) {
      Alert.alert(t('enterCode'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, token: otp, role: 'rider' }),
      });
      const data = await res.json();
      setLoading(false);

      if (!res.ok) {
        Alert.alert('Invalid code', data.error || 'Please check the code and try again.');
        return;
      }

      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });

      router.replace('/(app)/home');
    } catch (err) {
      setLoading(false);
      Alert.alert('Error', 'Could not connect to server. Please try again.');
    }
  }

  async function handleResend() {
    if (resendTimer > 0) return;
    try {
      const res = await fetch(`${API_URL}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (res.ok) setResendTimer(30);
    } catch (err) {
      // silently ignore resend errors
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>{t('back')}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{t('enterCode')}</Text>
        <Text style={styles.subtitle}>{t('sentTo')} {phone}</Text>

        <TextInput
          ref={inputRef}
          style={styles.otpInput}
          value={otp}
          onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="• • • • • •"
          placeholderTextColor="#333"
          textAlign="center"
        />

        {__DEV__ && (
          <TouchableOpacity style={styles.devHint} onPress={() => setOtp('123456')} activeOpacity={0.7}>
            <Text style={styles.devHintText}>Dev: use 123456</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, (loading || otp.length < 6) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading || otp.length < 6}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.buttonText}>{t('verify')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resend}
          onPress={handleResend}
          disabled={resendTimer > 0}
        >
          <Text style={[styles.resendText, resendTimer > 0 && styles.resendDisabled]}>
            {resendTimer > 0 ? `${t('resendIn')} ${resendTimer}${t('seconds')}` : t('resendCode')}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flex: 1, padding: 28, justifyContent: 'center' },
  back: { position: 'absolute', top: 60, left: 28 },
  backText: { color: '#F5A623', fontSize: 16 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 40 },
  otpInput: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 16,
    paddingVertical: 20,
    fontSize: 36,
    color: '#FFF',
    letterSpacing: 12,
    marginBottom: 12,
  },
  devHint: {
    backgroundColor: '#0D1117',
    borderWidth: 1,
    borderColor: '#1E3A1E',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  devHintText: {
    color: '#4CAF50', fontSize: 12, fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  button: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 17 },
  resend: { alignItems: 'center' },
  resendText: { color: '#F5A623', fontSize: 15 },
  resendDisabled: { color: '#444' },
});
