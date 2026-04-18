import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ScrollView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Category values must match what the backend returns (singular, lowercase)
type Category = 'all' | 'restaurant' | 'cafe' | 'landmark' | 'shopping';

interface Place {
  id: string;
  name: string;
  name_ar?: string;
  address?: string;
  address_ar?: string;
  category: string;
  image_emoji?: string; // kept for API compatibility, not rendered
  rating?: number;
  price_range?: string; // e.g. '$', '$$', '$$$', 'Free'
  lat?: number;
  lng?: number;
}

const CATEGORIES: { key: Category; labelKey: string }[] = [
  { key: 'all',        labelKey: 'all' },
  { key: 'restaurant', labelKey: 'restaurants' },
  { key: 'cafe',       labelKey: 'cafes' },
  { key: 'landmark',   labelKey: 'landmarks' },
  { key: 'shopping',   labelKey: 'shopping' },
];

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'restaurant': return 'restaurant-outline';
    case 'cafe':       return 'cafe-outline';
    case 'landmark':   return 'business-outline';
    case 'shopping':   return 'bag-outline';
    default:           return 'location-outline';
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Text key={i} style={{ fontSize: 11, color: i <= Math.round(rating) ? '#F5A623' : '#333' }}>
          ★
        </Text>
      ))}
    </View>
  );
}

function PriceRange({ value }: { value: string }) {
  return (
    <Text style={{ fontSize: 12, color: '#666' }}>{value}</Text>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonEmoji} />
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '60%', marginTop: 6 }]} />
      </View>
    </View>
  );
}

export default function ExploreScreen() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [places, setPlaces] = useState<Place[]>([]);
  const [cached, setCached] = useState<Place[]>([]);
  const [category, setCategory] = useState<Category>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPlaces(isRefresh = false) {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`${API_URL}/api/explore`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Place[] = await res.json();
      setPlaces(data);
      setCached(data);
    } catch {
      setError(t('errorLoad'));
      if (cached.length > 0) {
        setPlaces(cached);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchPlaces();
  }, []);

  const onRefresh = useCallback(() => {
    fetchPlaces(true);
  }, []);

  const filtered = category === 'all'
    ? places
    : places.filter((p) => p.category === category);

  function getPlaceName(place: Place): string {
    if (language === 'ar' && place.name_ar) return place.name_ar;
    return place.name;
  }

  function getPlaceAddress(place: Place): string | undefined {
    if (language === 'ar' && place.address_ar) return place.address_ar;
    return place.address;
  }

  function handleRideHere(place: Place) {
    // Use the lat/lng already embedded in the backend response — no geocoding needed.
    if (place.lat != null && place.lng != null) {
      router.navigate({
        pathname: '/(app)/home' as any,
        params: {
          destName: getPlaceName(place),
          destLat:  String(place.lat),
          destLng:  String(place.lng),
        },
      });
    } else {
      Alert.alert('Not available', 'Location data missing for this place. Try searching manually.');
    }
  }

  function renderPlace({ item }: { item: Place }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardIcon}>
          <Ionicons name={getCategoryIcon(item.category) as any} size={22} color="#F5A623" />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardName} numberOfLines={1}>{getPlaceName(item)}</Text>
          {getPlaceAddress(item) ? (
            <Text style={styles.cardAddress} numberOfLines={1}>{getPlaceAddress(item)}</Text>
          ) : null}
          <View style={styles.cardMeta}>
            {item.rating != null && <StarRating rating={item.rating} />}
            {item.price_range != null && <PriceRange value={item.price_range} />}
          </View>
        </View>
        <TouchableOpacity
          style={styles.rideBtn}
          onPress={() => handleRideHere(item)}
          activeOpacity={0.75}
        >
          <Ionicons name="car-outline" size={16} color="#000" />
          <Text style={styles.rideBtnText}>Ride</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeTop}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('exploreAmman')}</Text>
          <Text style={styles.headerSubtitle}>{t('exploreSubtitle')}</Text>
        </View>

        {/* Category pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
        >
          {CATEGORIES.map(({ key, labelKey }) => (
            <TouchableOpacity
              key={key}
              style={[styles.pill, category === key && styles.pillActive]}
              onPress={() => setCategory(key)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pillText, category === key && styles.pillTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {/* Error banner */}
      {error && !loading && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <View style={styles.skeletonList}>
          {[1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderPlace}
          contentContainerStyle={styles.list}
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
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>{t('noPlaces')}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  safeTop: { backgroundColor: '#0A0A0A' },
  header: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  headerTitle: { fontSize: 26, fontWeight: '700', color: '#FFF' },
  headerSubtitle: { fontSize: 13, color: '#555', marginTop: 4 },
  pills: {
    paddingHorizontal: 16, paddingVertical: 10, gap: 8,
    flexDirection: 'row',
  },
  pill: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: '#161616',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  pillActive: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  pillText: { color: '#666', fontSize: 13, fontWeight: '600' },
  pillTextActive: { color: '#000' },
  errorBanner: {
    marginHorizontal: 16, marginTop: 8,
    backgroundColor: '#1A0A0A', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#3A1A1A',
  },
  errorText: { color: '#FF6B6B', fontSize: 13 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111',
    borderRadius: 16, padding: 14,
    marginBottom: 10,
    borderWidth: 1, borderColor: '#1E1E1E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  cardIcon: {
    width: 52, height: 52,
    backgroundColor: '#1A1A1A', borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  cardContent: { flex: 1, gap: 4 },
  cardName: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  cardAddress: { color: '#666', fontSize: 12 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  emptyWrap: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#444', fontSize: 15 },
  // Skeleton
  skeletonList: { padding: 16 },
  skeletonCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#111', borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  skeletonEmoji: {
    width: 52, height: 52,
    backgroundColor: '#1E1E1E', borderRadius: 14,
  },
  skeletonContent: { flex: 1 },
  skeletonLine: {
    height: 14, backgroundColor: '#1E1E1E', borderRadius: 7,
    width: '80%',
  },
  rideBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 52,
  },
  rideBtnText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '700',
  },
});
