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

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Van', 'Minibus'];

export default function DriverWaitlistScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Missing info', 'Please enter your name and phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          city: city.trim() || undefined,
          vehicle_type: vehicleType || undefined,
          role: 'driver',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');
      router.replace('/waitlist-success');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong');
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
          <Text style={styles.logo}>وصل</Text>
          <Text style={styles.logoEn}>Wasel</Text>
          <Text style={styles.tagline}>Drive with Wasel — earn more, pay less</Text>
        </View>

        {/* Earning pitch */}
        <View style={styles.pitchRow}>
          {['No commission', 'Flat subscription', 'You keep earnings'].map((item) => (
            <View key={item} style={styles.pitchItem}>
              <Text style={styles.pitchText}>{item}</Text>
            </View>
          ))}
        </View>

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.sectionTitle}>Join as a driver</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Mohammad Al-Ahmad"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="+962 7X XXX XXXX"
            placeholderTextColor="#555"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>City (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Amman, Zarqa, Irbid..."
            placeholderTextColor="#555"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Vehicle Type (optional)</Text>
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
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.buttonText}>Join as Driver</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            We'll contact you when onboarding opens in your city.{'\n'}No spam, ever.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 48 },
  header: { alignItems: 'center', marginBottom: 28 },
  logo: { fontSize: 60, fontWeight: '700', color: '#F5A623' },
  logoEn: { fontSize: 32, fontWeight: '700', color: '#FFFFFF', marginTop: -8, letterSpacing: 4 },
  tagline: { fontSize: 14, color: '#666', marginTop: 12, textAlign: 'center' },
  pitchRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32, gap: 8 },
  pitchItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  pitchText: { color: '#F5A623', fontSize: 11, fontWeight: '600', textAlign: 'center' },
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
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  vehicleChip: {
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  vehicleChipSelected: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  vehicleChipText: { color: '#AAA', fontSize: 14 },
  vehicleChipTextSelected: { color: '#000', fontWeight: '700' },
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
