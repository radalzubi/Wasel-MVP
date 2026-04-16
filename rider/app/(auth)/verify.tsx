import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
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

  async function handleVerify() {
    if (otp.length < 6) {
      Alert.alert('Enter the 6-digit code');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: phone!,
      token: otp,
      type: 'sms',
    });
    setLoading(false);

    if (error) {
      Alert.alert('Invalid code', 'Please check the code and try again.');
      return;
    }

    // Auth state change will trigger redirect via _layout
    router.replace('/(app)/home');
  }

  async function handleResend() {
    if (resendTimer > 0) return;
    const { error } = await supabase.auth.signInWithOtp({ phone: phone! });
    if (!error) setResendTimer(30);
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Enter the code</Text>
        <Text style={styles.subtitle}>Sent to {phone}</Text>

        <TextInput
          ref={inputRef}
          style={styles.otpInput}
          value={otp}
          onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="• • • • • •"
          placeholderTextColor="#333"
          textAlign="center"
        />

        <TouchableOpacity
          style={[styles.button, (loading || otp.length < 6) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading || otp.length < 6}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.buttonText}>Verify</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.resend}
          onPress={handleResend}
          disabled={resendTimer > 0}
        >
          <Text style={[styles.resendText, resendTimer > 0 && styles.resendDisabled]}>
            {resendTimer > 0 ? `Resend code in ${resendTimer}s` : 'Resend code'}
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
    marginBottom: 24,
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
