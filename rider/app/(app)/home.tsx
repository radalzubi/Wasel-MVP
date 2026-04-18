import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Keyboard, Platform,
  Modal, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// Amman city centre — default when GPS is unavailable or outside Jordan
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

// Jordan bounding box — GPS outside this range falls back to Amman
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

// Uber-style search state machine:
//   idle      → small "Where to?" pill visible
//   open      → full-screen search modal
//   confirmed → route + fare + request button panel
type SearchMode = 'idle' | 'open' | 'confirmed';

interface LatLng { latitude: number; longitude: number; }
interface PlaceSuggestion { place_id: string; display_name: string; lat: string; lon: string; }
interface RiderProfile { is_waitlist_member?: boolean; }

export default function HomeScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const mapRef = useRef<MapView>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destInputRef = useRef<TextInput>(null);
  const pickupInputRef = useRef<TextInput>(null);

  // ── Location ──────────────────────────────────────────────────────────
  const [location, setLocation] = useState<LatLng | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<LatLng | null>(null);

  // ── Search flow ───────────────────────────────────────────────────────
  const [searchMode, setSearchMode] = useState<SearchMode>('idle');
  const [editingField, setEditingField] = useState<'pickup' | 'destination'>('destination');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // ── Trip state ────────────────────────────────────────────────────────
  const [tripStatus, setTripStatus] = useState<TripStatus>('idle');
  const [tripId, setTripId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [driverLocation, setDriverLocation] = useState<LatLng | null>(null);
  const [fare, setFare] = useState<string | null>(null);

  // ── Profile ───────────────────────────────────────────────────────────
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);

  const { destName, destLat, destLng } = useLocalSearchParams<{
    destName?: string;
    destLat?: string;
    destLng?: string;
  }>();
  const consumedExploreParams = useRef(false);

  // Apply destination forwarded from the Explore tab ("Ride here" button)
  useFocusEffect(
    useCallback(() => {
      if (consumedExploreParams.current) return;
      if (!destName || !destLat || !destLng) return;
      consumedExploreParams.current = true;
      const coords = { latitude: parseFloat(destLat as string), longitude: parseFloat(destLng as string) };
      const label = destName as string;
      setDropoff(label);
      setDropoffCoords(coords);
      setSuggestions([]);
      if (pickupCoords) {
        const dist = haversineKm(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
        setTimeout(() => {
          mapRef.current?.fitToCoordinates([pickupCoords, coords], {
            edgePadding: { top: 120, right: 60, bottom: 320, left: 60 },
            animated: true,
          });
        }, 50);
      }
      setSearchMode('confirmed');
    }, [destName, destLat, destLng, pickupCoords]),
  );

  // ── Get user location on mount ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { defaultToAmman(); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        if (inJordan(latitude, longitude)) {
          const coords = { latitude, longitude };
          setLocation(coords);
          setPickupCoords(coords);
          setPickup(t('currentLocation'));
          mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
        } else {
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

  // ── Rider profile ─────────────────────────────────────────────────────
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

  // ── Trip Realtime subscription ────────────────────────────────────────
  useEffect(() => {
    if (!tripId) return;
    const ch = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'trips',
        filter: `id=eq.${tripId}`,
      }, (payload) => {
        const st = payload.new.status as TripStatus;
        const did = payload.new.driver_id as string | null;
        setTripStatus(st);
        if (did) setDriverId(did);
        if (st === 'completed') {
          setTimeout(resetTripState, 3000);
        } else if (st === 'cancelled') {
          // Show "Trip cancelled" briefly then return to idle
          setTimeout(resetTripState, 1500);
        }
      })
      .subscribe(async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          if (!token) return;
          const res = await fetch(`${API_URL}/api/trips/${tripId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status && data.status !== 'requested') setTripStatus(data.status as TripStatus);
            if (data.driver_id) setDriverId(data.driver_id);
          }
        } catch { /* non-fatal */ }
      });
    return () => { supabase.removeChannel(ch); };
  }, [tripId]);

  // ── Live driver location subscription ────────────────────────────────
  useEffect(() => {
    if (!driverId) return;
    if (['idle', 'searching', 'completed', 'cancelled'].includes(tripStatus)) return;
    const ch = supabase
      .channel(`driver-loc-${driverId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'drivers',
        filter: `id=eq.${driverId}`,
      }, (payload) => {
        const lat = payload.new.location_lat as number | null;
        const lng = payload.new.location_lng as number | null;
        if (lat != null && lng != null) setDriverLocation({ latitude: lat, longitude: lng });
      })
      .subscribe(async () => {
        try {
          const { data } = await supabase
            .from('drivers').select('location_lat, location_lng')
            .eq('id', driverId).single();
          if (data?.location_lat != null && data?.location_lng != null) {
            setDriverLocation({ latitude: data.location_lat, longitude: data.location_lng });
          }
        } catch { /* non-fatal */ }
      });
    return () => { supabase.removeChannel(ch); };
  }, [driverId, tripStatus]);

  // ── Auto-focus the right input when modal opens ───────────────────────
  useEffect(() => {
    if (searchMode !== 'open') return;
    const timer = setTimeout(() => {
      if (editingField === 'destination') destInputRef.current?.focus();
      else pickupInputRef.current?.focus();
    }, 160);
    return () => clearTimeout(timer);
  }, [searchMode, editingField]);

  // ── Nominatim autocomplete ────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 2) { setSuggestions([]); return; }
    setLoadingSuggestions(true);
    try {
      const q = encodeURIComponent(query);
      // viewbox biases toward Jordan but bounded=0 allows global results
      const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=8&viewbox=34.9,29.1,39.3,33.4&bounded=0&accept-language=en&addressdetails=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'WaselApp/1.0' } });
      setSuggestions(await res.json());
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  function triggerSearch(text: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(text), 400);
  }

  // ── Search flow actions ───────────────────────────────────────────────
  function openSearch(field: 'pickup' | 'destination' = 'destination') {
    setSuggestions([]);
    setEditingField(field);
    setSearchMode('open');
  }

  function closeSearch() {
    Keyboard.dismiss();
    setSuggestions([]);
    // Restore pickup label if user cleared it in the modal but didn't pick a new location
    if (!pickup.trim() && pickupCoords) {
      setPickup('Amman, Jordan');
    }
    setSearchMode(dropoffCoords ? 'confirmed' : 'idle');
  }

  function handleSelectSuggestion(place: PlaceSuggestion) {
    const coords = { latitude: parseFloat(place.lat), longitude: parseFloat(place.lon) };
    const parts = place.display_name.split(', ');
    const label = parts.slice(0, 3).join(', ');

    if (editingField === 'destination') {
      setDropoff(label);
      setDropoffCoords(coords);
      setSuggestions([]);
      Keyboard.dismiss();
      setSearchMode('confirmed');
      if (pickupCoords) {
        const dist = haversineKm(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
        setTimeout(() => {
          mapRef.current?.fitToCoordinates([pickupCoords, coords], {
            edgePadding: { top: 120, right: 60, bottom: 320, left: 60 },
            animated: true,
          });
        }, 50);
      }
    } else {
      // Editing pickup — after selecting, move focus to destination
      setPickup(label);
      setPickupCoords(coords);
      setSuggestions([]);
      setEditingField('destination');
      setTimeout(() => destInputRef.current?.focus(), 80);
    }
  }

  function handleUseCurrentLocation() {
    const coords = location || AMMAN;
    const label = location ? t('currentLocation') : 'Amman, Jordan';
    if (editingField === 'pickup') {
      setPickup(label);
      setPickupCoords(coords);
      setSuggestions([]);
      setEditingField('destination');
      setTimeout(() => destInputRef.current?.focus(), 80);
    } else {
      setDropoff(label);
      setDropoffCoords(coords);
      setSuggestions([]);
      Keyboard.dismiss();
      setSearchMode('confirmed');
      if (pickupCoords) {
        const dist = haversineKm(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
      }
    }
  }

  // ── Request ride ──────────────────────────────────────────────────────
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

  // ── Cancel trip ───────────────────────────────────────────────────────
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
    setSearchMode('idle');
  }

  // ── Derived state ─────────────────────────────────────────────────────
  const statusLabel: Record<TripStatus, string> = {
    idle: '',
    searching: t('findingDrivers'),
    dispatching: t('contactingDriver'),
    accepted: t('driverAccepted'),
    en_route: t('driverOnWay'),
    arrived: t('driverArrived'),
    in_progress: t('tripInProgress'),
    completed: t('tripComplete'),
    cancelled: 'Trip cancelled',
  };

  const isActiveTrip = tripStatus !== 'idle';
  const isSearching = tripStatus === 'searching' || tripStatus === 'dispatching';
  const showUserLocation = location != null && inJordan(location.latitude, location.longitude);
  const activeQueryText = editingField === 'destination' ? dropoff : pickup;

  // ─────────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* ── Map — always fills the screen behind all panels ─────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation={showUserLocation}
        showsMyLocationButton={false}
      >
        {pickupCoords && <Marker coordinate={pickupCoords} title="Pickup" pinColor="#F5A623" />}
        {dropoffCoords && <Marker coordinate={dropoffCoords} title="Dropoff" pinColor="#4CAF50" />}
        {driverLocation && (
          <Marker coordinate={driverLocation} title="Driver">
            <View style={s.driverMarker}>
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

      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <SafeAreaView style={s.topBar} edges={['top']}>
        <View style={s.topBarInner}>
          <Text style={s.topLogo}>Wasel</Text>
          {riderProfile?.is_waitlist_member && (
            <View style={s.earlyBadge}>
              <Ionicons name="star" size={10} color="#F5A623" />
              <Text style={s.earlyBadgeText}>{t('earlyMember')}</Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* ── IDLE: compact "Where to?" pill ────────────────────────────── */}
      {!isActiveTrip && searchMode === 'idle' && (
        <View style={s.idleWrap}>
          <SafeAreaView edges={['bottom']}>
            <TouchableOpacity
              style={s.whereToCard}
              onPress={() => openSearch('destination')}
              activeOpacity={0.88}
            >
              <View style={s.whereToLeft}>
                <View style={s.searchIconCircle}>
                  <Ionicons name="search" size={16} color="#111" />
                </View>
                <Text style={s.whereToText}>{t('whereTo')}</Text>
              </View>
              {pickup ? (
                <View style={s.pickupChip}>
                  <View style={s.pickupDot} />
                  <Text style={s.pickupChipText} numberOfLines={1}>{pickup}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      )}

      {/* ── CONFIRMED: route summary + fare + request ──────────────────── */}
      {!isActiveTrip && searchMode === 'confirmed' && (
        <View style={s.sheetWrap}>
          <SafeAreaView edges={['bottom']}>
            <View style={s.sheet}>
              <View style={s.sheetHandle} />

              {/* Route card — each row tappable to re-open search */}
              <View style={s.routeCard}>
                <TouchableOpacity
                  style={s.routeRow}
                  onPress={() => openSearch('pickup')}
                  activeOpacity={0.7}
                >
                  <View style={s.pipPickup} />
                  <View style={s.routeTextBlock}>
                    <Text style={s.routeRowLabel}>Pickup</Text>
                    <Text style={s.routeRowValue} numberOfLines={1}>{pickup || 'Set pickup'}</Text>
                  </View>
                  <Ionicons name="pencil-outline" size={14} color="#3A3A3A" />
                </TouchableOpacity>

                <View style={s.routeCardSep}>
                  <View style={s.routeCardLine} />
                </View>

                <TouchableOpacity
                  style={s.routeRow}
                  onPress={() => openSearch('destination')}
                  activeOpacity={0.7}
                >
                  <View style={s.pipDropoff} />
                  <View style={s.routeTextBlock}>
                    <Text style={s.routeRowLabel}>Dropoff</Text>
                    <Text style={s.routeRowValue} numberOfLines={1}>{dropoff}</Text>
                  </View>
                  <Ionicons name="pencil-outline" size={14} color="#3A3A3A" />
                </TouchableOpacity>
              </View>

              {/* Fare */}
              {fare && (
                <View style={s.fareRow}>
                  <View>
                    <Text style={s.fareLabel}>{t('estimatedFare')}</Text>
                    <Text style={s.fareNote}>{t('cashPayment')}</Text>
                  </View>
                  <Text style={s.fareAmount}>{fare} JD</Text>
                </View>
              )}

              <TouchableOpacity style={s.requestBtn} onPress={handleRequestRide} activeOpacity={0.85}>
                <Text style={s.requestBtnText}>{t('requestWasel')}</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      )}

      {/* ── ACTIVE TRIP panel ─────────────────────────────────────────── */}
      {isActiveTrip && (
        <View style={s.sheetWrap}>
          <SafeAreaView edges={['bottom']}>
            <View style={s.sheet}>
              <View style={s.sheetHandle} />

              <View style={s.statusRow}>
                {isSearching
                  ? <ActivityIndicator color="#F5A623" size="small" style={{ marginRight: 10 }} />
                  : <View style={s.statusDot} />
                }
                <Text style={s.statusLabel}>{statusLabel[tripStatus]}</Text>
              </View>

              {/* Compact route */}
              <View style={s.activeRouteCard}>
                <View style={s.activeRoutePips}>
                  <View style={s.pipPickup} />
                  <View style={s.activeRouteConnector} />
                  <View style={s.pipDropoff} />
                </View>
                <View style={{ flex: 1, gap: 8 }}>
                  <Text style={s.activeRouteText} numberOfLines={1}>{pickup}</Text>
                  <Text style={s.activeRouteText} numberOfLines={1}>{dropoff}</Text>
                </View>
              </View>

              {fare && (
                <View style={s.activeFareRow}>
                  <Text style={s.activeFareLabel}>{t('estimatedFare')}</Text>
                  <Text style={s.activeFareAmount}>{fare} JD</Text>
                </View>
              )}

              {tripStatus !== 'completed' && tripStatus !== 'in_progress' && tripStatus !== 'cancelled' && (
                <TouchableOpacity style={s.cancelBtn} onPress={handleCancelTrip} activeOpacity={0.75}>
                  <Text style={s.cancelBtnText}>{t('cancel')}</Text>
                </TouchableOpacity>
              )}
            </View>
          </SafeAreaView>
        </View>
      )}

      {/* ── SEARCH MODAL — slides up full-screen ──────────────────────── */}
      <Modal
        visible={searchMode === 'open'}
        animationType="slide"
        onRequestClose={closeSearch}
        statusBarTranslucent={false}
      >
        <View style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
        <KeyboardAvoidingView
          style={s.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: '#0A0A0A' }} edges={['top', 'bottom']}>

            {/* Header */}
            <View style={s.modalHeader}>
              <TouchableOpacity
                onPress={closeSearch}
                style={s.backBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="arrow-back" size={22} color="#FFF" />
              </TouchableOpacity>
              <Text style={s.modalTitle}>Plan your ride</Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Input card */}
            <View style={s.modalInputCard}>

              {/* Pickup row */}
              <TouchableOpacity
                style={[s.modalInputRow, editingField === 'pickup' && s.modalInputRowActive]}
                onPress={() => { setEditingField('pickup'); pickupInputRef.current?.focus(); }}
                activeOpacity={1}
              >
                <View style={s.pipPickup} />
                <TextInput
                  ref={pickupInputRef}
                  style={s.modalInput}
                  placeholder="Pickup location"
                  placeholderTextColor="#444"
                  value={pickup}
                  onChangeText={(text) => {
                    setPickup(text);
                    if (pickupCoords) setPickupCoords(null);
                    triggerSearch(text);
                  }}
                  onFocus={() => {
                    setEditingField('pickup');
                    setSuggestions([]);
                    // Clear auto-set labels so the user starts fresh
                    if (pickup === 'Amman, Jordan' || pickup === t('currentLocation')) {
                      setPickup('');
                    }
                  }}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => {
                    setEditingField('destination');
                    destInputRef.current?.focus();
                  }}
                />
                {editingField === 'pickup' && pickup.length > 0 && (
                  <TouchableOpacity onPress={() => { setPickup(''); setPickupCoords(null); setSuggestions([]); }}>
                    <Ionicons name="close-circle" size={18} color="#444" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              <View style={s.modalInputDivider} />

              {/* Destination row */}
              <TouchableOpacity
                style={[s.modalInputRow, editingField === 'destination' && s.modalInputRowActive]}
                onPress={() => { setEditingField('destination'); destInputRef.current?.focus(); }}
                activeOpacity={1}
              >
                <View style={s.pipDropoff} />
                <TextInput
                  ref={destInputRef}
                  style={s.modalInput}
                  placeholder="Where to?"
                  placeholderTextColor="#444"
                  value={dropoff}
                  onChangeText={(text) => {
                    setDropoff(text);
                    if (dropoffCoords) { setDropoffCoords(null); setFare(null); }
                    triggerSearch(text);
                  }}
                  onFocus={() => {
                    setEditingField('destination');
                    setSuggestions([]);
                  }}
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {editingField === 'destination' && dropoff.length > 0 && (
                  <TouchableOpacity onPress={() => {
                    setDropoff(''); setDropoffCoords(null); setFare(null); setSuggestions([]);
                  }}>
                    <Ionicons name="close-circle" size={18} color="#444" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            </View>

            {/* Suggestions list */}
            <ScrollView
              style={s.suggList}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
            >
              {/* Always-visible "Use current location" option */}
              <TouchableOpacity style={s.suggRow} onPress={handleUseCurrentLocation}>
                <View style={s.suggIconCircle}>
                  <Ionicons name="locate" size={16} color="#F5A623" />
                </View>
                <View style={s.suggText}>
                  <Text style={s.suggMain}>{t('currentLocation')}</Text>
                  <Text style={s.suggSub}>Use your GPS location</Text>
                </View>
              </TouchableOpacity>

              {/* Divider after "current location" */}
              <View style={s.suggSectionDivider} />

              {loadingSuggestions && (
                <View style={s.loadingRow}>
                  <ActivityIndicator size="small" color="#F5A623" />
                </View>
              )}

              {!loadingSuggestions && suggestions.map((item, idx) => {
                const parts = item.display_name.split(', ');
                const main = parts[0];
                const sub = parts.slice(1, 3).join(', ');
                return (
                  <TouchableOpacity
                    key={item.place_id}
                    style={[s.suggRow, idx < suggestions.length - 1 && s.suggBorder]}
                    onPress={() => handleSelectSuggestion(item)}
                  >
                    <View style={s.suggIconCircle}>
                      <Ionicons name="location-outline" size={16} color="#666" />
                    </View>
                    <View style={s.suggText}>
                      <Text style={s.suggMain} numberOfLines={1}>{main}</Text>
                      {sub ? <Text style={s.suggSub} numberOfLines={1}>{sub}</Text> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {!loadingSuggestions && suggestions.length === 0 && activeQueryText.length >= 2 && (
                <View style={s.emptyState}>
                  <Ionicons name="search-outline" size={30} color="#2A2A2A" style={{ marginBottom: 8 }} />
                  <Text style={s.emptyStateText}>No results found</Text>
                  <Text style={s.emptyStateSub}>Try a different search</Text>
                </View>
              )}
            </ScrollView>

          </SafeAreaView>
        </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  // Top bar
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarInner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.85)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: '#1A1A1A',
    alignSelf: 'flex-start',
  },
  topLogo: { fontSize: 22, fontWeight: '700', color: '#F5A623' },
  earlyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,166,35,0.12)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)',
  },
  earlyBadgeText: { color: '#F5A623', fontSize: 10, fontWeight: '600' },

  // Idle "Where to?" card
  idleWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  whereToCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  whereToLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchIconCircle: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: '#F0F0F0', alignItems: 'center', justifyContent: 'center',
  },
  whereToText: { fontSize: 17, fontWeight: '600', color: '#111' },
  pickupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#F5F5F5', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5, maxWidth: 130,
  },
  pickupDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F5A623', flexShrink: 0 },
  pickupChipText: { fontSize: 12, color: '#555', fontWeight: '500', flex: 1 },

  // Bottom sheet — shared by confirm + active trip
  sheetWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 14,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: '#252525',
    borderRadius: 2, alignSelf: 'center', marginBottom: 2,
  },

  // Route card (confirmed state)
  routeCard: {
    backgroundColor: '#161616', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', overflow: 'hidden',
  },
  routeRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 13, gap: 12,
  },
  routeTextBlock: { flex: 1 },
  routeRowLabel: {
    fontSize: 10, color: '#555', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2,
  },
  routeRowValue: { fontSize: 14, color: '#EEE', fontWeight: '500' },
  routeCardSep: {
    // 14px card padding + 6px = centre of the 12px pip dot
    paddingLeft: 19,
    height: 14,
    justifyContent: 'center',
  },
  routeCardLine: { width: 2, height: '100%', backgroundColor: '#2A2A2A', borderRadius: 1 },

  // Pip dots
  pipPickup: {
    width: 12, height: 12, borderRadius: 6, flexShrink: 0,
    backgroundColor: '#F5A623',
  },
  pipDropoff: {
    width: 12, height: 12, borderRadius: 3, flexShrink: 0,
    backgroundColor: '#4CAF50',
  },

  // Fare row
  fareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  fareLabel: { color: '#888', fontSize: 12, marginBottom: 2 },
  fareNote: { color: '#444', fontSize: 11 },
  fareAmount: { color: '#F5A623', fontSize: 26, fontWeight: '700' },

  // Request button
  requestBtn: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 17, alignItems: 'center',
  },
  requestBtnText: { color: '#000', fontWeight: '700', fontSize: 17 },

  // Active trip
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#4CAF50', marginRight: 10,
  },
  statusLabel: { fontSize: 17, fontWeight: '700', color: '#FFF', flex: 1 },
  activeRouteCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  activeRoutePips: { alignItems: 'center', gap: 0 },
  activeRouteConnector: { width: 1, height: 18, backgroundColor: '#2A2A2A', marginVertical: 3 },
  activeRouteText: { fontSize: 13, color: '#AAA' },
  activeFareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  activeFareLabel: { color: '#888', fontSize: 13 },
  activeFareAmount: { color: '#F5A623', fontSize: 18, fontWeight: '700' },
  cancelBtn: {
    borderWidth: 1, borderColor: '#222', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  cancelBtnText: { color: '#777', fontSize: 15, fontWeight: '500' },

  // Driver marker on map
  driverMarker: {
    backgroundColor: '#F5A623', borderRadius: 20,
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },

  // ── Search modal ──────────────────────────────────────────────────────
  modalContainer: { flex: 1, backgroundColor: '#0A0A0A' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#141414',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#161616', alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: '#DDD' },

  modalInputCard: {
    backgroundColor: '#111', marginHorizontal: 16, marginTop: 14,
    borderRadius: 16, borderWidth: 1, borderColor: '#1A1A1A', overflow: 'hidden',
  },
  modalInputRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 15, gap: 12,
  },
  modalInputRowActive: { backgroundColor: 'rgba(245,166,35,0.03)' },
  modalInput: { flex: 1, fontSize: 16, color: '#FFF', paddingVertical: 0 },
  modalInputDivider: { height: 1, backgroundColor: '#161616', marginLeft: 40 },

  // Suggestions
  suggList: { flex: 1, marginTop: 6 },
  suggSectionDivider: { height: 1, backgroundColor: '#141414', marginHorizontal: 16, marginBottom: 4 },
  suggRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  suggBorder: { borderBottomWidth: 1, borderBottomColor: '#141414' },
  suggIconCircle: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#151515', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  suggText: { flex: 1 },
  suggMain: { fontSize: 15, color: '#FFF', fontWeight: '500' },
  suggSub: { fontSize: 13, color: '#555', marginTop: 2 },
  loadingRow: { padding: 24, alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyStateText: { color: '#444', fontSize: 15, fontWeight: '500', marginBottom: 4 },
  emptyStateSub: { color: '#2A2A2A', fontSize: 13 },
});
