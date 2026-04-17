import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Vibration, Platform, Modal, Animated,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

/** Haversine great-circle distance in kilometres. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type TripStatus = 'accepted' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

interface TripOffer {
  id: string;
  trip_id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number;
  pickup_lng: number;
  fare_estimate: string;
  distance_km: string;
}

interface LatLng { latitude: number; longitude: number; }

const TIER_META: Record<number, { label: string; price: number; color: string; text: string }> = {
  1: { label: 'Silver',    price: 20, color: '#2A2A2A', text: '#AAA' },
  2: { label: 'Gold',      price: 35, color: '#F5A623', text: '#000' },
  3: { label: 'Platinum',  price: 50, color: '#8B5CF6', text: '#FFF' },
};

function getTierBadge(tier: number) {
  return TIER_META[tier] ?? TIER_META[1];
}

export default function DashboardScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const mapRef = useRef<MapView>(null);

  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [offer, setOffer] = useState<TripOffer | null>(null);
  const [offerTimer, setOfferTimer] = useState(15);
  const [currentTrip, setCurrentTrip] = useState<{ id: string; status: TripStatus } | null>(null);
  const [subscriptionTier, setSubscriptionTier] = useState<number>(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulsing animation for urgent timer
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (offerTimer <= 5 && offer) {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current.start();
    } else {
      pulseLoopRef.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => {
      pulseLoopRef.current?.stop();
    };
  }, [offerTimer <= 5, !!offer]);

  // Fetch driver profile for tier badge
  useEffect(() => {
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        const res = await fetch(`${API_URL}/api/drivers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSubscriptionTier(data.subscription_tier ?? 1);
        }
      } catch {
        // Non-fatal — tier badge stays at default
      }
    })();
  }, [user]);

  // Get location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
        mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
      } catch {
        // Location unavailable — fall back to Amman center
      }
    })();
  }, []);

  // Ping location every 10s when online
  useEffect(() => {
    if (!isOnline || !user) return;

    const interval = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);

        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        await fetch(`${API_URL}/api/drivers/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
        });
      } catch {
        // Non-fatal: skip this ping, try again next interval
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isOnline, user]);

  // Subscribe to trip_offers via Supabase Realtime
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`driver-offers-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'trip_offers',
        filter: `driver_id=eq.${user.id}`,
      }, async (payload) => {
        const offerData = payload.new;

        // Fetch trip details
        const { data: trip } = await supabase
          .from('trips')
          .select('pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_amount')
          .eq('id', offerData.trip_id)
          .single();

        if (trip) {
          Vibration.vibrate(Platform.OS === 'android' ? [0, 400, 200, 400] : 400);

          // Compute real trip distance from stored coordinates.
          const distKm =
            trip.pickup_lat != null && trip.pickup_lng != null &&
            trip.dropoff_lat != null && trip.dropoff_lng != null
              ? haversineKm(trip.pickup_lat, trip.pickup_lng, trip.dropoff_lat, trip.dropoff_lng)
              : null;

          setOffer({
            id: offerData.id,
            trip_id: offerData.trip_id,
            pickup_address: trip.pickup_address || 'Pickup location',
            dropoff_address: trip.dropoff_address || 'Dropoff location',
            pickup_lat: trip.pickup_lat ?? 0,
            pickup_lng: trip.pickup_lng ?? 0,
            fare_estimate: trip.fare_amount ? `${trip.fare_amount} JD` : '~2-5 JD',
            distance_km: distKm != null ? distKm.toFixed(1) : '—',
          });
          setOfferTimer(15);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Offer countdown timer
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!offer) return;

    timerRef.current = setInterval(() => {
      setOfferTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          setOffer(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [offer]);

  async function toggleOnline(value: boolean) {
    const prevOnline = isOnline;
    setIsOnline(value); // optimistic update
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await fetch(`${API_URL}/api/drivers/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ is_online: value, is_available: value }),
      });
      if (!res.ok) setIsOnline(prevOnline); // revert on error response
    } catch {
      setIsOnline(prevOnline); // revert on network error
    }
  }

  async function handleAccept() {
    if (!offer) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');

      const res = await fetch(`${API_URL}/api/trips/${offer.trip_id}/accept`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      setCurrentTrip({ id: offer.trip_id, status: 'accepted' as TripStatus });
      setOffer(null);
    } catch (err: unknown) {
      // Do not surface raw API error messages to the user.
      Alert.alert('Could not accept trip', 'Please try again.');
      setOffer(null);
    }
  }

  async function handleDecline() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const declinedOffer = offer;
    setOffer(null);
    if (declinedOffer) {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token) {
          await fetch(`${API_URL}/api/trips/${declinedOffer.trip_id}/decline`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
          });
        }
      } catch {
        // Non-fatal: offer is already cleared from UI
      }
    }
  }

  async function advanceTripStatus(nextStatus: string) {
    if (!currentTrip) return;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('No session');

      const res = await fetch(`${API_URL}/api/trips/${currentTrip.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      if (nextStatus === 'completed') {
        setCurrentTrip(null);
      } else {
        setCurrentTrip({ ...currentTrip, status: nextStatus as TripStatus });
      }
    } catch (err: unknown) {
      // Do not surface raw API error messages to the user.
      Alert.alert('Status update failed', 'Please try again.');
    }
  }

  const tripActions: Record<string, { labelKey: string; next: TripStatus }> = {
    accepted:    { labelKey: 'startDrive',    next: 'en_route'    },
    en_route:    { labelKey: 'iArrived',      next: 'arrived'     },
    arrived:     { labelKey: 'startTrip',     next: 'in_progress' },
    in_progress: { labelKey: 'completeTrip',  next: 'completed'   },
  };

  const tripStatusLabel: Record<string, string> = {
    accepted:    t('driverAccepted'),
    en_route:    t('drivingToPickup'),
    arrived:     t('driverArrived'),
    in_progress: t('tripInProgress'),
    completed:   t('tripComplete'),
  };

  const tierBadge = getTierBadge(subscriptionTier);
  const isTimerUrgent = offerTimer <= 5;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation
      >
        {location && (
          <Marker coordinate={location}>
            <View style={styles.driverMarker}>
              <View style={styles.driverMarkerDot} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarInner}>
          <View style={styles.topLogoRow}>
            <Text style={styles.topLogo}>
              وصل <Text style={styles.driverBadge}>Driver</Text>
            </Text>
            <View style={[styles.tierBadge, { backgroundColor: tierBadge.color }]}>
              <Text style={[styles.tierBadgeText, { color: tierBadge.text }]}>
                {tierBadge.label}
              </Text>
            </View>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        {!currentTrip ? (
          <>
            <View style={styles.onlineRow}>
              <View>
                <Text style={styles.onlineLabel}>{isOnline ? t('online') : t('offline')}</Text>
                <Text style={styles.onlineSub}>{isOnline ? t('acceptingTrips') : t('goOnlineMsg')}</Text>
              </View>
              <Switch
                value={isOnline}
                onValueChange={toggleOnline}
                trackColor={{ false: '#2A2A2A', true: '#F5A623' }}
                thumbColor={isOnline ? '#000' : '#555'}
              />
            </View>

            {isOnline && (
              <View style={styles.waitingRow}>
                <Text style={styles.waitingText}>{t('waitingForTrips')}</Text>
                <View style={styles.fareIsYoursRow}>
                  <Text style={styles.fareIsYoursText}>{t('fareIsYours')}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>{t('todayEarnings')}</Text>
                  <Text style={styles.earningsValue}>0 JD</Text>
                  <View style={styles.earningsSep} />
                  <Text style={styles.earningsLabel}>{t('todayTrips')}</Text>
                  <Text style={styles.earningsValue}>0</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <View>
            <Text style={styles.tripActiveLabel}>
              {tripStatusLabel[currentTrip.status] ?? t('tripActive')}
            </Text>
            {currentTrip.status && tripActions[currentTrip.status] && (
              <TouchableOpacity
                style={styles.tripActionButton}
                onPress={() => advanceTripStatus(tripActions[currentTrip.status].next)}
              >
                <Text style={styles.tripActionText}>{t(tripActions[currentTrip.status].labelKey)}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Trip offer modal */}
      <Modal visible={!!offer} transparent animationType="slide">
        <View style={styles.offerOverlay}>
          <View style={styles.offerCard}>
            <View style={styles.offerTimerRow}>
              <Text style={styles.offerTimerLabel}>{t('newTripRequest')}</Text>
              <Animated.View
                style={[
                  styles.offerTimer,
                  isTimerUrgent && styles.offerTimerUrgent,
                  isTimerUrgent && { opacity: pulseAnim },
                ]}
              >
                <Text style={styles.offerTimerText}>{offerTimer}s</Text>
              </Animated.View>
            </View>

            <View style={styles.offerRoute}>
              <View style={styles.offerRouteRow}>
                <View style={[styles.routeDot, { backgroundColor: '#F5A623' }]} />
                <Text style={styles.offerAddress} numberOfLines={1}>{offer?.pickup_address}</Text>
              </View>
              <View style={styles.offerRouteLine} />
              <View style={styles.offerRouteRow}>
                <View style={[styles.routeDot, { backgroundColor: '#00C851' }]} />
                <Text style={styles.offerAddress} numberOfLines={1}>{offer?.dropoff_address}</Text>
              </View>
            </View>

            <View style={styles.offerFareRow}>
              <View>
                <Text style={styles.offerFareLabel}>{t('estimatedFareLabel')}</Text>
                {offer?.distance_km && offer.distance_km !== '—' && (
                  <Text style={styles.offerDistanceText}>{offer.distance_km} km</Text>
                )}
              </View>
              <Text style={styles.offerFare}>{offer?.fare_estimate}</Text>
            </View>

            <View style={styles.offerButtons}>
              <TouchableOpacity style={styles.declineButton} onPress={handleDecline}>
                <Text style={styles.declineText}>{t('decline')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptButton} onPress={handleAccept}>
                <Text style={styles.acceptText}>{t('accept')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  map: { flex: 1 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarInner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.85)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
  },
  topLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  topLogo: { fontSize: 20, fontWeight: '700', color: '#F5A623' },
  driverBadge: { fontSize: 11, color: '#888', fontWeight: '400', letterSpacing: 2 },
  tierBadge: {
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  tierBadgeText: { fontSize: 11, fontWeight: '700' },
  driverMarker: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },
  driverMarkerDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#000',
  },
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  onlineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  onlineLabel: { fontSize: 18, fontWeight: '700', color: '#FFF', marginBottom: 4 },
  onlineSub: { fontSize: 13, color: '#666' },
  waitingRow: { marginTop: 16, alignItems: 'center', gap: 10 },
  waitingText: { color: '#444', fontSize: 14 },
  fareIsYoursRow: {
    backgroundColor: 'rgba(245,166,35,0.07)',
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
    paddingHorizontal: 14, paddingVertical: 6,
  },
  fareIsYoursText: { color: '#F5A623', fontSize: 12, fontWeight: '600' },
  earningsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#161616', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  earningsLabel: { fontSize: 12, color: '#555' },
  earningsValue: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  earningsSep: { width: 1, height: 12, backgroundColor: '#2A2A2A', marginHorizontal: 4 },
  tripActiveLabel: { fontSize: 18, fontWeight: '700', color: '#FFF', marginBottom: 16 },
  tripActionButton: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  tripActionText: { color: '#000', fontWeight: '700', fontSize: 17 },
  // Offer modal
  offerOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  offerCard: {
    backgroundColor: '#111',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 44 : 24,
  },
  offerTimerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  offerTimerLabel: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  offerTimer: {
    backgroundColor: '#F5A623', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  offerTimerUrgent: { backgroundColor: '#FF3B30' },
  offerTimerText: { color: '#000', fontWeight: '700', fontSize: 16 },
  offerRoute: {
    backgroundColor: '#1A1A1A', borderRadius: 14, padding: 16, marginBottom: 16,
  },
  offerRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  offerRouteLine: { width: 1, height: 16, backgroundColor: '#333', marginLeft: 6, marginVertical: 4 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  offerAddress: { flex: 1, color: '#FFF', fontSize: 15 },
  offerFareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
  },
  offerFareLabel: { color: '#666', fontSize: 14, marginBottom: 2 },
  offerDistanceText: { color: '#555', fontSize: 12, marginTop: 2 },
  offerFare: { color: '#F5A623', fontSize: 26, fontWeight: '700' },
  offerButtons: { flexDirection: 'row', gap: 12 },
  declineButton: {
    flex: 1, borderWidth: 1, borderColor: '#333', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  declineText: { color: '#666', fontWeight: '600', fontSize: 16 },
  acceptButton: {
    flex: 2, backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center',
  },
  acceptText: { color: '#000', fontWeight: '700', fontSize: 17 },
});
