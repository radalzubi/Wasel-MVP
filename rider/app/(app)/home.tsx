import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Keyboard, FlatList, Platform,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Amman city centre — default for users outside Jordan or without GPS
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

// Jordan bounding box.  Locations outside this range are assumed to be
// testing from abroad; we fall back to Amman so ordering still works.
const JORDAN = { minLat: 29.1, maxLat: 33.4, minLng: 34.9, maxLng: 39.3 };
function inJordan(lat: number, lng: number) {
  return lat >= JORDAN.minLat && lat <= JORDAN.maxLat &&
         lng >= JORDAN.minLng && lng <= JORDAN.maxLng;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type TripStatus =
  | 'idle' | 'searching' | 'dispatching'
  | 'accepted' | 'en_route' | 'arrived'
  | 'in_progress' | 'completed' | 'cancelled';

interface LatLng { latitude: number; longitude: number; }

interface PlaceSuggestion {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
}

interface RiderProfile { is_waitlist_member?: boolean; }

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Location / coordinates
  const [location, setLocation] = useState<LatLng | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<LatLng | null>(null);

  // Trip state
  const [tripStatus, setTripStatus] = useState<TripStatus>('idle');
  const [tripId, setTripId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(null);
  const [fare, setFare] = useState<string | null>(null);

  // Search UI
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Profile
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);

  // ── Get user location on mount ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          defaultToAmman();
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;

        if (inJordan(latitude, longitude)) {
          const coords = { latitude, longitude };
          setLocation(coords);
          setPickupCoords(coords);
          setPickup(t('currentLocation'));
          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
        } else {
          // User is outside Jordan (e.g. testing from abroad) — pretend Amman
          defaultToAmman();
        }
      } catch {
        defaultToAmman();
      }
    })();
  }, []);

  function defaultToAmman() {
    setPickupCoords(AMMAN);
    setPickup('Amman, Jordan');
    mapRef.current?.animateToRegion({ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
  }

  // ── Fetch rider profile ─────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch(`${API_URL}/api/riders/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setRiderProfile(await res.json());
      } catch { /* non-fatal */ }
    })();
  }, [user]);

  // ── Trip Realtime subscription ─────────────────────────────────────────
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
        const newDriverId = payload.new.driver_id as string | null;
        setTripStatus(newStatus);
        if (newDriverId) setDriverId(newDriverId);
        if (newStatus === 'completed' || newStatus === 'cancelled') {
          setTimeout(() => resetTripState(), 3000);
        }
      })
      .subscribe(async () => {
        // Poll for missed updates during subscription setup window
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return;
          const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status && data.status !== 'requested') {
              setTripStatus(data.status as TripStatus);
            }
            if (data.driver_id) setDriverId(data.driver_id);
          }
        } catch { /* non-fatal */ }
      });

    return () => { supabase.removeChannel(channel); };
  }, [tripId]);

  // ── Live driver location subscription ──────────────────────────────────
  useEffect(() => {
    if (!driverId) return;
    // Only subscribe when there's an active trip with the driver
    const inactive = ['idle', 'searching', 'completed', 'cancelled'];
    if (inactive.includes(tripStatus)) return;

    const channel = supabase
      .channel(`driver-loc-${driverId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'drivers',
        filter: `id=eq.${driverId}`,
      }, (payload) => {
        const lat = payload.new.location_lat as number | null;
        const lng = payload.new.location_lng as number | null;
        if (lat != null && lng != null) {
          setDriverLocation({ latitude: lat, longitude: lng });
        }
      })
      .subscribe(async () => {
        // Fetch current driver location immediately on subscribe
        try {
          const { data } = await supabase
            .from('drivers')
            .select('location_lat, location_lng')
            .eq('id', driverId)
            .single();
          if (data?.location_lat != null && data?.location_lng != null) {
            setDriverLocation({ latitude: data.location_lat, longitude: data.location_lng });
          }
        } catch { /* non-fatal */ }
      });

    return () => { supabase.removeChannel(channel); };
  }, [driverId, tripStatus]);

  // ── Destination autocomplete via Nominatim ─────────────────────────────
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return; }
    setLoadingSuggestions(true);
    try {
      const q = encodeURIComponent(`${query} Jordan`);
      const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&countrycodes=jo&accept-language=en`;
      const res = await fetch(url, { headers: { 'User-Agent': 'WaselApp/1.0' } });
      const data: PlaceSuggestion[] = await res.json();
      setSuggestions(data);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  function handleDropoffChange(text: string) {
    setDropoff(text);
    if (dropoffCoords) { setDropoffCoords(null); setFare(null); }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(text), 400);
  }

  function handleSelectSuggestion(place: PlaceSuggestion) {
    const coords = { latitude: parseFloat(place.lat), longitude: parseFloat(place.lon) };
    const parts = place.display_name.split(', ');
    const label = parts.slice(0, 3).join(', ');

    setDropoff(label);
    setDropoffCoords(coords);
    setSuggestions([]);
    setIsSearchActive(false);
    Keyboard.dismiss();

    if (pickupCoords) {
      const dist = haversineKm(pickupCoords.latitude, pickupCoords.longitude, coords.latitude, coords.longitude);
      setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
      mapRef.current?.fitToCoordinates([pickupCoords, coords], {
        edgePadding: { top: 120, right: 60, bottom: 340, left: 60 },
        animated: true,
      });
    } else {
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);
    }
  }

  // Map tap — also sets dropoff (fallback / precision mode)
  function handleMapPress(e: { nativeEvent: { coordinate: LatLng } }) {
    if (isSearchActive || tripStatus !== 'idle') return;
    const coord = e.nativeEvent.coordinate;
    setDropoffCoords(coord);
    setDropoff(`${coord.latitude.toFixed(4)}, ${coord.longitude.toFixed(4)}`);
    setSuggestions([]);

    if (pickupCoords) {
      const dist = haversineKm(pickupCoords.latitude, pickupCoords.longitude, coord.latitude, coord.longitude);
      setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
    }
  }

  // ── Request ride ────────────────────────────────────────────────────────
  async function handleRequestRide() {
    if (!pickupCoords || !dropoffCoords) {
      Alert.alert(t('setPickupDropoff'), t('tapMapDest2'));
      return;
    }
    setTripStatus('searching');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`${API_URL}/api/trips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    } catch {
      Alert.alert(t('error'), t('somethingWrong'));
      setTripStatus('idle');
    }
  }

  // ── Cancel trip ─────────────────────────────────────────────────────────
  async function handleCancelTrip() {
    if (tripId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          await fetch(`${API_URL}/api/trips/${tripId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: 'cancelled' }),
          });
        }
      } catch { /* UI resets regardless */ }
    }
    resetTripState();
  }

  function resetTripState() {
    setTripStatus('idle');
    setTripId(null);
    setDriverId(null);
    setDriverLocation(null);
    setDropoff('');
    setDropoffCoords(null);
    setFare(null);
    setSuggestions([]);
    setIsSearchActive(false);
  }

  // ── Derived state ───────────────────────────────────────────────────────
  const statusLabel: Record<TripStatus, string> = {
    idle: '', searching: t('findingDrivers'), dispatching: t('contactingDriver'),
    accepted: t('driverAccepted'), en_route: t('driverOnWay'),
    arrived: t('driverArrived'), in_progress: t('tripInProgress'),
    completed: t('tripComplete'), cancelled: 'Trip cancelled',
  };

  const isActiveTrip = tripStatus !== 'idle';
  const isSearching = tripStatus === 'searching' || tripStatus === 'dispatching';
  const showUserLocation = location != null && inJordan(location.latitude, location.longitude);

  return (
    <View style={styles.container}>
      {/* Map ─────────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        onPress={handleMapPress}
        showsUserLocation={showUserLocation}
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

      {/* Top bar ─────────────────────────────────────────────────────── */}
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

      {/* Transparent spacer — passes map touch events through */}
      <View style={styles.mapSpacer} pointerEvents="none" />

      {/* Bottom booking panel ─────────────────────────────────────────── */}
      <View style={styles.bookingPanel}>
        <View style={styles.sheetHandle} />

        {!isActiveTrip ? (
          <>
            <Text style={styles.sheetTitle}>{t('whereTo')}</Text>

            {/* Pickup row (read-only display) */}
            <View style={styles.inputRow}>
              <Ionicons name="radio-button-on" size={16} color="#F5A623" />
              <Text style={[styles.inputDisplayText, !pickup && styles.placeholder]} numberOfLines={1}>
                {pickup || t('setPickup')}
              </Text>
            </View>

            <View style={styles.routeDivider} />

            {/* Dropoff row — editable TextInput */}
            <View style={[styles.inputRow, isSearchActive && styles.inputRowFocused]}>
              <Ionicons name="location" size={16} color="#4CAF50" />
              <TextInput
                style={styles.dropoffInput}
                placeholder={t('tapMapDest')}
                placeholderTextColor="#555"
                value={dropoff}
                onChangeText={handleDropoffChange}
                onFocus={() => {
                  setIsSearchActive(true);
                  // Clear coords so the user can type a new search
                  if (dropoffCoords) { setDropoffCoords(null); setFare(null); }
                }}
                onBlur={() => {
                  // Small delay so suggestion taps register before blur hides them
                  setTimeout(() => {
                    setIsSearchActive(false);
                    setSuggestions([]);
                  }, 200);
                }}
                returnKeyType="search"
                autoCorrect={false}
              />
              {dropoff.length > 0 && (
                <TouchableOpacity onPress={() => {
                  setDropoff(''); setDropoffCoords(null); setFare(null); setSuggestions([]);
                }}>
                  <Ionicons name="close-circle" size={18} color="#444" />
                </TouchableOpacity>
              )}
            </View>

            {/* Autocomplete suggestions */}
            {isSearchActive && (suggestions.length > 0 || loadingSuggestions) && (
              <View style={styles.suggestionsBox}>
                {loadingSuggestions && suggestions.length === 0 ? (
                  <View style={styles.suggestionsLoading}>
                    <ActivityIndicator size="small" color="#F5A623" />
                  </View>
                ) : (
                  <FlatList
                    data={suggestions}
                    keyExtractor={(item) => item.place_id}
                    keyboardShouldPersistTaps="always"
                    scrollEnabled={false}
                    renderItem={({ item, index }) => {
                      const parts = item.display_name.split(', ');
                      const main = parts[0];
                      const sub = parts.slice(1, 3).join(', ');
                      const isLast = index === suggestions.length - 1;
                      return (
                        <TouchableOpacity
                          style={[styles.suggestionRow, !isLast && styles.suggestionRowBorder]}
                          onPress={() => handleSelectSuggestion(item)}
                        >
                          <Ionicons name="location-outline" size={16} color="#555" style={styles.suggestionIcon} />
                          <View style={styles.suggestionText}>
                            <Text style={styles.suggestionMain} numberOfLines={1}>{main}</Text>
                            {sub ? <Text style={styles.suggestionSub} numberOfLines={1}>{sub}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    }}
                  />
                )}
              </View>
            )}

            {/* Fare estimate */}
            {fare && dropoffCoords && !isSearchActive && (
              <View style={styles.fareRow}>
                <View>
                  <Text style={styles.fareLabel}>{t('estimatedFare')}</Text>
                  <Text style={styles.fareNote}>{t('cashPayment')}</Text>
                </View>
                <Text style={styles.fareAmount}>{fare} JD</Text>
              </View>
            )}

            {/* Request button */}
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
          /* Active trip panel */
          <View style={styles.statusSheet}>
            <View style={styles.statusRow}>
              {isSearching
                ? <ActivityIndicator color="#F5A623" />
                : <View style={[styles.statusDot, { backgroundColor: isSearching ? '#F5A623' : '#4CAF50' }]} />
              }
              <Text style={styles.statusLabel}>{statusLabel[tripStatus]}</Text>
            </View>

            {fare && (
              <View style={styles.activeFareRow}>
                <Text style={styles.activeFareLabel}>{t('estimatedFare')}</Text>
                <Text style={styles.activeFareAmount}>{fare} JD</Text>
              </View>
            )}

            {tripStatus !== 'completed' && tripStatus !== 'in_progress' && (
              <TouchableOpacity style={styles.cancelButton} onPress={handleCancelTrip} activeOpacity={0.75}>
                <Text style={styles.cancelButtonText}>{t('cancel')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={{ height: Platform.OS === 'ios' ? 20 : 8 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  // Top bar
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarInner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.82)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topLogo: { fontSize: 22, fontWeight: '700', color: '#F5A623' },
  earlyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,166,35,0.15)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)',
  },
  earlyBadgeText: { color: '#F5A623', fontSize: 10, fontWeight: '600' },

  mapSpacer: { flex: 1 },

  // Booking panel
  bookingPanel: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 12,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: '#2A2A2A',
    borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 12 },

  // Input rows
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  inputRowFocused: { borderColor: '#F5A623' },
  inputDisplayText: { flex: 1, fontSize: 15, color: '#FFF' },
  placeholder: { color: '#555' },
  dropoffInput: {
    flex: 1, fontSize: 15, color: '#FFF',
    paddingVertical: 0, // prevent extra Android padding
  },
  routeDivider: {
    width: 1, height: 16, backgroundColor: '#2A2A2A',
    marginLeft: 21, marginVertical: 3,
  },

  // Autocomplete suggestions
  suggestionsBox: {
    backgroundColor: '#161616', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
    marginTop: 4, maxHeight: 220, overflow: 'hidden',
  },
  suggestionsLoading: { padding: 16, alignItems: 'center' },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
  },
  suggestionRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  suggestionIcon: { marginRight: 10 },
  suggestionText: { flex: 1 },
  suggestionMain: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  suggestionSub: { color: '#666', fontSize: 12, marginTop: 2 },

  // Fare estimate
  fareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    marginTop: 10, borderWidth: 1, borderColor: '#1E1E1E',
  },
  fareLabel: { color: '#888', fontSize: 13, marginBottom: 2 },
  fareNote: { color: '#555', fontSize: 12 },
  fareAmount: { color: '#F5A623', fontSize: 22, fontWeight: '700' },

  // Request button
  requestButton: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 14,
  },
  requestButtonDisabled: { opacity: 0.35 },
  requestButtonText: { color: '#000', fontWeight: '700', fontSize: 17 },

  // Active trip panel
  statusSheet: { gap: 14, paddingVertical: 6 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 17, fontWeight: '700', color: '#FFF', flex: 1 },
  activeFareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  activeFareLabel: { color: '#888', fontSize: 13 },
  activeFareAmount: { color: '#F5A623', fontSize: 18, fontWeight: '700' },
  cancelButton: {
    borderWidth: 1, borderColor: '#2A2A2A', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelButtonText: { color: '#888', fontSize: 15, fontWeight: '500' },

  // Driver marker on map
  driverMarker: {
    backgroundColor: '#F5A623', borderRadius: 20,
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },
});
