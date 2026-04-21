import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

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
  average_rating:    number | null;
  rating_count:      number;
}

export default function EarningsScreen() {
  const { authFetch }          = useAuth();
  const { t, language, isRTL } = useLanguage();
  const [trips, setTrips]      = useState<TripRecord[]>([]);
  const [summary, setSummary]  = useState<Summary | null>(null);
  const [loading, setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
      // Silent — stale data is acceptable on refresh failure
    } finally {
      if (isMounted.current) { setLoading(false); setRefreshing(false); }
    }
  }

  useEffect(() => { load(); }, []);
  const onRefresh = useCallback(() => load(true), []);

  function formatDate(isoString: string) {
    const ts = new Date(isoString);
    const locale = language === 'ar' ? 'ar-JO' : 'en-US';
    const date = ts.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
    const time = ts.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  }

  function StarRating({ value }: { value: number }) {
    const filled = Math.round(value);
    return (
      <View style={{ flexDirection: 'row', gap: 2 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <Ionicons
            key={i}
            name={i <= filled ? 'star' : 'star-outline'}
            size={12}
            color={i <= filled ? '#F5A623' : '#333'}
          />
        ))}
      </View>
    );
  }

  function renderItem({ item }: { item: TripRecord }) {
    return (
      <View style={[s.card, isRTL && s.cardRTL]}>
        <View style={s.cardLeft}>
          <Text style={[s.dateTime, isRTL && s.textRight]}>
            {item.created_at ? formatDate(item.created_at) : '—'}
          </Text>
          <Text style={[s.addr, isRTL && s.textRight]} numberOfLines={1}>
            {item.pickup_address || t('tripPickup')}
          </Text>
          <Text style={[s.addrTo, isRTL && s.textRight]} numberOfLines={1}>
            {isRTL ? '← ' : '→ '}{item.dropoff_address || t('tripDropoff')}
          </Text>
          {item.rider_rating != null && (
            <View style={[s.ratingRow, isRTL && s.ratingRowRTL]}>
              <StarRating value={item.rider_rating} />
            </View>
          )}
        </View>
        <Text style={s.fare}>
          {item.fare_amount != null ? `${Number(item.fare_amount).toFixed(2)} JD` : '—'}
        </Text>
      </View>
    );
  }

  const ratingCount = summary?.rating_count ?? 0;
  const ratingDisplay = ratingCount > 0 && summary?.average_rating != null
    ? summary.average_rating.toFixed(2)
    : '—';

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#0A0A0A' }}>
        <View style={[s.header, isRTL && s.headerRTL]}>
          <Text style={s.headerTitle}>{t('earnings')}</Text>
        </View>
        {summary && (
          <View style={s.summaryRow}>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>
                {(summary.today_earnings_jd ?? 0).toFixed(2)} JD
              </Text>
              <Text style={s.summaryLbl}>{t('today')}</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>
                {(summary.total_earnings_jd ?? 0).toFixed(2)} JD
              </Text>
              <Text style={s.summaryLbl}>{t('allTime')}</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{summary.total_trips}</Text>
              <Text style={s.summaryLbl}>{t('tripsCount')}</Text>
            </View>
            <View style={s.summaryCard}>
              <Text style={s.summaryVal}>{ratingDisplay}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
                <Ionicons name="star" size={10} color="#F5A623" />
                <Text style={s.summaryLbl}>{t('yourRating')}</Text>
              </View>
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
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F5A623"
              colors={['#F5A623']}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="wallet-outline" size={40} color="#333" />
              <Text style={s.emptyTxt}>{t('noTripsYet')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0A0A0A' },
  header:       { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerRTL:    { alignItems: 'flex-end' },
  headerTitle:  { fontSize: 26, fontWeight: '700', color: '#FFF' },
  summaryRow:   { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  summaryCard: {
    flex: 1, backgroundColor: '#111', borderRadius: 14, padding: 10,
    borderWidth: 1, borderColor: '#1E1E1E', alignItems: 'center',
  },
  summaryVal:   { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  summaryLbl:   { fontSize: 10, color: '#666', marginTop: 2 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list:         { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#111', borderRadius: 14, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#1E1E1E',
  },
  cardRTL:      { flexDirection: 'row-reverse' },
  cardLeft:     { flex: 1, marginRight: 12 },
  textRight:    { textAlign: 'right' },
  dateTime:     { fontSize: 11, color: '#555', marginBottom: 4 },
  addr:         { fontSize: 13, color: '#CCC', fontWeight: '500' },
  addrTo:       { fontSize: 12, color: '#555', marginTop: 2 },
  ratingRow:    { flexDirection: 'row', marginTop: 4 },
  ratingRowRTL: { flexDirection: 'row-reverse' },
  fare:         { fontSize: 16, fontWeight: '700', color: '#F5A623' },
  empty:        { alignItems: 'center', marginTop: 80, gap: 12 },
  emptyTxt:     { color: '#444', fontSize: 15 },
});
