import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Keyboard, Platform,
  Modal, KeyboardAvoidingView, ScrollView, Linking,
  AppState, AppStateStatus,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import PolylineDecoder from '@mapbox/polyline';
import * as Location from 'expo-location';
import { DARK_MAP_STYLE, haversineKm } from '@wasel/shared';
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
  const suggestAbortRef = useRef<AbortController | null>(null);
  const destInputRef = useRef<TextInput>(null);
  const pickupInputRef = useRef<TextInput>(null);
  // Throttle map viewport auto-fit to prevent excessive animations
  const lastFitRef = useRef<number>(0);
  // Tracks whether the user cancelled while a trip request was in-flight
  const cancelledRef = useRef(false);
  // Prevents concurrent trip-request calls (double-tap protection)
  const requestInFlightRef = useRef(false);
  // Prevents the Realtime subscribe() catch-up fetch from overwriting state
  // that was just restored from the /active endpoint moments ago.
  const justRestoredRef = useRef(false);
  // Tracks whether the most recent cancellation was rider-initiated so the
  // Realtime cancelled event can distinguish "I cancelled" from "driver/dispatch cancelled".
  const selfCancelledRef = useRef(false);
  // Mirrors tripId synchronously so async Realtime callbacks can detect stale closures.
  // Set to null immediately in resetTripState() — before any awaits resolve — so a
  // subscribe() callback that was in-flight during a reset will see null and bail out.
  const currentTripIdRef = useRef<string | null>(null);

  // ── Map ready guard ──────────────────────────────────────────────────
  // React Native Maps can crash if Markers/Polylines are added to the native
  // map layer before onMapReady fires. Gate all map children on this flag.
  const [mapReady, setMapReady] = useState(false);

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
  const [driverName, setDriverName] = useState<string | null>(null);
  const [driverPhone, setDriverPhone] = useState<string | null>(null);
  const [driverVehicle, setDriverVehicle] = useState<string | null>(null);
  const [fare, setFare] = useState<string | null>(null);
  const [routePolyline, setRoutePolyline] = useState<string | null>(null);

  // ── Rating modal ──────────────────────────────────────────────────────
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingTripId, setRatingTripId] = useState<string | null>(null);

  // ── Profile ───────────────────────────────────────────────────────────
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);

  // Prevents setState after unmount (crash fix)
  const isMounted = useRef(true);
  // Tracks the previous AppState so we can detect foreground resumption.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const { destName, destLat, destLng } = useLocalSearchParams<{
    destName?: string;
    destLat?: string;
    destLng?: string;
  }>();
  // Tracks the last set of explore params that were applied to detect changes.
  // Using a composite key string rather than a boolean flag so that picking a
  // second (different) destination from the Explore tab still triggers an update.
  // A boolean ref would block the second pick because it's already 'true'.
  const lastAppliedExploreRef = useRef<string | null>(null);

  // Cleanup: mark unmounted so in-flight async callbacks skip setState
  useEffect(() => () => { isMounted.current = false; }, []);

  // ── AppState: reconnect Supabase Realtime on foreground resume ────────────
  // On real devices, backgrounding the app drops the WebSocket. Without this,
  // if the rider is mid-trip and resumes the app, the trip subscription silently
  // stops firing and the UI freezes on the last known status.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (
        (prev === 'background' || prev === 'inactive') &&
        nextState === 'active'
      ) {
        try {
          const rt = (supabase as unknown as {
            realtime: { isConnected: () => boolean; connect: () => void };
          }).realtime;
          if (!rt.isConnected()) {
            rt.connect();
          }
        } catch (e) {
          console.warn('[appstate] realtime reconnect failed:', e);
        }
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // Sign-out guard: when the user signs out, tear down all Realtime channels
  // and clear trip state. Without this, channels subscribed to the previous
  // user's trips keep firing and can write state for the wrong user session.
  const wasSignedInRef = useRef(false);
  useEffect(() => {
    if (user) {
      wasSignedInRef.current = true;
    } else if (wasSignedInRef.current) {
      wasSignedInRef.current = false;
      supabase.removeAllChannels();
      resetTripState();
    }
  }, [user]);

  // Apply destination forwarded from the Explore tab ("Ride here" button).
  // We compare against the last-applied composite key so that:
  //  - Switching away and back to the Home tab doesn't re-apply the same destination.
  //  - Picking a *different* place from Explore DOES apply the new destination.
  useFocusEffect(
    useCallback(() => {
      // Don't apply explore params while a trip is in progress — the map is
      // already showing the active-trip panel and messing with searchMode
      // or dropoff coords would corrupt the trip UI.
      if (tripStatus !== 'idle') return;
      if (!destName || !destLat || !destLng) return;
      const paramsKey = `${destName}|${destLat}|${destLng}`;
      if (lastAppliedExploreRef.current === paramsKey) return;
      lastAppliedExploreRef.current = paramsKey;
      const parsedLat = parseFloat(destLat as string);
      const parsedLng = parseFloat(destLng as string);
      // Guard against NaN from malformed route params — NaN passed to MapView crashes on iOS
      if (!isFinite(parsedLat) || !isFinite(parsedLng)) return;
      const coords = { latitude: parsedLat, longitude: parsedLng };
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
        fetchEstimate(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setTimeout(() => {
          if (!isMounted.current) return;
          mapRef.current?.fitToCoordinates([pickupCoords, coords], {
            edgePadding: { top: 120, right: 60, bottom: 320, left: 60 },
            animated: true,
          });
        }, 500);
      }
      setSearchMode('confirmed');
    }, [destName, destLat, destLng, pickupCoords, tripStatus]),
  );

  // ── Get user location on mount ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        // requestForegroundPermissionsAsync can take seconds (first-launch dialog).
        // Guard every setState in case the user navigated away before it resolved.
        if (!isMounted.current) return;
        if (status !== 'granted') { defaultToAmman(); return; }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted.current) return;
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
        if (isMounted.current) defaultToAmman();
      }
    })();
  }, []);

  function defaultToAmman() {
    setPickupCoords(AMMAN);
    setPickup('Amman, Jordan');
    mapRef.current?.animateToRegion({ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 800);
  }

  // ── Fetch fare estimate + real polyline from backend ─────────────────
  async function fetchEstimate(
    pickupLat: number,
    pickupLng: number,
    dropLat: number,
    dropLng: number,
  ) {
    try {
      const url =
        `${API_URL}/api/trips/estimate` +
        `?pickup_lat=${pickupLat}&pickup_lng=${pickupLng}` +
        `&dropoff_lat=${dropLat}&dropoff_lng=${dropLng}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { fare_jd: number; polyline: string | null } = await res.json();
      if (!isMounted.current) return;
      // Guard against null/NaN from backend — .toFixed() on null throws TypeError
      if (typeof data.fare_jd === 'number' && isFinite(data.fare_jd)) {
        setFare(data.fare_jd.toFixed(2));
      }
      setRoutePolyline(data.polyline ?? null);
    } catch {
      // Fallback: keep the client-side haversine fare already set; clear polyline
      // so the straight-line fallback renders on the map.
      if (isMounted.current) setRoutePolyline(null);
    }
  }

  // ── Rider profile ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !isMounted.current) return;
        const res = await fetch(`${API_URL}/api/riders/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && isMounted.current) setRiderProfile(await res.json());
      } catch { /* non-fatal */ }
    })();
  }, [user?.id]);

  // ── Trip-session bootstrap: restore live trip OR cancel stale pre-dispatch ──
  //
  // Coherent policy (mirror image of driver-side bootstrap in dashboard.tsx):
  //   1. GET /trips/active → LIVE statuses only (accepted/en_route/arrived/in_progress).
  //      If present, restore the full trip UI. Rider does NOT lose a legitimate
  //      ride just because the app was closed and reopened.
  //   2. Otherwise, GET /trips/any-pending and cancel only PRE-DISPATCH stale
  //      trips ('requested' / 'dispatching'). These have no driver and are
  //      almost certainly leftovers from a crashed session — cancelling them
  //      unblocks the next ride request with a 409 loop.
  //
  // Live-status trips are NEVER destroyed here. A rider who wants to cancel an
  // in-progress ride must use the Cancel button in the trip panel.
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token || !isMounted.current) return;

        // Step 1 — restore live trip if one exists.
        // Client-side policy (defence-in-depth; backend also enforces):
        //   - Must have a driver_id (a trip with no driver is pre-dispatch, not live)
        //   - Status must be in the LIVE whitelist
        //   - Pickup + dropoff coords must be finite numbers
        // If any guard fails, we do NOT restore — we fall through to the "start idle"
        // path. A blank home screen is always safer than a ghost "driver accepted" UI.
        const LIVE_STATUSES: TripStatus[] = ['accepted', 'en_route', 'arrived', 'in_progress'];
        const activeRes = await fetch(`${API_URL}/api/trips/active`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!isMounted.current) return;
        if (activeRes.ok) {
          const active = await activeRes.json();
          const hasValidCoords =
            typeof active?.pickup_lat === 'number' && isFinite(active.pickup_lat) &&
            typeof active?.pickup_lng === 'number' && isFinite(active.pickup_lng) &&
            typeof active?.dropoff_lat === 'number' && isFinite(active.dropoff_lat) &&
            typeof active?.dropoff_lng === 'number' && isFinite(active.dropoff_lng);
          const isRestorable =
            active?.id &&
            active?.driver_id &&                         // pre-dispatch trips have no driver
            LIVE_STATUSES.includes(active?.status) &&
            hasValidCoords;

          if (isRestorable && isMounted.current) {
            // Suppress the subscribe() catch-up fetch for 3 s so it can't race
            // against this restore and wipe the state we just populated.
            justRestoredRef.current = true;
            setTimeout(() => { justRestoredRef.current = false; }, 3000);

            // Populate trip state synchronously. Set the ref before setState so
            // any in-flight Realtime callback sees the correct "current trip" id.
            currentTripIdRef.current = active.id;
            setTripId(active.id);
            setTripStatus(active.status as TripStatus);
            setDriverId(active.driver_id);

            setPickupCoords({ latitude: active.pickup_lat, longitude: active.pickup_lng });
            setDropoffCoords({ latitude: active.dropoff_lat, longitude: active.dropoff_lng });
            if (active.pickup_address)  setPickup(active.pickup_address);
            if (active.dropoff_address) setDropoff(active.dropoff_address);
            if (active.fare_amount != null) setFare(String(active.fare_amount));
            setSearchMode('confirmed');
            return; // Live trip restored — do not fall through to the cancel branch.
          }
          // If the backend returned something non-null but it failed our guards,
          // fall through: no restore, and the pre-dispatch branch below will
          // clean up any stale requested/dispatching trip.
        }

        // Step 2 — no live trip. Check for a stale pre-dispatch trip.
        const pendingRes = await fetch(`${API_URL}/api/trips/any-pending`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!pendingRes.ok || !isMounted.current) return;
        const pending = await pendingRes.json();
        if (!pending?.id || !isMounted.current) return;

        // Only cancel PRE-DISPATCH statuses. Live-status trips are out of scope
        // here — if any-pending returns one at this point, /active must have
        // returned null a moment ago (race), so leave it for Realtime to pick up.
        const PRE_DISPATCH = ['requested', 'dispatching'];
        if (PRE_DISPATCH.includes(pending.status)) {
          await fetch(`${API_URL}/api/trips/${pending.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: 'cancelled' }),
          }).catch(() => {}); // non-fatal — UI stays idle either way
        }
      } catch { /* non-fatal — bootstrap failure does not block the UI */ }
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trip Realtime subscription ────────────────────────────────────────
  useEffect(() => {
    if (!tripId) return;
    // Sync the ref so async callbacks spawned by this effect can detect
    // whether the trip was reset while they were awaiting.
    currentTripIdRef.current = tripId;

    // Deduplication guard: tear down any pre-existing channel for this trip
    // before creating a new one. On real devices, effect cleanup sometimes
    // races with the new effect (fast remount / React Strict Mode), which can
    // leave two subscriptions for the same trip alive simultaneously. Both would
    // fire on every CDC event, causing duplicate state updates and double alerts.
    const tripChannelName = `trip-${tripId}`;
    const existingTrip = supabase.getChannels().find(
      c => c.topic === tripChannelName || c.topic === `realtime:${tripChannelName}`,
    );
    if (existingTrip) {
      try { supabase.removeChannel(existingTrip); } catch { /* ignore */ }
    }

    const ch = supabase
      .channel(tripChannelName)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'trips',
        filter: `id=eq.${tripId}`,
      }, (payload) => {
        try {
          if (!isMounted.current) return;
          const st = payload.new.status as TripStatus;
          const did = payload.new.driver_id as string | null;
          setTripStatus(st);
          if (did) setDriverId(did);
          if (st === 'completed') {
            setRatingTripId(tripId);
            setRatingStars(0);
            setShowRatingModal(true);
          } else if (st === 'cancelled') {
            // If the rider didn't self-cancel, show an informative alert so they
            // know to request again (trip was cancelled by the driver or dispatch).
            if (!selfCancelledRef.current) {
              Alert.alert(
                'Trip Cancelled',
                'Your trip was cancelled. This can happen when no drivers are available or the driver is unable to pick you up. Please try requesting again.',
                [{ text: 'OK' }],
              );
            }
            selfCancelledRef.current = false;
            setTimeout(() => { if (isMounted.current) resetTripState(); }, 0);
          }
        } catch (err) {
          console.error('[trip-sub] payload error:', err);
        }
      })
      .subscribe(async () => {
        try {
          // Skip re-fetch if a restore just completed moments ago — the restore
          // already gave us fresh state and we would race against it.
          if (justRestoredRef.current) return;
          // Capture the tripId this subscription was created for so we can detect
          // if resetTripState() ran while we were waiting (currentTripIdRef → null).
          const capturedTripId = tripId;
          if (!isMounted.current) return;
          // If the trip was cancelled/reset while we were awaiting anything,
          // currentTripIdRef will be null — bail out to avoid re-activating trip UI.
          if (currentTripIdRef.current !== capturedTripId) return;

          // Query Supabase directly instead of going through the Railway backend —
          // this cuts the roundtrip from ~400ms to ~50ms and avoids the JWT
          // fetch + HTTP hop entirely.
          const { data, error } = await supabase
            .from('trips')
            .select('id, status, driver_id')
            .eq('id', capturedTripId)
            .single();

          if (error || !data || !isMounted.current) return;
          if (currentTripIdRef.current !== capturedTripId) return;

          if (!data.status || data.status === 'requested') {
            // 'requested' or missing: dispatch is still pending, no state update needed
          } else if (data.status === 'cancelled') {
            // Trip was already cancelled before the Realtime channel connected.
            // The postgres_changes handler will NOT fire for this since we just
            // subscribed — so we must handle the terminal state here manually.
            // selfCancelledRef stays false (we didn't cancel it), which is
            // correct: we want the "trip cancelled" alert to show if applicable.
            setTimeout(() => { if (isMounted.current) resetTripState(); }, 0);
          } else if (data.status === 'completed') {
            // Trip was already completed — show rating modal and reset.
            if (isMounted.current) {
              setRatingTripId(capturedTripId);
              setRatingStars(0);
              setShowRatingModal(true);
            }
          } else {
            setTripStatus(data.status as TripStatus);
            if (data.driver_id) setDriverId(data.driver_id);
          }
        } catch (err) {
          console.error('[trip-sub] subscribe fetch error:', err);
        }
      });
    return () => {
      try { supabase.removeChannel(ch); } catch { /* ignore — channel may already be gone */ }
    };
  }, [tripId]);

  // ── Live driver location subscription ────────────────────────────────
  useEffect(() => {
    if (!driverId) return;
    if (['idle', 'searching', 'completed', 'cancelled'].includes(tripStatus)) return;

    // Deduplication: remove any stale channel for this driver before creating a new one
    const driverLocChannelName = `driver-loc-${driverId}`;
    const existingDriverLoc = supabase.getChannels().find(
      c => c.topic === driverLocChannelName || c.topic === `realtime:${driverLocChannelName}`,
    );
    if (existingDriverLoc) {
      try { supabase.removeChannel(existingDriverLoc); } catch { /* ignore */ }
    }

    const ch = supabase
      .channel(driverLocChannelName)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'drivers',
        filter: `id=eq.${driverId}`,
      }, (payload) => {
        try {
          if (!isMounted.current) return;
          // Bail out if the trip was reset between the CDC event arriving and now
          if (currentTripIdRef.current === null) return;
          const lat = payload.new.location_lat as number | null;
          const lng = payload.new.location_lng as number | null;
          // Validate coordinates: NaN/Infinity from GPS transition would crash MapView
          if (lat != null && lng != null && isFinite(lat) && isFinite(lng)) {
            setDriverLocation({ latitude: lat, longitude: lng });
          }
        } catch (err) {
          console.error('[driver-loc-sub] payload error:', err);
        }
      })
      .subscribe(async () => {
        try {
          // Capture before any await so we can detect a reset that happens while waiting
          const capturedTripId = currentTripIdRef.current;
          if (capturedTripId === null) return;
          const { data } = await supabase
            .from('drivers').select('location_lat, location_lng')
            .eq('id', driverId).single();
          // Verify the trip is still active after the async DB fetch resolves
          if (currentTripIdRef.current !== capturedTripId) return;
          if (!isMounted.current) return;
          // Validate coordinates before setting state — invalid coords crash MapView
          if (
            data?.location_lat != null && data?.location_lng != null &&
            isFinite(data.location_lat) && isFinite(data.location_lng)
          ) {
            setDriverLocation({ latitude: data.location_lat, longitude: data.location_lng });
          }
        } catch (err) {
          console.error('[driver-loc-sub] subscribe fetch error:', err);
        }
      });
    return () => {
      try { supabase.removeChannel(ch); } catch { /* ignore — channel may already be gone */ }
    };
  }, [driverId, tripStatus]);

  // ── Fetch driver name, phone, and vehicle when driverId becomes known ───
  useEffect(() => {
    if (!driverId) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('drivers')
          .select('name, phone, vehicle_make, vehicle_model, vehicle_plate')
          .eq('id', driverId)
          .single();
        if (!isMounted.current) return;
        if (data?.name) setDriverName(data.name);
        if (data?.phone) setDriverPhone(data.phone);
        const veh = [data?.vehicle_make, data?.vehicle_model].filter(Boolean).join(' ');
        if (veh) setDriverVehicle(veh + (data?.vehicle_plate ? ` · ${data.vehicle_plate}` : ''));
      } catch { /* non-fatal */ }
    })();
  }, [driverId]);

  // ── Auto-fit viewport to include driver + pickup when approaching ──────
  // Throttled to once every 5 s to avoid jarring continuous animations.
  // 500 ms delay gives the native map layer time to finish reconciling any
  // Marker/Polyline changes before the fit animation starts — calling
  // fitToCoordinates while the native layer is still updating children
  // causes intermittent native crashes on both iOS and Android.
  useEffect(() => {
    if (!driverLocation || !pickupCoords) return;
    if (tripStatus !== 'accepted' && tripStatus !== 'en_route') return;
    const now = Date.now();
    if (now - lastFitRef.current < 5000) return;
    lastFitRef.current = now;
    // Only fit both points when the driver is within 200 km of the pickup.
    // If the driver's GPS is in a different country (e.g., during overseas
    // testing) fitToCoordinates would span the globe, zoom the map to level 0,
    // and either crash the native layer or show a blank screen.
    const driverNearPickup =
      haversineKm(driverLocation.latitude, driverLocation.longitude,
                  pickupCoords.latitude,   pickupCoords.longitude) < 200;
    const t = setTimeout(() => {
      if (!isMounted.current) return;
      if (driverNearPickup) {
        mapRef.current?.fitToCoordinates([driverLocation, pickupCoords], {
          edgePadding: { top: 100, right: 60, bottom: 380, left: 60 },
          animated: true,
        });
      } else {
        // Driver is far away — just centre on the pickup so the map stays usable.
        mapRef.current?.animateToRegion({
          latitude: pickupCoords.latitude,
          longitude: pickupCoords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        }, 600);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [driverLocation, pickupCoords, tripStatus]);

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
    // Abort any in-flight request so out-of-order responses can't overwrite newer results
    suggestAbortRef.current?.abort();
    const ac = new AbortController();
    suggestAbortRef.current = ac;
    setLoadingSuggestions(true);
    try {
      const q = encodeURIComponent(query);
      const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=8&viewbox=34.9,29.1,39.3,33.4&bounded=0&accept-language=en&addressdetails=1`;
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'WaselApp/1.0' } });
      if (!isMounted.current) return;
      // Guard: Nominatim occasionally returns an error object or empty body on
      // rate-limit / server error. If the response isn't an array, treat it as
      // "no results" rather than crashing with a render-time type error.
      const json = await res.json();
      setSuggestions(Array.isArray(json) ? json : []);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return; // intentional abort, not an error
      if (!isMounted.current) return;
      setSuggestions([]);
    } finally {
      if (isMounted.current) setLoadingSuggestions(false);
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
    const parsedLat = parseFloat(place.lat);
    const parsedLon = parseFloat(place.lon);
    // Guard: Nominatim can return empty/invalid coordinates — NaN crashes MapView
    if (!isFinite(parsedLat) || !isFinite(parsedLon)) return;
    const coords = { latitude: parsedLat, longitude: parsedLon };
    const parts = place.display_name.split(', ');
    const label = parts.slice(0, 3).join(', ');

    if (editingField === 'destination') {
      setDropoff(label);
      setDropoffCoords(coords);
      setSuggestions([]);
      Keyboard.dismiss();
      setSearchMode('confirmed');
      if (pickupCoords) {
        // Set a client-side haversine fare immediately so the UI is not empty,
        // then replace it with the server estimate (which may include a real polyline).
        const dist = haversineKm(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setFare(Math.max(1.5, 0.5 + dist * 0.35).toFixed(2));
        fetchEstimate(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
        setTimeout(() => {
          if (!isMounted.current) return;
          mapRef.current?.fitToCoordinates([pickupCoords, coords], {
            edgePadding: { top: 120, right: 60, bottom: 320, left: 60 },
            animated: true,
          });
        }, 500);
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
        fetchEstimate(
          pickupCoords.latitude, pickupCoords.longitude,
          coords.latitude, coords.longitude,
        );
      }
    }
  }

  // ── Request ride ──────────────────────────────────────────────────────
  async function handleRequestRide() {
    if (!pickupCoords || !dropoffCoords) {
      Alert.alert(t('setPickupDropoff'), t('tapMapDest2'));
      return;
    }
    // Reset cancel signals first — must happen before the in-flight guard so
    // that a 409 "Cancel & Retry" path (which calls handleRequestRide again
    // after a cancel) always starts with clean state. If we reset AFTER the
    // guard, a stale cancelledRef=true from the prior cancel-loading flow
    // would immediately short-circuit the retry request at the post-await check.
    cancelledRef.current = false;
    selfCancelledRef.current = false;

    // Double-tap guard: prevent concurrent requests (second tap while first is in-flight)
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;

    // Token check BEFORE showing the loading state or making any request
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      requestInFlightRef.current = false;
      Alert.alert(t('error'), 'Session expired. Please sign in again.');
      return;
    }

    setTripStatus('searching');

    try {
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

      // 409 = rider already has an active trip (stale from previous session or test)
      if (res.status === 409) {
        // Release the in-flight guard before showing the dialog — otherwise tapping
        // "Keep It" leaves requestInFlightRef=true and locks the Request button forever.
        requestInFlightRef.current = false;
        setTripStatus('idle');
        Alert.alert(
          'Active Trip Found',
          'You still have an active trip. Cancel it and request a new one?',
          [
            { text: 'Keep It', style: 'cancel' },
            {
              text: 'Cancel & Retry',
              style: 'destructive',
              onPress: async () => {
                try {
                  // Use /any-pending instead of /active so we can find and cancel trips
                  // in 'requested' or 'dispatching' status (before a driver is assigned).
                  // GET /active only returns live-status trips and would miss pre-dispatch
                  // stale trips, causing this cancel-and-retry to loop forever.
                  const pendingRes = await fetch(`${API_URL}/api/trips/any-pending`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (pendingRes.ok) {
                    const pending = await pendingRes.json();
                    if (pending?.id) {
                      await fetch(`${API_URL}/api/trips/${pending.id}/status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ status: 'cancelled' }),
                      });
                    }
                  }
                } catch { /* ignore — try again anyway */ }
                // Small delay so the cancel write commits to the DB before the
                // retry POST checks for active trips — avoids a 409 loop.
                await new Promise(resolve => setTimeout(resolve, 500));
                handleRequestRide();
              },
            },
          ],
        );
        return;
      }

      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

      // User hit cancel while the request was in-flight — immediately cancel
      if (cancelledRef.current) {
        fetch(`${API_URL}/api/trips/${data.tripId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ status: 'cancelled' }),
        }).catch(() => {});
        return; // resetTripState was already called by handleCancelTrip
      }

      // Component may have unmounted (app backgrounded, tab switched) while the
      // request was in-flight — bail out to prevent setState on a dead component.
      if (!isMounted.current) return;

      setTripId(data.tripId);
      setTripStatus('dispatching');
      if (data.fare_amount != null) setFare(String(data.fare_amount));
    } catch (err: unknown) {
      if (!cancelledRef.current) {
        const msg = err instanceof Error ? err.message : t('somethingWrong');
        Alert.alert(t('error'), msg);
        setTripStatus('idle');
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }

  // ── Cancel trip ───────────────────────────────────────────────────────
  async function handleCancelTrip() {
    cancelledRef.current = true;    // stop any in-flight request from setting trip state
    selfCancelledRef.current = true; // tell the Realtime handler this was rider-initiated
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
    // Clear synchronously — async Realtime callbacks check this ref after each
    // await, so setting it to null here (before any re-render) prevents stale
    // callbacks from calling setTripStatus after the trip has been torn down.
    currentTripIdRef.current = null;
    // Clear the explore-param key so the next "Ride here" pick is applied even
    // if the user picks the same destination again after a completed trip.
    lastAppliedExploreRef.current = null;
    setTripStatus('idle');
    setTripId(null);
    setDriverId(null);
    setDriverLocation(null);
    setDriverName(null);
    setDriverPhone(null);
    setDriverVehicle(null);
    setDropoff('');
    setDropoffCoords(null);
    setFare(null);
    setRoutePolyline(null);
    setSuggestions([]);
    setSearchMode('idle');
    lastFitRef.current = 0;
    // NOTE: cancelledRef and selfCancelledRef are intentionally NOT reset here.
    // cancelledRef is reset only at the start of handleRequestRide() (before any await).
    // selfCancelledRef is reset only at the start of handleRequestRide() and in the
    // Realtime cancelled handler (after checking it), so in-flight POST responses
    // can still read the correct cancel signal after resetTripState() has been called.
  }

  async function submitRating(stars: number) {
    setShowRatingModal(false);
    if (stars > 0 && ratingTripId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          await fetch(`${API_URL}/api/trips/${ratingTripId}/rate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ rating: stars, ratee: 'driver' }),
          });
        }
      } catch { /* non-fatal */ }
    }
    setRatingTripId(null);
    resetTripState();
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

  // ETA from driver's current location to pickup — assumes ~25 km/h average city speed
  const driverEtaMin = useMemo(() => {
    if (!driverLocation || !pickupCoords) return null;
    const km = haversineKm(
      driverLocation.latitude, driverLocation.longitude,
      pickupCoords.latitude, pickupCoords.longitude,
    );
    return Math.max(1, Math.ceil((km / 25) * 60));
  }, [driverLocation, pickupCoords]);

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
        customMapStyle={DARK_MAP_STYLE}
        onMapReady={() => setMapReady(true)}
      >
        {/* Gate ALL map children on mapReady — adding Markers/Polylines before the
            native map layer fires onMapReady causes a native crash on Android and
            intermittent crashes on iOS, especially during rapid state transitions. */}
        {mapReady && pickupCoords && <Marker coordinate={pickupCoords} title="Pickup" pinColor="#F5A623" />}
        {mapReady && dropoffCoords && <Marker coordinate={dropoffCoords} title="Dropoff" pinColor="#4CAF50" />}
        {mapReady && driverLocation && ['accepted', 'en_route', 'arrived', 'in_progress'].includes(tripStatus) && (
          <Marker coordinate={driverLocation} title="Driver">
            <View style={s.driverMarker}>
              <Ionicons name="car" size={14} color="#FFF" />
            </View>
          </Marker>
        )}
        {/* Route line: driver→pickup while approaching; pickup→dropoff otherwise */}
        {mapReady && (driverLocation && (tripStatus === 'accepted' || tripStatus === 'en_route') && pickupCoords ? (
          <Polyline
            coordinates={[driverLocation, pickupCoords]}
            strokeColor="#F5A623"
            strokeWidth={3}
            lineDashPattern={[6, 3]}
          />
        ) : (pickupCoords && dropoffCoords && (
          routePolyline ? (() => {
            // decode() can throw on malformed strings and returns NaN coordinates
            // on truncated data — both crash Android's native MapView layer.
            // Parse defensively: filter out any non-finite coord pairs and fall
            // back to the straight-line polyline if fewer than 2 valid points remain.
            try {
              const coords = PolylineDecoder.decode(routePolyline)
                .map(([lat, lng]: [number, number]) => ({ latitude: lat, longitude: lng }))
                .filter(c => isFinite(c.latitude) && isFinite(c.longitude));
              if (coords.length >= 2) {
                return (
                  <Polyline coordinates={coords} strokeColor="#F5A623" strokeWidth={3} />
                );
              }
            } catch { /* fall through to straight-line fallback below */ }
            return (
              <Polyline
                coordinates={[pickupCoords!, dropoffCoords!]}
                strokeColor="#F5A623"
                strokeWidth={2}
                lineDashPattern={[8, 4]}
              />
            );
          })() : (
            <Polyline
              coordinates={[pickupCoords, dropoffCoords]}
              strokeColor="#F5A623"
              strokeWidth={2}
              lineDashPattern={[8, 4]}
            />
          )
        )))}
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
            <View style={s.sheet}>
              <View style={s.sheetHandle} />

              {/* Route card — each row tappable to re-open search */}
              <View style={s.routeCard}>
                {/* Left: pip dots + connector line */}
                <View style={s.routePipCol}>
                  <View style={s.pipPickup} />
                  <View style={s.routeConnector} />
                  <View style={s.pipDropoff} />
                </View>

                {/* Right: two tappable address rows */}
                <View style={{ flex: 1 }}>
                  <TouchableOpacity
                    style={s.routeTextRow}
                    onPress={() => openSearch('pickup')}
                    activeOpacity={0.7}
                  >
                    <View style={s.routeTextBlock}>
                      <Text style={s.routeRowLabel}>Pickup</Text>
                      <Text style={s.routeRowValue} numberOfLines={1}>{pickup || 'Set pickup'}</Text>
                    </View>
                    <Ionicons name="pencil-outline" size={14} color="#3A3A3A" />
                  </TouchableOpacity>

                  <View style={s.routeRowDivider} />

                  <TouchableOpacity
                    style={s.routeTextRow}
                    onPress={() => openSearch('destination')}
                    activeOpacity={0.7}
                  >
                    <View style={s.routeTextBlock}>
                      <Text style={s.routeRowLabel}>Dropoff</Text>
                      <Text style={s.routeRowValue} numberOfLines={1}>{dropoff}</Text>
                    </View>
                    <Ionicons name="pencil-outline" size={14} color="#3A3A3A" />
                  </TouchableOpacity>
                </View>
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
        </View>
      )}

      {/* ── ACTIVE TRIP panel ─────────────────────────────────────────── */}
      {isActiveTrip && (
        <View style={s.sheetWrap}>
            <View style={s.sheet}>
              <View style={s.sheetHandle} />

              {/* Status row */}
              <View style={s.statusRow}>
                {isSearching
                  ? <ActivityIndicator color="#F5A623" size="small" style={{ marginRight: 10 }} />
                  : <View style={[
                      s.statusDot,
                      tripStatus === 'arrived' && { backgroundColor: '#4CAF50' },
                      tripStatus === 'in_progress' && { backgroundColor: '#2196F3' },
                    ]} />
                }
                <Text style={s.statusLabel}>{statusLabel[tripStatus]}</Text>
              </View>

              {/* ── Arrived banner ── */}
              {tripStatus === 'arrived' && (
                <View style={s.arrivedBanner}>
                  <Ionicons name="checkmark-circle" size={26} color="#4CAF50" />
                  <View style={{ flex: 1 }}>
                    <Text style={s.arrivedBannerTitle}>Your driver has arrived!</Text>
                    <Text style={s.arrivedBannerSub}>Please head to the pickup point</Text>
                  </View>
                </View>
              )}

              {/* ── Driver card (all assigned states) ── */}
              {driverId && ['accepted', 'en_route', 'arrived', 'in_progress'].includes(tripStatus) && (
                <View style={s.driverApproachCard}>
                  <View style={s.driverApproachLeft}>
                    <View style={s.driverApproachIcon}>
                      <Ionicons name="car" size={18} color="#F5A623" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.driverApproachName}>{driverName || 'Your driver'}</Text>
                      {driverVehicle
                        ? <Text style={s.driverApproachSub}>{driverVehicle}</Text>
                        : <Text style={s.driverApproachSub}>
                            {tripStatus === 'arrived' ? 'has arrived' : 'is on the way'}
                          </Text>
                      }
                    </View>
                  </View>
                  <View style={s.driverCardRight}>
                    {/* ETA badge — only shown when en route */}
                    {driverEtaMin != null && (tripStatus === 'accepted' || tripStatus === 'en_route') && (
                      <View style={s.etaBadge}>
                        <Text style={s.etaValue}>{driverEtaMin}</Text>
                        <Text style={s.etaUnit}>min</Text>
                      </View>
                    )}
                    {/* Call button */}
                    {driverPhone && (
                      <TouchableOpacity
                        style={s.callBtn}
                        onPress={() => {
                          // .catch() required — Linking.openURL rejects on Android when
                          // the tel: URL is empty/invalid, crashing the JS thread if unhandled.
                          Linking.openURL(`tel:${driverPhone}`).catch(() => {});
                        }}
                      >
                        <Ionicons name="call" size={16} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}

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

      {/* ── RATING MODAL ─────────────────────────────────────────── */}
      <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={() => submitRating(0)}>
        <View style={s.ratingOverlay}>
          <View style={s.ratingCard}>
            <Text style={s.ratingTitle}>How was your driver?</Text>
            <Text style={s.ratingSubtitle}>Your feedback helps improve the experience</Text>
            <View style={s.starsRow}>
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
              style={[s.ratingSubmitBtn, ratingStars === 0 && s.ratingSubmitBtnDisabled]}
              onPress={() => submitRating(ratingStars)}
              activeOpacity={0.85}
            >
              <Text style={s.ratingSubmitText}>{ratingStars > 0 ? 'Submit Rating' : 'Rate your driver'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => submitRating(0)} style={s.ratingSkipBtn}>
              <Text style={s.ratingSkipText}>Skip</Text>
            </TouchableOpacity>
          </View>
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
  idleWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: Platform.OS === 'ios' ? 28 : 12,
  },
  whereToCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16, marginBottom: 8,
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
  // sheetWrap fills all the way to the bottom of the screen (including the iPhone
  // home-indicator safe area) with the same background as the sheet, so the map
  // never bleeds through the gap below the rounded-corner sheet.
  sheetWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 14,
  },
  sheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    gap: 12,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: '#252525',
    borderRadius: 2, alignSelf: 'center', marginBottom: 2,
  },

  // Route card (confirmed state)
  routeCard: {
    backgroundColor: '#161616', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E', overflow: 'hidden',
    flexDirection: 'row',
  },
  routePipCol: {
    width: 44,
    alignItems: 'center',
    paddingVertical: 16,
    justifyContent: 'space-between',
  },
  routeConnector: {
    flex: 1,
    width: 2,
    backgroundColor: '#2A2A2A',
    marginVertical: 4,
    borderRadius: 1,
  },
  routeTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingRight: 14,
    gap: 10,
  },
  routeRowDivider: {
    height: 1,
    backgroundColor: '#1E1E1E',
  },
  routeTextBlock: { flex: 1 },
  routeRowLabel: {
    fontSize: 10, color: '#555', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2,
  },
  routeRowValue: { fontSize: 14, color: '#EEE', fontWeight: '500' },

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

  // Arrived banner
  arrivedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.25)',
  },
  arrivedBannerTitle: { fontSize: 15, fontWeight: '700', color: '#4CAF50' },
  arrivedBannerSub: { fontSize: 12, color: '#888', marginTop: 2 },

  // Driver card (unified for all active states)
  driverApproachCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(245,166,35,0.07)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.18)',
  },
  driverApproachLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  driverApproachIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  driverApproachName: { fontSize: 15, fontWeight: '600', color: '#FFF' },
  driverApproachSub: { fontSize: 12, color: '#888', marginTop: 1 },
  driverCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 },
  etaBadge: {
    alignItems: 'center',
    backgroundColor: '#F5A623', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5, minWidth: 46,
  },
  etaValue: { fontSize: 16, fontWeight: '800', color: '#000', lineHeight: 18 },
  etaUnit: { fontSize: 9, fontWeight: '600', color: '#000', letterSpacing: 0.5 },
  callBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#1E6B3C',
    alignItems: 'center', justifyContent: 'center',
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

  // Rating modal
  ratingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  ratingCard: {
    backgroundColor: '#111', borderRadius: 24, padding: 28,
    width: '100%', alignItems: 'center',
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  ratingTitle: { fontSize: 22, fontWeight: '700', color: '#FFF', marginBottom: 6 },
  ratingSubtitle: { fontSize: 13, color: '#555', marginBottom: 24, textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: 10, marginBottom: 28 },
  ratingSubmitBtn: {
    backgroundColor: '#F5A623', borderRadius: 14,
    paddingVertical: 15, paddingHorizontal: 40,
    width: '100%', alignItems: 'center', marginBottom: 12,
  },
  ratingSubmitBtnDisabled: { opacity: 0.4 },
  ratingSubmitText: { color: '#000', fontWeight: '700', fontSize: 16 },
  ratingSkipBtn: { paddingVertical: 8 },
  ratingSkipText: { color: '#444', fontSize: 14 },
});
