import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

// ────────────────────────────────────────────────────────────────────────────
// RecoveryShell — fallback UI shown when useStartupHealth detects a
// crash-loop (3+ consecutive unhealthy launches). Deliberately minimal:
//   - no MapView
//   - no live-trip restore
//   - no realtime subscriptions
//   - no network calls at render time
// The ONLY goal is to give the user a visible escape hatch so they aren't
// trapped reinstalling the app.
//
// Tapping "Continue Safely" calls `onContinue` from the parent, which in
// this app wiring calls exitRecoveryMode() on the useStartupHealth hook.
// That marks the launch healthy and switches bootState to 'normal' — the
// parent component then renders the full screen as usual.
// ────────────────────────────────────────────────────────────────────────────

interface Props {
  appName: 'Wasel' | 'Wasel Driver';
  onContinue: () => void;
}

export function RecoveryShell({ appName, onContinue }: Props) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.iconWrap}>
          <Text style={s.iconGlyph}>⚠︎</Text>
        </View>
        <Text style={s.title}>{appName} hit a snag</Text>
        <Text style={s.subtitle}>
          We noticed the app restarted unexpectedly. We've paused trip restore
          to get you back to a safe state.
        </Text>
        <Text style={s.body2}>
          Tap below to continue. If the problem keeps happening, please sign
          out from your Profile and sign back in.
        </Text>
        <TouchableOpacity style={s.button} onPress={onContinue} activeOpacity={0.85}>
          <Text style={s.buttonText}>Continue Safely</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A0A0A' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24,
  },
  iconGlyph: { color: '#F5A623', fontSize: 32, fontWeight: '700' },
  title: { color: '#FFF', fontSize: 22, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  subtitle: { color: '#AAA', fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 16 },
  body2: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 32 },
  button: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 48,
  },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
