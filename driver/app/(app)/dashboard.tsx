import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Vibration, Platform, Modal, Animated, Linking, ScrollView,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { DARK_MAP_STYLE } from '../../lib/mapStyle';
import * as Notifications from 'expo-notifications';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

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

// ── Types (module-level — not recreated on every render) ──────────────────────
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

interface RiderInfo { name: string; phone: string | null; }

interface TripDetails {
  pickup_address: string;
  dropoff_address: string;
  fare_amount: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
}

// ── Static lookup tables (module-level — never recreated) ─────────────────────
const TIER_META: Record<number, { label: string; color: string; text: string }> = {
  1: { label: 'Silver',   color: '#2A2A2A', text: '#AAA' },
  2: { label: 'Gold',     color: '#F5A623', text: '#000' },
  3: { label: 'Platinum', color: '#8B5CF6', text: '#FFF' },
};

const TRIP_ACTIONS: Record<string, { label: string; next: TripStatus }> = {
  accepted:    { label: 'Start Drive',      next: 'en_route'    },
  en_route:    { label: "I've Arrived",     next: 'arrived'     },
  arrived:     { label: 'Start Trip',       next: 'in_progress' },
  in_progress: { label: 'Complete Trip',    next: 'completed'   },
};

const TRIP_STATUS_LABEL: Record<string, string> = {
  accepted:    'Trip Accepted',
  en_route:    'Driving to Pickup',
  arrived:     'Arrived at Pickup',
  in_progress: 'Trip In Progress',
  completed:   'Trip Complete',
};

// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const mapRef = useRef<MapView>(null);
  const isMounted = useRef(true);

  const [isOnline, setIsOnline]               = useState(false);
  const [location, setLocation]               = useState<LatLng | null>(null);
  const [offer, setOffer]                     = useState<TripOffer | null>(null);
  const [offerTimer, setOfferTimer]           = useState(15);
  const [currentTrip, setCurrentTrip]         = useState<{ id: string; status: TripStatus } | null>(null);
  const currentTripRef = useRef<{ id: string; status: TripStatus } | null>(null);
  const [subscriptionTier, setSubscriptionTier] = useState<number>(1);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStars, setRatingStars]         = useState(0);
  const [ratingTripId, setRatingTripId]       = useState<string | null>(null);
  const [riderInfo, setRiderInfo]             = useState<RiderInfo | null>(null);
  const [tripDetails, setTripDetails]         = useState<TripDetails | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Prevents the Realtime trip-update channel from acting on CDC catchup
  // events (replayed while-offline events) immediately after a restore.
  const justRestoredRef = useRef(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Mark unmounted so async callbacks can bail out safely.
  // Also set up the Android notification channel on first mount.
  useEffect(() => {
    isMounted.current = true;

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('wasel-trips', {
        name: 'Wasel Trip Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    return () => { isMounted.current = false; };
  }, []);

  // Sign-out guard: when the user signs out, tear down all Realtime channels
  // and reset trip/online state so a new login session starts clean.
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    if (user) {
      wasSignedInRef.current = true;
    } else if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      supabase.removeAllChannels();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setCurrentTrip(null);
      setRiderInfo(null);
      setTripDetails(null);
      setOffer(null);
      setIsOnline(false);
    }
  }, [user]);

  // Keep currentTripRef in sync so the offer handler can check it synchronously
  // without depending on stale closure values.
  useEffect(() => { currentTripRef.current = currentTrip; }, [currentTrip]);

  // ── Session helper — one place to get the auth token ─────────────────────
  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  // ── Pulse animation for urgent offer timer ────────────────────────────────
  useEffect(() => {
    const isUrgent = offerTimer <= 5 && !!offer;
    if (isUrgent) {
      pulseLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 300, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 300, useNativeDriver: true }),
        ]),
      );
      pulseLoopRef.current.start();
    } else {
      pulseLoopRef.current?.stop();
      pulseAnim.setValue(1);
    }
    return () => { pulseLoopRef.current?.stop(); };
  }, [offerTimer, offer]);

  // ── Fetch driver profile (tier badge) ────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/drivers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && isMounted.current) {
          const data = await res.json();
          setSubscriptionTier(data.subscription_tier ?? 1);
        }
      } catch { /* non-fatal */ }
    })();
  }, [user, getToken]);

  // ── Restore active trip on mount (handles driver app restarts mid-trip) ──
  // Without this, a driver who kills and relaunches the app mid-trip sees the
  // offline screen with no active trip, leaving the rider permanently stranded.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_URL}/api/trips/driver-active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || !isMounted.current) return;
        const data = await res.json();
        if (!data?.id) return;
        // Block catchup CDC events for 3s so a replayed 'cancelled' event
        // from while the app was offline doesn't wipe the just-restored trip.
        justRestoredRef.current = true;
        setTimeout(() => { justRestoredRef.current = false; }, 3000);
        setIsOnline(true);
        setCurrentTrip({ id: data.id, status: data.status as TripStatus });
      } catch { /* non-fatal: don't block the dashboard */ }
    })();
  }, [user, getToken]);

  // ── Initial location on mount ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted.current) return;
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
        mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 800);
      } catch { /* location unavailable */ }
    })();
  }, []);

  // ── Continuous location updates while online (watchPosition = no manual polling) ──
  useEffect(() => {
    if (!isOnline) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      // Request foreground permission first (required on iOS before background).
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus !== 'granted') {
        console.warn('[location] foreground permission denied');
        return;
      }

      // Request background permission ("Always Allow" on iOS, foreground service on Android).
      await Location.requestBackgroundPermissionsAsync();
      // Don't abort if denied — degraded foreground-only mode is still functional.

      if (cancelled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 10_000,
          distanceInterval: 30,
        },
        async (loc) => {
          if (cancelled) return;
          const { latitude: lat, longitude: lng } = loc.coords;
          setLocation({ latitude: lat, longitude: lng });

          try {
            const session = await supabase.auth.getSession();
            const token = session.data.session?.access_token;
            if (!token) return;
            await fetch(`${API_URL}/api/drivers/location`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ lat, lng }),
            });
          } catch (err) {
            console.warn('[location] PATCH failed:', err);
          }
        },
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [isOnline]);

  // ── Fetch trip details + rider contact when trip accepted ─────────────────
  useEffect(() => {
    if (!currentTrip) {
      setRiderInfo(null);
      setTripDetails(null);
      return;
    }
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const tripRes = await fetch(`${API_URL}/api/trips/${currentTrip.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (tripRes.ok && isMounted.current) {
          const d = await tripRes.json();
          setTripDetails({
            pickup_address:  d.pickup_address  ?? 'Pickup location',
            dropoff_address: d.dropoff_address ?? 'Dropoff location',
            fare_amount:     d.fare_amount != null ? `${d.fare_amount} JD` : '',
            pickup_lat:  d.pickup_lat,
            pickup_lng:  d.pickup_lng,
            dropoff_lat: d.dropoff_lat,
            dropoff_lng: d.dropoff_lng,
          });
          if (d.pickup_lat != null && d.pickup_lng != null) {
            const pickupCoord = { latitude: d.pickup_lat, longitude: d.pickup_lng };
            const points = location ? [location, pickupCoord] : [pickupCoord];
            setTimeout(() => {
              if (!isMounted.current) return;
              mapRef.current?.fitToCoordinates(points, {
                edgePadding: { top: 100, right: 60, bottom: 320, left: 60 },
                animated: true,
              });
            }, 300);
          }
        }

        const contactRes = await fetch(`${API_URL}/api/trips/${currentTrip.id}/contact`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (contactRes.ok && isMounted.current) {
          const c = await contactRes.json();
          if (c.role === 'rider') {
            setRiderInfo({ name: c.name ?? 'Rider', phone: c.phone ?? null });
          }
        }
      } catch { /* non-fatal */ }
    })();
  }, [currentTrip?.id, getToken]);

  // ── Realtime: rider cancels active trip ───────────────────────────────────
  useEffect(() => {
    if (!currentTrip) return;
    const channel = supabase
      .channel(`trip-updates-${currentTrip.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'trips',
        filter: `id=eq.${currentTrip.id}`,
      }, (payload) => {
        try {
          if (!isMounted.current) return;
          const newStatus = (payload.new as { status?: string })?.status;
          if (newStatus === 'cancelled') {
            // Skip catchup events replayed immediately after a restore — these
            // are stale CDC events from when the app was offline, not new cancels.
            if (justRestoredRef.current) return;
            setCurrentTrip(null);
            setRiderInfo(null);
            setTripDetails(null);
            Alert.alert('Trip Cancelled', 'The rider has cancelled this trip.');
          }
        } catch { /* guard against malformed payload */ }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentTrip?.id]);

  // ── Realtime: incoming trip offers ───────────────────────────────────────
  // Dependency is user?.id (UUID string) not the user object — the user object
  // gets a new reference on every Supabase token refresh (~hourly), which would
  // tear down and recreate the channel and silently drop offers during the gap.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id; // stable local copy for the closure
    const channel = supabase
      .channel(`driver-offers-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'trip_offers',
        filter: `driver_id=eq.${userId}`,
      }, (payload) => {
        // Wrap the entire async handler — an unhandled rejection here crashes iOS
        (async () => {
          try {
            const offerData = payload.new;
            if (!offerData?.trip_id) return;

            const { data: trip } = await supabase
              .from('trips')
              .select('pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, fare_amount')
              .eq('id', offerData.trip_id)
              .single();

            // Don't show a new offer if driver is already on an active trip —
            // the backend should prevent this, but guard here for the race window.
            if (!trip || !isMounted.current || currentTripRef.current) return;

            try {
              Vibration.vibrate(Platform.OS === 'android' ? [0, 400, 200, 400] : 400);
            } catch { /* vibration unavailable on some devices */ }

            const distKm =
              trip.pickup_lat != null && trip.pickup_lng != null &&
              trip.dropoff_lat != null && trip.dropoff_lng != null
                ? haversineKm(trip.pickup_lat, trip.pickup_lng, trip.dropoff_lat, trip.dropoff_lng)
                : null;

            setOffer({
              id:               offerData.id,
              trip_id:          offerData.trip_id,
              pickup_address:   trip.pickup_address  || 'Pickup location',
              dropoff_address:  trip.dropoff_address || 'Dropoff location',
              pickup_lat:       trip.pickup_lat  ?? 0,
              pickup_lng:       trip.pickup_lng  ?? 0,
              fare_estimate:    trip.fare_amount ? `${trip.fare_amount} JD` : '~2-5 JD',
              distance_km:      distKm != null ? distKm.toFixed(1) : '—',
            });
            setOfferTimer(15);
          } catch (err) {
            console.error('[offers] realtime handler error:', err);
          }
        })();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  // ── Offer countdown timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!offer) return;

    timerRef.current = setInterval(() => {
      setOfferTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          // Use setTimeout to avoid calling setState inside a setState updater
          setTimeout(() => { if (isMounted.current) setOffer(null); }, 0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [offer]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function toggleOnline(value: boolean) {
    const prev = isOnline;
    setIsOnline(value);
    try {
      const token = await getToken();
      if (!token) { if (isMounted.current) setIsOnline(prev); return; }
      const res = await fetch(`${API_URL}/api/drivers/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_online: value, is_available: value }),
      });
      if (!res.ok) { if (isMounted.current) setIsOnline(prev); }
    } catch {
      if (isMounted.current) setIsOnline(prev);
    }
  }

  async function handleAccept() {
    if (!offer) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const acceptedOffer = offer;
    setOffer(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('No session');
      const res = await fetch(`${API_URL}/api/trips/${acceptedOffer.trip_id}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (isMounted.current) {
        setCurrentTrip({ id: acceptedOffer.trip_id, status: 'accepted' });
      }
    } catch {
      Alert.alert('Could not accept trip', 'The offer may have expired. Please try again.');
    }
  }

  async function handleDecline() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const declinedOffer = offer;
    setOffer(null);
    if (!declinedOffer) return;
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`${API_URL}/api/trips/${declinedOffer.trip_id}/decline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-fatal */ }
  }

  async function advanceTripStatus(nextStatus: string) {
    if (!currentTrip) return;
    // Snapshot the trip ID before any async gap
    const tripId = currentTrip.id;
    // Optimistic clear for cancel: hide the trip panel immediately rather than
    // waiting 1-2s for the network round-trip (gives instant UI feedback).
    if (nextStatus === 'cancelled') {
      setCurrentTrip(null);
      setRiderInfo(null);
      setTripDetails(null);
    }
    try {
      const token = await getToken();
      if (!token) throw new Error('No session');
      const res = await fetch(`${API_URL}/api/trips/${tripId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (!isMounted.current) return;
      if (nextStatus === 'completed') {
        setRatingTripId(tripId);
        setRatingStars(0);
        setShowRatingModal(true);
        setCurrentTrip(null);
        setRiderInfo(null);
        setTripDetails(null);
      } else if (nextStatus !== 'cancelled') {
        // Cancelled was already cleared optimistically above
        setCurrentTrip({ id: tripId, status: nextStatus as TripStatus });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      Alert.alert('Status update failed', msg);
    }
  }

  async function submitRating(stars: number) {
    setShowRatingModal(false);
    setRatingStars(0);
    const tripId = ratingTripId;
    setRatingTripId(null);
    if (stars > 0 && tripId) {
      try {
        const token = await getToken();
        if (!token) return;
        await fetch(`${API_URL}/api/trips/${tripId}/rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rating: stars, ratee: 'rider' }),
        });
      } catch { /* non-fatal */ }
    }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const tierBadge = TIER_META[subscriptionTier] ?? TIER_META[1];
  const isTimerUrgent = offerTimer <= 5;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation={false}
        customMapStyle={DARK_MAP_STYLE}
      >
        {location && (
          <Marker coordinate={location}>
            <View style={styles.driverMarker}><View style={styles.driverMarkerDot} /></View>
          </Marker>
        )}
        {tripDetails?.pickup_lat != null && (
          <Marker
            coordinate={{ latitude: tripDetails.pickup_lat, longitude: tripDetails.pickup_lng }}
            title="Pickup" pinColor="#F5A623"
          />
        )}
        {currentTrip?.status === 'in_progress' && tripDetails?.dropoff_lat != null && (
          <Marker
            coordinate={{ latitude: tripDetails.dropoff_lat, longitude: tripDetails.dropoff_lng }}
            title="Dropoff" pinColor="#4CAF50"
          />
        )}
        {location && tripDetails?.pickup_lat != null &&
          (currentTrip?.status === 'accepted' || currentTrip?.status === 'en_route') && (
          <Polyline
            coordinates={[location, { latitude: tripDetails.pickup_lat, longitude: tripDetails.pickup_lng }]}
            strokeColor="#F5A623" strokeWidth={3} lineDashPattern={[6, 3]}
          />
        )}
        {currentTrip?.status === 'in_progress' && tripDetails?.pickup_lat != null && tripDetails?.dropoff_lat != null && (
          <Polyline
            coordinates={[
              { latitude: tripDetails.pickup_lat,  longitude: tripDetails.pickup_lng },
              { latitude: tripDetails.dropoff_lat, longitude: tripDetails.dropoff_lng },
            ]}
            strokeColor="#4CAF50" strokeWidth={3} lineDashPattern={[8, 4]}
          />
        )}
      </MapView>

      {/* Top bar */}
      <SafeAreaView style={styles.topBar} edges={['top']}>
        <View style={styles.topBarInner}>
          <Text style={styles.topLogo}>وصل <Text style={styles.driverBadge}>Driver</Text></Text>
          <View style={[styles.tierBadge, { backgroundColor: tierBadge.color }]}>
            <Text style={[styles.tierBadgeText, { color: tierBadge.text }]}>{tierBadge.label}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* Bottom panel */}
      <View style={styles.bottomPanel}>
        {!currentTrip ? (
          /* ── Offline / Online idle state ── */
          <>
            {!isOnline ? (
              /* Offline — prominent Go Online CTA */
              <View style={styles.offlineState}>
                <View style={styles.offlineIconWrap}>
                  <Ionicons name="car-outline" size={32} color="#333" />
                </View>
                <Text style={styles.offlineTitle}>You're Offline</Text>
                <Text style={styles.offlineSub}>Go online to start accepting trips</Text>
                <TouchableOpacity
                  style={styles.goOnlineBtn}
                  onPress={() => toggleOnline(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="power" size={20} color="#000" />
                  <Text style={styles.goOnlineBtnText}>Go Online</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Online — status + go offline toggle */
              <>
                <View style={styles.onlineRow}>
                  <View style={styles.onlineDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.onlineLabel}>Online</Text>
                    <Text style={styles.onlineSub}>Accepting trips</Text>
                  </View>
                  <Switch
                    value={isOnline}
                    onValueChange={toggleOnline}
                    trackColor={{ false: '#2A2A2A', true: '#F5A623' }}
                    thumbColor="#000"
                  />
                </View>
                <View style={styles.waitingRow}>
                  <Text style={styles.waitingText}>Waiting for a trip request…</Text>
                  <View style={styles.fareIsYoursRow}>
                    <Ionicons name="cash-outline" size={14} color="#F5A623" />
                    <Text style={styles.fareIsYoursText}>You keep 100% of the fare</Text>
                  </View>
                </View>
              </>
            )}
          </>
        ) : (
          /* ── Active trip panel ── */
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.activeTripHeader}>
              <View style={[
                styles.statusIndicator,
                currentTrip.status === 'arrived'     && { backgroundColor: '#4CAF50' },
                currentTrip.status === 'in_progress' && { backgroundColor: '#2196F3' },
              ]} />
              <Text style={styles.tripActiveLabel}>
                {TRIP_STATUS_LABEL[currentTrip.status] ?? 'Trip Active'}
              </Text>
            </View>

            {currentTrip.status === 'arrived' && (
              <View style={styles.arrivedBanner}>
                <Ionicons name="checkmark-circle" size={22} color="#4CAF50" />
                <Text style={styles.arrivedBannerText}>You have arrived at the pickup</Text>
              </View>
            )}

            {riderInfo && (
              <View style={styles.riderInfoCard}>
                <View style={styles.riderInfoLeft}>
                  <View style={styles.riderAvatar}>
                    <Ionicons name="person" size={18} color="#F5A623" />
                  </View>
                  <View>
                    <Text style={styles.riderName}>{riderInfo.name}</Text>
                    <Text style={styles.riderLabel}>Rider</Text>
                  </View>
                </View>
                {riderInfo.phone ? (
                  <TouchableOpacity
                    style={styles.callBtn}
                    onPress={() => Linking.openURL(`tel:${riderInfo.phone}`)}
                  >
                    <Ionicons name="call" size={15} color="#FFF" />
                    <Text style={styles.callBtnText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {tripDetails && (
              <View style={styles.tripRouteCard}>
                <View style={styles.tripRouteRow}>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#F5A623' }]} />
                  <Text style={styles.tripRouteText} numberOfLines={2}>{tripDetails.pickup_address}</Text>
                </View>
                <View style={styles.tripRouteSep} />
                <View style={styles.tripRouteRow}>
                  <View style={[styles.routeDotSmall, { backgroundColor: '#4CAF50' }]} />
                  <Text style={styles.tripRouteText} numberOfLines={2}>{tripDetails.dropoff_address}</Text>
                </View>
                {!!tripDetails.fare_amount && (
                  <View style={styles.tripFareRow}>
                    <Text style={styles.tripFareLabel}>Fare</Text>
                    <Text style={styles.tripFareValue}>{tripDetails.fare_amount}</Text>
                  </View>
                )}
              </View>
            )}

            {(() => {
              const action = TRIP_ACTIONS[currentTrip.status];
              if (!action) return null;
              return (
                <TouchableOpacity
                  style={styles.tripActionButton}
                  onPress={() => advanceTripStatus(action.next)}
                >
                  <Text style={styles.tripActionText}>{action.label}</Text>
                </TouchableOpacity>
              );
            })()}

            {currentTrip.status !== 'in_progress' && (
              <TouchableOpacity
                style={styles.cancelTripBtn}
                onPress={() => Alert.alert('Cancel Trip', 'Are you sure?', [
                  { text: 'Keep Trip', style: 'cancel' },
                  { text: 'Cancel Trip', style: 'destructive', onPress: () => advanceTripStatus('cancelled') },
                ])}
              >
                <Text style={styles.cancelTripBtnText}>Cancel Trip</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>

      {/* Rating modal */}
      <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={() => submitRating(0)}>
        <View style={styles.ratingOverlay}>
          <View style={styles.ratingCard}>
            <Text style={styles.ratingTitle}>How was your rider?</Text>
            <Text style={styles.ratingSubtitle}>Your feedback helps keep the community safe</Text>
            <View style={styles.starsRow}>
              {[1,2,3,4,5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRatingStars(star)} activeOpacity={0.7}>
                  <Ionicons
                    name={star <= ratingStars ? 'star' : 'star-outline'}
                    size={38}
                    color={star <= ratingStars ? '#F5A623' : '#333'}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.ratingSubmitBtn, ratingStars === 0 && styles.ratingSubmitBtnDisabled]}
              onPress={() => submitRating(ratingStars)}
            >
              <Text style={styles.ratingSubmitText}>{ratingStars > 0 ? 'Submit Rating' : 'Rate your rider'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => submitRating(0)} style={styles.ratingSkipBtn}>
              <Text style={styles.ratingSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Trip offer modal */}
      <Modal visible={!!offer} transparent animationType="slide">
        <View style={styles.offerOverlay}>
          <View style={styles.offerCard}>
            <View style={styles.offerTimerRow}>
              <Text style={styles.offerTimerLabel}>New Trip Request</Text>
              <Animated.View style={[
                styles.offerTimer,
                isTimerUrgent && styles.offerTimerUrgent,
                isTimerUrgent && { opacity: pulseAnim },
              ]}>
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
                <Text style={styles.offerFareLabel}>Estimated fare</Text>
                {offer?.distance_km && offer.distance_km !== '—' && (
                  <Text style={styles.offerDistanceText}>{offer.distance_km} km</Text>
                )}
              </View>
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

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  map: { flex: 1 },

  // Top bar
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarInner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: 'rgba(10,10,10,0.88)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10,
  },
  topLogo: { fontSize: 20, fontWeight: '700', color: '#F5A623' },
  driverBadge: { fontSize: 11, color: '#888', fontWeight: '400', letterSpacing: 2 },
  tierBadge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  tierBadgeText: { fontSize: 11, fontWeight: '700' },

  // Driver map marker
  driverMarker: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFF',
  },
  driverMarkerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#000' },

  // Bottom panel — fills to screen edge so map never shows through
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },

  // Offline state
  offlineState: { alignItems: 'center', paddingVertical: 8 },
  offlineIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  offlineTitle: { fontSize: 20, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  offlineSub: { fontSize: 13, color: '#555', marginBottom: 20, textAlign: 'center' },
  goOnlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5A623', borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 40,
    width: '100%', justifyContent: 'center',
  },
  goOnlineBtnText: { color: '#000', fontWeight: '800', fontSize: 18 },

  // Online idle state
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  onlineDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#4CAF50',
  },
  onlineLabel: { fontSize: 17, fontWeight: '700', color: '#FFF', marginBottom: 2 },
  onlineSub: { fontSize: 13, color: '#555' },
  waitingRow: { gap: 10 },
  waitingText: { color: '#444', fontSize: 13, textAlign: 'center' },
  fareIsYoursRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: 'rgba(245,166,35,0.07)',
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(245,166,35,0.2)',
    paddingHorizontal: 14, paddingVertical: 8,
  },
  fareIsYoursText: { color: '#F5A623', fontSize: 12, fontWeight: '600' },

  // Active trip
  activeTripHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  statusIndicator: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#F5A623' },
  tripActiveLabel: { fontSize: 18, fontWeight: '700', color: '#FFF', flex: 1 },
  arrivedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(76,175,80,0.1)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.25)',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  arrivedBannerText: { color: '#4CAF50', fontWeight: '600', fontSize: 14, flex: 1 },
  riderInfoCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#161616', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  riderInfoLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  riderAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(245,166,35,0.12)', alignItems: 'center', justifyContent: 'center',
  },
  riderName: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  riderLabel: { fontSize: 12, color: '#555', marginTop: 1 },
  callBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#1E6B3C', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  callBtnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  tripRouteCard: {
    backgroundColor: '#161616', borderRadius: 12,
    borderWidth: 1, borderColor: '#1E1E1E',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 4, gap: 8,
  },
  tripRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeDotSmall: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  tripRouteText: { flex: 1, color: '#CCC', fontSize: 13 },
  tripRouteSep: { height: 1, backgroundColor: '#1E1E1E', marginLeft: 20 },
  tripFareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#1E1E1E',
  },
  tripFareLabel: { color: '#666', fontSize: 12 },
  tripFareValue: { color: '#F5A623', fontSize: 16, fontWeight: '700' },
  tripActionButton: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 12,
  },
  tripActionText: { color: '#000', fontWeight: '700', fontSize: 17 },
  cancelTripBtn: {
    marginTop: 8, borderWidth: 1, borderColor: '#2A2A2A',
    borderRadius: 12, paddingVertical: 12, alignItems: 'center',
  },
  cancelTripBtnText: { color: '#666', fontSize: 14, fontWeight: '500' },

  // Offer modal
  offerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  offerCard: {
    backgroundColor: '#111', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 44 : 24,
  },
  offerTimerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
  },
  offerTimerLabel: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  offerTimer: {
    backgroundColor: '#F5A623', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6,
  },
  offerTimerUrgent: { backgroundColor: '#FF3B30' },
  offerTimerText: { color: '#000', fontWeight: '700', fontSize: 16 },
  offerRoute: { backgroundColor: '#1A1A1A', borderRadius: 14, padding: 16, marginBottom: 16 },
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
  acceptButton: { flex: 2, backgroundColor: '#F5A623', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  acceptText: { color: '#000', fontWeight: '700', fontSize: 17 },

  // Rating modal
  ratingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  ratingCard: {
    backgroundColor: '#111', borderRadius: 24, padding: 28,
    width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#1E1E1E',
  },
  ratingTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  ratingSubtitle: { fontSize: 13, color: '#555', marginBottom: 24, textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  ratingSubmitBtn: {
    backgroundColor: '#F5A623', borderRadius: 14, paddingVertical: 15, paddingHorizontal: 40,
    width: '100%', alignItems: 'center', marginBottom: 12,
  },
  ratingSubmitBtnDisabled: { opacity: 0.4 },
  ratingSubmitText: { color: '#000', fontWeight: '700', fontSize: 16 },
  ratingSkipBtn: { paddingVertical: 8 },
  ratingSkipText: { color: '#444', fontSize: 14 },
});
