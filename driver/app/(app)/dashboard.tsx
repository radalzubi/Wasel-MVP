import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Vibration, Platform, Modal,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

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

export default function DashboardScreen() {
  const { user, signOut } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [isOnline, setIsOnline] = useState(false);
  const [location, setLocation] = useState<LatLng | null>(null);
  const [offer, setOffer] = useState<TripOffer | null>(null);
  const [offerTimer, setOfferTimer] = useState(15);
  const [currentTrip, setCurrentTrip] = useState<{ id: string; status: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get location + start sending pings when online
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
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
          setOffer({
            id: offerData.id,
            trip_id: offerData.trip_id,
            pickup_address: trip.pickup_address || 'Pickup location',
            dropoff_address: trip.dropoff_address || 'Dropoff location',
            pickup_lat: trip.pickup_lat ?? 0,
            pickup_lng: trip.pickup_lng ?? 0,
            fare_estimate: trip.fare_amount ? `${trip.fare_amount} JD` : '~2-5 JD',
            distance_km: '—',
          });
          setOfferTimer(15);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Offer countdown timer — always clear existing interval before starting a new one
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!offer) return;

    timerRef.current = setInterval(() => {
      setOfferTimer((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          setOffer(null);
          return 0;
        }
        return t - 1;
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
    setIsOnline(value);

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    await fetch(`${API_URL}/api/drivers/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ is_online: value, is_available: value }),
    });
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

      setCurrentTrip({ id: offer.trip_id, status: 'accepted' });
      setOffer(null);
    } catch (err: unknown) {
      Alert.alert('Could not accept trip', err instanceof Error ? err.message : 'Please try again.');
      setOffer(null); // dismiss offer — it may have expired
    }
  }

  function handleDecline() {
    clearInterval(timerRef.current!);
    setOffer(null);
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
        setCurrentTrip({ ...currentTrip, status: nextStatus });
      }
    } catch (err: unknown) {
      Alert.alert('Status update failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  const tripActions: Record<string, { label: string; next: string }> = {
    accepted: { label: 'I\'ve arrived', next: 'arrived' },
    arrived: { label: 'Start trip', next: 'in_progress' },
    in_progress: { label: 'Complete trip', next: 'completed' },
  };

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
              <Text>🚗</Text>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarInner}>
          <Text style={styles.topLogo}>وصل <Text style={styles.driverBadge}>Driver</Text></Text>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        {!currentTrip ? (
          <>
            <View style={styles.onlineRow}>
              <View>
                <Text style={styles.onlineLabel}>{isOnline ? '🟢 Online' : '⚫ Offline'}</Text>
                <Text style={styles.onlineSub}>{isOnline ? 'Accepting trips' : 'Go online to receive trips'}</Text>
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
                <Text style={styles.waitingText}>Waiting for trips...</Text>
              </View>
            )}
          </>
        ) : (
          <View>
            <Text style={styles.tripActiveLabel}>Trip in progress</Text>
            {tripActions[currentTrip.status] && (
              <TouchableOpacity
                style={styles.tripActionButton}
                onPress={() => advanceTripStatus(tripActions[currentTrip.status].next)}
              >
                <Text style={styles.tripActionText}>{tripActions[currentTrip.status].label}</Text>
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
              <Text style={styles.offerTimerLabel}>New trip request</Text>
              <View style={[styles.offerTimer, offerTimer <= 5 && styles.offerTimerUrgent]}>
                <Text style={styles.offerTimerText}>{offerTimer}s</Text>
              </View>
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
              <Text style={styles.offerFareLabel}>Estimated fare</Text>
              <Text style={styles.offerFare}>{offer?.fare_estimate}</Text>
            </View>

            <View style={styles.offerButtons}>
              <TouchableOpacity style={styles.declineButton} onPress={handleDecline}>
                <Text style={styles.declineText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.acceptButton} onPress={handleAccept}>
                <Text style={styles.acceptText}>Accept</Text>
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
  topLogo: { fontSize: 20, fontWeight: '700', color: '#F5A623' },
  driverBadge: { fontSize: 11, color: '#888', fontWeight: '400', letterSpacing: 2 },
  signOut: { color: '#555', fontSize: 13 },
  driverMarker: {
    backgroundColor: '#111', borderRadius: 20, padding: 4,
    borderWidth: 1, borderColor: '#333',
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
  waitingRow: { marginTop: 16, alignItems: 'center' },
  waitingText: { color: '#444', fontSize: 14 },
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
  offerFareLabel: { color: '#666', fontSize: 14 },
  offerFare: { color: '#F5A623', fontSize: 22, fontWeight: '700' },
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
