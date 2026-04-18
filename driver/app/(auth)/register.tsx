import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export default function RegisterScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!name.trim() || !make.trim() || !model.trim() || !plate.trim()) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');

      const res = await fetch(`${API_URL}/api/drivers/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          vehicle_make: make.trim(),
          vehicle_model: model.trim(),
          vehicle_plate: plate.trim().toUpperCase(),
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      router.replace('/(auth)/pending' as any);
    } catch (e: unknown) {
      Alert.alert('Registration failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.scroll}>
          <Text style={s.title}>Complete Your Profile</Text>
          <Text style={s.sub}>Enter your details to register as a Wasel driver.</Text>

          <Text style={s.label}>Full name</Text>
          <TextInput
            style={s.input} value={name} onChangeText={setName}
            placeholder="e.g. Ahmad Al-Khalidi" placeholderTextColor="#444"
            autoCapitalize="words"
          />

          <Text style={s.label}>Vehicle make</Text>
          <TextInput
            style={s.input} value={make} onChangeText={setMake}
            placeholder="e.g. Toyota" placeholderTextColor="#444"
            autoCapitalize="words"
          />

          <Text style={s.label}>Vehicle model</Text>
          <TextInput
            style={s.input} value={model} onChangeText={setModel}
            placeholder="e.g. Corolla" placeholderTextColor="#444"
            autoCapitalize="words"
          />

          <Text style={s.label}>Plate number</Text>
          <TextInput
            style={s.input} value={plate} onChangeText={setPlate}
            placeholder="e.g. 12-34-ABC" placeholderTextColor="#444"
            autoCapitalize="characters"
          />

          <TouchableOpacity
            style={[s.btn, loading && s.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={s.btnTxt}>{loading ? 'Submitting\u2026' : 'Submit Application'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: '#0A0A0A' },
  scroll:      { padding: 24, paddingBottom: 48 },
  title:       { fontSize: 26, fontWeight: '700', color: '#FFF', marginBottom: 8 },
  sub:         { fontSize: 14, color: '#666', marginBottom: 32, lineHeight: 20 },
  label:       { fontSize: 13, color: '#888', fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 12, padding: 14, color: '#FFF', fontSize: 16, marginBottom: 20,
  },
  btn: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt:      { color: '#000', fontSize: 16, fontWeight: '700' },
});
