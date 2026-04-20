import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface TripRecord {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  created_at: string;
  rider_rating: number | null;
}

interface Summary {
  total_trips:       number;
  total_earnings_jd: number;
  today_earnings_jd: number;
}

export default function EarningsScreen() {
  const { authFetch } = useAuth();
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Prevents setState after unmount if the user navigates away before the fetch completes
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/drivers/trips`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!isMounted.current) return;
      setTrips(data.trips ?? []);
      setSummary(data.summary ?? null);
    } catch {
      // Silent — stale data is acceptable (summary stays at previous value on pull-to-refresh failure)
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(true), []);

  function renderItem({ item }: { item: TripRecord }) {
    const ts = item.created_at ? new Date(item.created_at) : null;
    const date = ts ? ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
    const time = ts ? ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return (
      <View style={s.card}>
        <View style={s.cardLeft}>
          <Text style={s.dateTime}>{date} · {time}</Text>
          <Text style={s.addr} numberOfLines={1}>{item.pickup_address || 'Pickup'}</Text>
          <Text style={s.addrTo} numberOfLines={1}>→ {item.dropoff_address || 'Dropoff'}</Text>
        </View>
        <Text style={s.fare}>
          {item.fare_amount != null ? `${Number(item.fare_amount).toFixed(2)} JD` : '—'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A0A0A' }}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Earnings</Text>
        </View>
        {summary && (
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{(summary.today_earnings_jd ?? 0).toFixed(2)} JD</Text>
              <Text style={s.summaryLbl}>Today</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{(summary.total_earnings_jd ?? 0).toFixed(2)} JD</Text>
              <Text style={s.summaryLbl}>All time</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{summary.total_trips}</Text>
              <Text style={s.summaryLbl}>Trips</Text>
            </View>
          </View>
        )}
      </SafeAreaView>
      {loading ? (
        <View style={s.center}><ActivityIndicator color="#F5A623" size="large" /></View>
      ) : (
        <FlatList
          data={trips}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F5A623" colors={['#F5A623']} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="wallet-outline" size={40} color="#333" />
              <Text style={s.emptyTxt}>No completed trips yet</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0A0A0A' },
  header:      { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },
  summaryRow:  { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: '#111', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#1E1E1E', alignItems: 'center',
  },
  summaryVal:  { fontSize: 18, fontWeight: '700', color: '#F5A623' },
  summaryLbl:  { fontSize: 11, color: '#666', marginTop: 2 },
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardLeft:  { flex: 1, marginRight: 12 },
  dateTime:  { fontSize: 11, color: '#555', marginBottom: 4 },
  addr:      { fontSize: 13, color: '#CCC', fontWeight: '500' },
  addrTo:    { fontSize: 12, color: '#555', marginTop: 2 },
  fare:      { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  empty:     { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt:  { color: '#444', fontSize: 15 },
});
