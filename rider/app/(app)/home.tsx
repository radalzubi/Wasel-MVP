import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, Keyboard, Animated,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Amman default center
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

type TripStatus = 'idle' | 'searching' | 'dispatching' | 'accepted' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

interface LatLng { latitude: number; longitude: number; }

interface RiderProfile {
  is_waitlist_member?: boolean;
}

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
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
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);

  // Animation refs
  const sheetAnim = useRef(new Animated.Value(0)).current; // 0 = booking, 1 = active trip
  const fareAnim = useRef(new Animated.Value(0)).current;  // 0 = hidden, 1 = visible

  // Get user location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
        setPickupCoords(coords);
        setPickup(t('currentLocation'));

        mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
      } catch {
        // Location unavailable — fall back to Amman center
      }
    })();
  }, []);

  // Fetch rider profile (for waitlist badge)
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token) return;
        const res = await fetch(`${API_URL}/api/riders/me`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setRiderProfile(data);
        }
      } catch {
        // Non-fatal: badge just won't appear
      }
    })();
  }, [user]);

  // Subscribe to trip updates via Supabase Realtime
  useEffect(() => {
    if (!tripId) return;

    // Race-condition guard: fetch current status immediately after subscribing
    // so we don't miss any updates that arrived between trip creation and subscription setup.
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
            fareAnim.setValue(0);
            Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
          }, 3000);
        }
      })
      .subscribe(async () => {
        // Once subscribed, poll for the latest status to catch any updates missed
        // during the window between trip creation and subscription establishment.
        try {
          const session = await supabase.auth.getSession();
          const token = session.data.session?.access_token;
          if (!token) return;
          const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            const currentStatus = data.status as TripStatus;
            if (currentStatus && currentStatus !== 'requested') {
              setTripStatus(currentStatus);
            }
          }
        } catch {
          // Non-fatal: Realtime events will still arrive going forward
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, [tripId]);

  // Animate sheet when trip status transitions between idle and active
  useEffect(() => {
    if (tripStatus === 'idle') {
      Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
    } else if (tripStatus === 'searching') {
      Animated.timing(sheetAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
    }
  }, [tripStatus]);

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
        const estimated = Math.max(1.5, 0.5 + dist * 0.35);
        setFare(estimated.toFixed(2));
        // Animate fare row in
        fareAnim.setValue(0);
        Animated.timing(fareAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
      }
    }
  }

  async function handleRequestRide() {
    if (!pickupCoords || !dropoffCoords) {
      Alert.alert(t('setPickupDropoff'), t('tapMapDest2'));
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
          ...(fare != null ? { fare_amount: parseFloat(fare) } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to request ride');

      setTripId(data.tripId);
      setTripStatus('dispatching');
    } catch (err: unknown) {
      // Do not surface raw API error messages to the user.
      Alert.alert(t('error'), t('somethingWrong') || 'Something went wrong. Please try again.');
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
    setDropoff('');
    setDropoffCoords(null);
    setFare(null);
    fareAnim.setValue(0);
    Animated.timing(sheetAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  }

  const statusLabel: Record<TripStatus, string> = {
    idle: '',
    searching: t('findingDrivers'),
    dispatching: t('contactingDriver'),
    accepted: t('driverAccepted'),
    en_route: t('driverOnWay'),
    arrived: t('driverArrived'),
    in_progress: t('tripInProgress'),
    completed: t('tripComplete'),
    cancelled: 'Trip Cancelled',
  };

  const isActiveTrip = tripStatus !== 'idle';
  const isSearching = tripStatus === 'searching' || tripStatus === 'dispatching';
  const statusDotColor = isSearching ? '#F5A623' : '#4CAF50';

  const fareAnimStyle = {
    opacity: fareAnim,
    transform: [{
      translateY: fareAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }),
    }],
  };

  return (
    <View style={styles.container}>
      {/* Map fills entire background */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
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
          <Marker coordinate={dropoffCoords} title="Dropoff" pinColor="#4CAF50" />
        )}
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Driver">
            <View style={styles.driverMarker}>
              <Ionicons name="car" size={14} color="#FFF" />
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

      {/* Top bar — overlaid on map */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarInner}>
          <View style={styles.logoRow}>
            <Text style={styles.topLogo}>Wasel</Text>
            {riderProfile?.is_waitlist_member && (
              <View style={styles.earlyBadge}>
                <Ionicons name="star" size={10} color="#F5A623" />
                <Text style={styles.earlyBadgeText}>{t('earlyMember')}</Text>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* Map spacer — lets map tap events pass through */}
      <View style={styles.mapSpacer} pointerEvents="none" />

      {/* Booking panel — anchored naturally at bottom as flex child */}
      <View style={[styles.bookingPanel, { paddingBottom: 60 }]}>
        {/* Drag handle */}
        <View style={styles.sheetHandle} />

        {!isActiveTrip ? (
          <>
            <Text style={styles.sheetTitle}>{t('whereTo')}</Text>

            {/* Pickup input */}
            <TouchableOpacity
              style={[styles.inputField, activeInput === 'pickup' && styles.inputFieldActive]}
              onPress={() => setActiveInput('pickup')}
              activeOpacity={0.75}
            >
              <Ionicons name="radio-button-on" size={16} color="#F5A623" />
              <Text style={[styles.inputFieldText, !pickup && styles.placeholder]}>
                {pickup || t('setPickup')}
              </Text>
            </TouchableOpacity>

            {/* Connecting line between inputs */}
            <View style={styles.routeLine} />

            {/* Dropoff input */}
            <TouchableOpacity
              style={[styles.inputField, activeInput === 'dropoff' && styles.inputFieldActive]}
              onPress={() => setActiveInput('dropoff')}
              activeOpacity={0.75}
            >
              <Ionicons name="location" size={16} color="#4CAF50" />
              <Text style={[styles.inputFieldText, !dropoff && styles.placeholder]}>
                {dropoff || t('tapMapDest')}
              </Text>
            </TouchableOpacity>

            {/* Fare estimate — animated in */}
            {fare && dropoffCoords && (
              <Animated.View style={[styles.fareRow, fareAnimStyle]}>
                <View style={styles.fareTopRow}>
                  <Text style={styles.fareLabel}>{t('estimatedFare')}</Text>
                  <Text style={styles.fareAmount}>{fare} JD</Text>
                </View>
                <Text style={styles.fareNote}>{t('cashPayment')} · {t('tapMapDest')}</Text>
              </Animated.View>
            )}

            <TouchableOpacity
              style={[styles.requestButton, !dropoffCoords && styles.requestButtonDisabled]}
              onPress={handleRequestRide}
              disabled={!dropoffCoords}
              activeOpacity={0.85}
            >
              <Text style={styles.requestButtonText}>{t('requestWasel')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.statusSheet}>
            {/* Status indicator */}
            <View style={styles.statusRow}>
              {isSearching ? (
                <ActivityIndicator color="#F5A623" style={styles.statusSpinner} />
              ) : (
                <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
              )}
              {tripStatus === 'completed' ? (
                <Text style={styles.statusLabel}>Trip complete</Text>
              ) : (
                <Text style={styles.statusLabel}>{statusLabel[tripStatus]}</Text>
              )}
            </View>

            {/* Cancel button — full width outline */}
            {tripStatus !== 'completed' && tripStatus !== 'in_progress' && (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={handleCancelTrip}
                activeOpacity={0.75}
              >
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },

  // Top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBarInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.82)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topLogo: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F5A623',
  },
  earlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,166,35,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  earlyBadgeText: {
    color: '#F5A623',
    fontSize: 10,
    fontWeight: '600',
  },

  // Map spacer — transparent, lets map touch events through
  mapSpacer: {
    flex: 1,
  },

  // Booking panel
  bookingPanel: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
  },

  // Drag handle
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A2A2A',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },

  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 14,
  },

  // Input fields
  inputField: {
    backgroundColor: '#161616',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#1E1E1E',
  },
  inputFieldActive: {
    borderColor: '#2A2A2A',
  },
  inputFieldText: {
    flex: 1,
    fontSize: 16,
    color: '#FFF',
  },
  placeholder: {
    color: '#555',
  },

  // Connecting line between pickup and dropoff
  routeLine: {
    width: 1,
    height: 20,
    backgroundColor: '#2A2A2A',
    marginLeft: 21,
    marginVertical: 2,
  },

  // Fare row
  fareRow: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#1E1E1E',
    gap: 4,
  },
  fareTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fareLabel: {
    color: '#888',
    fontSize: 13,
  },
  fareAmount: {
    color: '#F5A623',
    fontSize: 18,
    fontWeight: '700',
  },
  fareNote: {
    color: '#555',
    fontSize: 12,
  },

  // Request button
  requestButton: {
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  requestButtonDisabled: {
    opacity: 0.35,
  },
  requestButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 17,
  },

  // Status / active trip panel
  statusSheet: {
    paddingVertical: 8,
    gap: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusSpinner: {
    // ActivityIndicator has its own sizing
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFF',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#2A2A2A',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '500',
  },

  // Driver marker on map
  driverMarker: {
    backgroundColor: '#F5A623',
    borderRadius: 20,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
});
