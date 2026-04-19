import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props  { children: React.ReactNode; }
interface State  { hasError: boolean; error: string; }

/**
 * Catches any render-time JavaScript exception in the subtree and shows a
 * recovery screen instead of crashing the whole app.
 *
 * React Native has no built-in safety net — a single thrown exception during
 * render kills the JS runtime entirely. This boundary intercepts that before
 * it propagates to the native layer.
 *
 * Usage: wrap Tabs (or individual screens) in <ErrorBoundary> in _layout.tsx.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(err: unknown): State {
    return {
      hasError: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    // Log full stack trace so we can find the real crash cause
    console.error('[ErrorBoundary] caught render error:', err);
    console.error('[ErrorBoundary] component stack:', info.componentStack);
  }

  reset = () => this.setState({ hasError: false, error: '' });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Ionicons name="warning-outline" size={52} color="#F5A623" />
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.detail} numberOfLines={5}>{this.state.error}</Text>
        <TouchableOpacity style={styles.btn} onPress={this.reset} activeOpacity={0.85}>
          <Text style={styles.btnText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#0A0A0A',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  title: {
    fontSize: 22, fontWeight: '700', color: '#FFF',
    marginTop: 20, marginBottom: 10, textAlign: 'center',
  },
  detail: {
    fontSize: 13, color: '#555', textAlign: 'center',
    marginBottom: 32, lineHeight: 20,
  },
  btn: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, paddingHorizontal: 40,
  },
  btnText: { color: '#000', fontWeight: '700', fontSize: 16 },
});
