import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Full rider home + booking flow — implemented in next phase
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Rider App — Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' },
  text: { color: '#FFF', fontSize: 18 },
});
