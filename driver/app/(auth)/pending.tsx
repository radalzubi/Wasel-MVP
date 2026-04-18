import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';

export default function PendingApprovalScreen() {
  const { signOut } = useAuth();
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.center}>
        <View style={s.icon}>
          <Ionicons name="time-outline" size={48} color="#F5A623" />
        </View>
        <Text style={s.title}>Application Submitted</Text>
        <Text style={s.body}>
          Your driver application is under review. You'll receive a notification once
          approved — typically within 24 hours.
        </Text>
        <TouchableOpacity onPress={signOut} style={s.link}>
          <Text style={s.linkTxt}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0A0A0A' },
  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon:    { marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12, textAlign: 'center' },
  body:    { fontSize: 15, color: '#666', lineHeight: 24, textAlign: 'center', marginBottom: 32 },
  link:    { padding: 12 },
  linkTxt: { color: '#F5A623', fontWeight: '600', fontSize: 15 },
});
