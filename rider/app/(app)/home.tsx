import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Keyboard, ScrollView, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Amman default center
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

type TripStatus = 'idle' | 'searching' | 'dispatching' | 'accepted' | 'en_route' | 'arrived' | 'in_progress' | 'completed';

interface LatLng { latitude: number; longitude: number; }

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [location, setLocation] = useState<LatLng | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<LatLng | null>(null);
  const [tripStatus, setTripStatus] = useState<TripStatus>('idle');
  const [tripId, setTripId] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(null);
  const [activeInput, setActiveInput] = useState<'pickup' | 'dropoff' | null>(null);
  const [fare, setFare] = useState<string | null>(null);

  // Get user location on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      setPickupCoords(coords);
      setPickup('Current Location');

      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
    })();
  }, []);

  // Subscribe to trip updates via Supabase Realtime
  useEffect(() => {
    if (!tripId) return;

    const channel = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'trips',
        filter: `id=eq.${tripId}`,
      }, (payload) => {
        const newStatus = payload.new.status as TripStatus;
        setTripStatus(newStatus);
        if (newStatus === 'completed' || newStatus === 'cancelled') {
          setTimeout(() => {
            setTripStatus('idle');
            setTripId(null);
            setDriverLocation(null);
            setDropoff('');
            setDropoffCoords(null);
            setFare(null);
          }, 3000);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tripId]);

  // Handle map press to set dropoff
  function handleMapPress(e: { nativeEvent: { coordinate: LatLng } }) {
    if (activeInput === 'dropoff' || tripStatus === 'idle') {
      const coord = e.nativeEvent.coordinate;
      setDropoffCoords(coord);
      setDropoff(`${coord.latitude.toFixed(4)}, ${coord.longitude.toFixed(4)}`);
      setActiveInput(null);
      Keyboard.dismiss();

      // Estimate fare (simple distance-based)
      if (pickupCoords) {
        const dist = haversineKm(pickupCoords.latitude, pickupCoords.longitude, coord.latitude, coord.longitude);
        const estimated = Math.max(1.5, 0.5 + dist * 0.35); // base 0.5 JD + 0.35/km
        setFare(estimated.toFixed(2));
      }
    }
  }

  async function handleRequestRide() {
    if (!pickupCoords || !dropoffCoords) {
      Alert.alert('Set pickup and dropoff', 'Tap the map to set your destination.');
      return;
    }

    setTripStatus('searching');

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch(`${API_URL}/api/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          pickup_lat: pickupCoords.latitude,
          pickup_lng: pickupCoords.longitude,
          dropoff_lat: dropoffCoords.latitude,
          dropoff_lng: dropoffCoords.longitude,
          pickup_address: pickup,
          dropoff_address: dropoff,
          payment_method: 'cash',
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request ride');

      setTripId(data.tripId);
      setTripStatus('dispatching');
    } catch (err: unknown) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong');
      setTripStatus('idle');
    }
  }

  async function handleCancelTrip() {
    if (tripId) {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (token) {
          await fetch(`${API_URL}/api/trips/${tripId}/status`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ status: 'cancelled' }),
          });
        }
      } catch {
        // UI always resets regardless of network error
      }
    }
    setTripStatus('idle');
    setTripId(null);
    setDriverLocation(null);
  }

  const statusLabel: Record<TripStatus, string> = {
    idle: '',
    searching: 'Finding drivers...',
    dispatching: 'Contacting driver...',
    accepted: 'Driver accepted!',
    en_route: 'Driver on the way',
    arrived: 'Driver has arrived',
    in_progress: 'Trip in progress',
    completed: 'Trip complete! 🎉',
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onPress={handleMapPress}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {pickupCoords && (
          <Marker coordinate={pickupCoords} title="Pickup" pinColor="#F5A623" />
        )}
        {dropoffCoords && (
          <Marker coordinate={dropoffCoords} title="Dropoff" pinColor="#00C851" />
        )}
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Driver">
            <View style={styles.driverMarker}>
              <Text style={styles.driverMarkerText}>🚗</Text>
            </View>
          </Marker>
        )}
        {pickupCoords && dropoffCoords && (
          <Polyline
            coordinates={[pickupCoords, dropoffCoords]}
            strokeColor="#F5A623"
            strokeWidth={2}
            lineDashPattern={[8, 4]}
          />
        )}
      </MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarInner}>
          <Text style={styles.topLogo}>وصل</Text>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Bottom sheet */}
      <View style={styles.bottomSheet}>
        {tripStatus === 'idle' ? (
          <>
            <Text style={styles.sheetTitle}>Where to?</Text>

            {/* Pickup input */}
            <TouchableOpacity
              style={[styles.inputRow, activeInput === 'pickup' && styles.inputRowActive]}
              onPress={() => setActiveInput('pickup')}
            >
              <View style={[styles.dot, { backgroundColor: '#F5A623' }]} />
              <Text style={[styles.inputText, !pickup && styles.placeholder]}>
                {pickup || 'Set pickup location'}
              </Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* Dropoff input */}
            <TouchableOpacity
              style={[styles.inputRow, activeInput === 'dropoff' && styles.inputRowActive]}
              onPress={() => setActiveInput('dropoff')}
            >
              <View style={[styles.dot, { backgroundColor: '#00C851' }]} />
              <Text style={[styles.inputText, !dropoff && styles.placeholder]}>
                {dropoff || 'Tap map to set destination'}
              </Text>
            </TouchableOpacity>

            {/* Fare estimate */}
            {fare && dropoffCoords && (
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Estimated fare</Text>
                <Text style={styles.fareAmount}>{fare} JD</Text>
                <Text style={styles.fareNote}>Cash payment</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.requestButton, !dropoffCoords && styles.requestButtonDisabled]}
              onPress={handleRequestRide}
              disabled={!dropoffCoords}
              activeOpacity={0.85}
            >
              <Text style={styles.requestButtonText}>Request Wasel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.statusSheet}>
            <View style={styles.statusRow}>
              {(tripStatus === 'searching' || tripStatus === 'dispatching') && (
                <ActivityIndicator color="#F5A623" style={{ marginRight: 12 }} />
              )}
              <Text style={styles.statusText}>{statusLabel[tripStatus]}</Text>
            </View>

            {tripStatus !== 'completed' && tripStatus !== 'in_progress' && (
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancelTrip}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  map: { flex: 1 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: 10,
  },
  topBarInner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.85)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
  },
  topLogo: { fontSize: 22, fontWeight: '700', color: '#F5A623' },
  signOut: { color: '#555', fontSize: 13 },
  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 10,
    elevation: 10,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: '#FFF', marginBottom: 16 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  inputRowActive: { opacity: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  inputText: { flex: 1, fontSize: 16, color: '#FFF' },
  placeholder: { color: '#555' },
  divider: { height: 1, backgroundColor: '#1E1E1E', marginVertical: 2, marginLeft: 22 },
  fareRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1A1A1A', borderRadius: 10, padding: 12, marginTop: 12,
  },
  fareLabel: { color: '#888', fontSize: 13, flex: 1 },
  fareAmount: { color: '#F5A623', fontSize: 18, fontWeight: '700' },
  fareNote: { color: '#555', fontSize: 12 },
  requestButton: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 16,
  },
  requestButtonDisabled: { opacity: 0.35 },
  requestButtonText: { color: '#000', fontWeight: '700', fontSize: 17 },
  statusSheet: { alignItems: 'center', paddingVertical: 8 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  statusText: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  cancelButton: {
    borderWidth: 1, borderColor: '#333', borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 32,
  },
  cancelButtonText: { color: '#888', fontSize: 15 },
  driverMarker: {
    backgroundColor: '#111', borderRadius: 20,
    padding: 4, borderWidth: 1, borderColor: '#333',
  },
  driverMarkerText: { fontSize: 20 },
});
