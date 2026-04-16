import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Full driver dashboard (online toggle, trip offers, navigation) — implemented in next phase
export default function DashboardScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Driver Dashboard — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#FFF', fontSize: 18 },
});
