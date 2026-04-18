import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function DriverWaitlistSuccess() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.emoji}>🚗</Text>

        <Text style={styles.title}>You're on the list!</Text>
        <Text style={styles.subtitle}>
          We'll reach out when driver onboarding opens in your city.
        </Text>

        {/* Model reminder */}
        <View style={styles.modelCard}>
          <Text style={styles.modelCardTitle}>A quick reminder of how Wasel works</Text>

          <View style={styles.modelRow}>
            <Text style={styles.modelRowIcon}>✕</Text>
            <View style={styles.modelRowText}>
              <Text style={styles.modelRowLabel}>Traditional platforms</Text>
              <Text style={styles.modelRowDesc}>Take 20–30% of every fare you earn</Text>
            </View>
          </View>

          <View style={styles.modelDivider} />

          <View style={styles.modelRow}>
            <Text style={[styles.modelRowIcon, styles.modelRowIconGold]}>✓</Text>
            <View style={styles.modelRowText}>
              <Text style={[styles.modelRowLabel, styles.modelRowLabelGold]}>Wasel</Text>
              <Text style={styles.modelRowDesc}>
                Flat monthly subscription (20–50 JD). Every fare is 100% yours.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>وصل  ·  Wasel Driver</Text>
        </View>

        <TouchableOpacity
          style={{ marginTop: 24 }}
          onPress={() => router.replace('/(auth)/login' as any)}
        >
          <Text style={{ color: '#F5A623', fontWeight: '600', fontSize: 15, textAlign: 'center' }}>
            Already have an account? Sign in
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  emoji: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '700', color: '#FFF', marginBottom: 10, textAlign: 'center' },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 24, marginBottom: 36 },

  modelCard: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    padding: 18,
    width: '100%',
    marginBottom: 40,
  },
  modelCardTitle: {
    fontSize: 12, color: '#555', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 16,
  },
  modelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  modelRowIcon: { fontSize: 18, color: '#FF3B30', marginTop: 1, width: 20, textAlign: 'center' },
  modelRowIconGold: { color: '#F5A623' },
  modelRowText: { flex: 1 },
  modelRowLabel: { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 3 },
  modelRowLabelGold: { color: '#F5A623' },
  modelRowDesc: { fontSize: 13, color: '#666', lineHeight: 20 },
  modelDivider: { height: 1, backgroundColor: '#1E1E1E', marginVertical: 14 },

  badge: {
    borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 100,
    paddingHorizontal: 20, paddingVertical: 8,
  },
  badgeText: { color: '#F5A623', fontSize: 14, fontWeight: '600', letterSpacing: 2 },
});
