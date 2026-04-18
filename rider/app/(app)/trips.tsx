import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

interface TripRecord {
  id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  created_at: string;
  driver_rating: number | null;
  driver: { name: string; vehicle_make: string; vehicle_model: string } | null;
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'completed' ? '#4CAF50' : '#FF5252';
  return (
    <View style={[pill.wrap, { borderColor: color }]}>
      <Text style={[pill.txt, { color }]}>{status}</Text>
    </View>
  );
}
const pill = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  txt:  { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
});

export default function TripsScreen() {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(isRefresh = false) {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`${API_URL}/api/riders/trips`, {
        headers: { Authorization: `Bearer ${token ?? ''}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TripRecord[] = await res.json();
      setTrips(data);
    } catch {
      // Silent — stale data is fine
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(true), []);

  function renderItem({ item }: { item: TripRecord }) {
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return (
      <View style={s.card}>
        <View style={s.cardTop}>
          <Text style={s.date}>{date}</Text>
          <StatusPill status={item.status} />
        </View>
        <View style={s.route}>
          <View style={s.dotOrange} />
          <Text style={s.addr} numberOfLines={1}>{item.pickup_address || 'Pickup'}</Text>
        </View>
        <View style={s.route}>
          <View style={s.dotGreen} />
          <Text style={s.addr} numberOfLines={1}>{item.dropoff_address || 'Dropoff'}</Text>
        </View>
        <View style={s.cardBottom}>
          {item.driver ? (
            <Text style={s.driver}>
              {item.driver.name} · {item.driver.vehicle_make} {item.driver.vehicle_model}
            </Text>
          ) : null}
          {item.fare_amount != null ? (
            <Text style={s.fare}>{Number(item.fare_amount).toFixed(2)} JD</Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A0A0A' }}>
        <View style={s.header}>
          <Text style={s.headerTitle}>My Trips</Text>
        </View>
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing} onRefresh={onRefresh}
              tintColor="#F5A623" colors={['#F5A623']}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="car-outline" size={40} color="#333" />
              <Text style={s.emptyTxt}>No trips yet</Text>
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
  center:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:        { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    backgroundColor: '#111', borderRadius: 16, padding: 16,
    marginBottom: 10, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  date:        { fontSize: 12, color: '#666' },
  route:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  dotOrange:   { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5A623' },
  dotGreen:    { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4CAF50' },
  addr:        { flex: 1, fontSize: 13, color: '#CCC' },
  cardBottom:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  driver:      { fontSize: 12, color: '#666', flex: 1 },
  fare:        { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  empty:       { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt:    { color: '#444', fontSize: 15 },
});
