import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function WaitlistSuccess() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>You're on the list!</Text>
        <Text style={styles.subtitle}>
          We'll reach out when Wasel launches in your city.{'\n\n'}
          Tell your friends — the more people who sign up, the faster we launch.
        </Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>واصل  ·  Wasel</Text>
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
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emoji: { fontSize: 72, marginBottom: 28 },
  title: { fontSize: 30, fontWeight: '700', color: '#FFF', marginBottom: 16, textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#777', textAlign: 'center', lineHeight: 26 },
  badge: {
    marginTop: 48,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 100,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  badgeText: { color: '#F5A623', fontSize: 14, fontWeight: '600', letterSpacing: 2 },
});
