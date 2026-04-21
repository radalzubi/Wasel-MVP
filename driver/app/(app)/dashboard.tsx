import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Switch, Alert, Vibration, Platform, Modal, Animated, Linking, ScrollView,
  AppState, AppStateStatus,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { DARK_MAP_STYLE, haversineKm } from '@wasel/shared';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { supabase } from '../../lib/supabase';
import { useStartupHealthCtx } from './_layout';

// Expo Go (storeClient) has a fixed precompiled binary — Google Maps SDK,
// background location, and foreground services are not included.
// In every EAS build (dev-client / testflight / production) this is false
// and all native features work correctly.
const IS_EXPO_GO = Constants.executionEnvironment === 'storeClient';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const AMMAN = { latitude: 31.9539, longitude: 35.9106 };

// Normalize any backend-sourced coordinate pair to a finite LatLng or null.
// Treat NaN, Infinity, null, undefined, strings, and the (0,0) "null island"
// sentinel as invalid. Centralising this means the render path never has to
// think about what "valid coord" means — it just checks for null.
function finiteLatLng(
  lat: unknown,
  lng: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof lat !== 'number' || !isFinite(lat)) return null;
  if (typeof lng !== 'number' || !isFinite(lng)) return null;
  // Null Island (0,0) is almost certainly a backend default/geocoding miss,
  // not a real destination in Jordan. Reject it at the boundary.
  if (lat === 0 && lng === 0) return null;
  return { latitude: lat, longitude: lng };
}

function openNavigation(lat: number, lng: number) {
  // Guard against null/0/NaN coordinates (can happen if backend omits geocoding)
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return;

  const googleUrlIos = `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`;
  const googleUrlAndroid = `google.navigation:q=${lat},${lng}`;
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const appleUrl = `maps://?daddr=${lat},${lng}`;

  if (Platform.OS === 'ios') {
    Linking.canOpenURL(googleUrlIos)
      .then(can => Linking.openURL(can ? googleUrlIos : appleUrl))
      .catch(() => Linking.openURL(fallbackUrl))
      .catch(() => {});
  } else {
    Linking.openURL(googleUrlAndroid)
      .catch(() => Linking.openURL(fallbackUrl))
      .catch(() => {});
  }
}

// ── Types (module-level — not recreated on every render) ──────────────────────
type TripStatus = 'accepted' | 'en_route' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';

interface TripOffer {
  id: string;
  trip_id: string;
  pickup_address: string;
  dropoff_address: string;
  // Nullable — backend row may occasionally lack geocoded coords.
  // All consumers must null-check before using in <Marker> or haversineKm.
  pickup_lat: number | null;
  pickup_lng: number | null;
  fare_estimate: string;
  distance_km: string;
}

interface LatLng { latitude: number; longitude: number; }

interface RiderInfo { name: string; phone: string | null; }

interface TripDetails {
  pickup_address: string;
  dropoff_address: string;
  fare_amount: string;
  // Coords are nullable because the backend row may occasionally lack them
  // (legacy data, RLS-filtered read, serialization hiccup). Every consumer
  // must null-check before passing to <Marker>/fitToCoordinates/haversineKm.
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
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
  const { user, getAccessToken } = useAuth();
  const { t } = useLanguage();
  // Crash-loop breaker context: see rider/app/(app)/home.tsx for full rationale.
  // shouldSkipRestore = true means skip /api/trips/driver-active on this boot.
  const { shouldSkipRestore, markBootstrapDone } = useStartupHealthCtx();
  // Separates "screen mounted" from "map mounted". We render a pure black
  // absoluteFill first and only mount the MapView after bootstrap completes,
  // so that a crash during bootstrap doesn't land on the same frame as a
  // MapView native init.
  const [shouldMountMap, setShouldMountMap] = useState(false);
  const mapRef = useRef<MapView>(null);
  const isMounted = useRef(true);

  // ── Map ready guard ──────────────────────────────────────────────────────
  // Gate ALL map children on this flag — rendering Markers/Polylines before
  // the native map layer fires onMapReady causes native crashes.
  const [mapReady, setMapReady]               = useState(false);
  // Ref mirror of mapReady so setTimeout/async callbacks can read the latest
  // value without relying on a stale closure captured at effect-creation
  // time. Kept in sync via the effect just below.
  const mapReadyRef = useRef(false);
  // Stash for an initial animateToRegion that was requested before onMapReady.
  // State (not ref) so a subsequent mapReady flip or new pending region both
  // trigger the applying effect. Avoids pre-ready native crashes.
  const [pendingInitialRegion, setPendingInitialRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null>(null);

  const [isOnline, setIsOnline]               = useState(false);
  const [isApproved, setIsApproved]           = useState<boolean>(false);
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
  // Tracks when the driver initiates a cancel so the Realtime CDC echo
  // that fires back to the same subscription doesn't wrongly show
  // "The rider has cancelled this trip" to the driver.
  const driverCancelledRef = useRef(false);
  // Stable ref so map callbacks always use the latest GPS position without
  // relying on a stale closure captured at effect-creation time.
  const locationRef = useRef<LatLng | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  // Tracks the previous AppState so we can detect foreground resumption.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Mark unmounted so async callbacks can bail out safely.
  // Also set up the Android notification channel on first mount.
  useEffect(() => {
    isMounted.current = true;

    if (Platform.OS === 'android') {
      // .catch() prevents an unhandled-promise-rejection crash if the Android
      // notifications system is unavailable (e.g., emulator without Play Services).
      Notifications.setNotificationChannelAsync('wasel-trips', {
        name: 'Wasel Trip Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      }).catch((e: unknown) => console.warn('[notifications] channel setup failed:', e));
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

  // ── AppState: reconnect Supabase Realtime on foreground resume ───────────────
  // On real devices, the app going to background causes the WebSocket connection
  // to drop. Without reconnection, the driver never receives new trip offers after
  // the device screen turns off and back on, and the active-trip subscription goes
  // silent — the UI freezes on the last known status.
  // We avoid reaching into private Supabase internals (`realtime.connect()`)
  // because those can break between SDK minor versions. Instead we bump a
  // `reconnectTick` state on foreground resume, which is in the dependency
  // array of every subscribe effect. Each effect's existing cleanup tears
  // down its channel and the re-run re-creates it via the public API
  // (`supabase.channel(...).subscribe(...)`).
  const [reconnectTick, setReconnectTick] = useState(0);
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (
        (prev === 'background' || prev === 'inactive') &&
        nextState === 'active'
      ) {
        setReconnectTick((n) => n + 1);
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // Keep currentTripRef in sync so the offer handler can check it synchronously
  // without depending on stale closure values.
  useEffect(() => { currentTripRef.current = currentTrip; }, [currentTrip]);

  // Keep mapReadyRef in sync with the mapReady state
  useEffect(() => { mapReadyRef.current = mapReady; }, [mapReady]);

  // Keep locationRef in sync so map callbacks always use the latest GPS fix
  // instead of a stale closure value captured at effect-creation time.
  useEffect(() => { locationRef.current = location; }, [location]);

  // ── Session helper — one place to get the auth token ─────────────────────
  // Reads synchronously from the ref kept in sync by onAuthStateChange.
  // Callers that were written as `await getToken()` still work correctly —
  // awaiting a non-Promise value is a no-op in JS.
  const getToken = useCallback((): string | null => {
    return getAccessToken();
  }, [getAccessToken]);

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

  // ── Driver bootstrap: profile fetch + active-trip restore ────────────────
  //
  // Coherent policy (mirror image of rider-side bootstrap in home.tsx):
  //   1. Load driver profile (tier, approval, DB is_online).
  //   2. GET /trips/driver-active. If a live trip exists, RESTORE it — a driver
  //      who relaunches mid-trip must continue the ride so the rider is not
  //      stranded. Force is_online=true + is_available=false so the dispatch
  //      engine does not route offers during the trip.
  //   3. If no active trip, the driver starts OFFLINE. If the DB still says
  //      is_online=true from a crashed prior session, reset it so dispatch
  //      stops sending offers to a closed app.
  //
  // Profile + restore are consolidated into a single effect so the is_online
  // PATCH is never issued twice in conflicting directions during the same boot.
  useEffect(() => {
    if (!user) return;

    // Crash-loop breaker short-circuit: if we just exited recovery (or are
    // in it), do NOT call /api/trips/driver-active. That restore path is
    // the exact surface a previous launch crashed on. Mount the map and
    // mark bootstrap done so the user has a functional offline dashboard.
    if (shouldSkipRestore) {
      markBootstrapDone();
      setShouldMountMap(true);
      return;
    }

    (async () => {
      try {
        const token = await getToken();
        if (!token || !isMounted.current) return;

        // Fetch profile and active trip in parallel — they're independent reads.
        const [meRes, activeRes] = await Promise.all([
          fetch(`${API_URL}/api/drivers/me`,         { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/api/trips/driver-active`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!isMounted.current) return;

        const me         = meRes.ok     ? await meRes.json()     : null;
        const activeTrip = activeRes.ok ? await activeRes.json() : null;
        if (!isMounted.current) return;

        if (me) {
          setSubscriptionTier(me.subscription_tier ?? 1);
          setIsApproved(me.is_approved ?? false);
        }

        // Client-side policy (defence-in-depth; backend also enforces):
        //   - Must have valid pickup/dropoff coords
        //   - Status must be in the LIVE whitelist
        // If any guard fails, do NOT restore — start offline so the dispatch
        // engine can't send offers to a wedged driver UI.
        const LIVE_STATUSES: TripStatus[] = ['accepted', 'en_route', 'arrived', 'in_progress'];
        const hasValidCoords =
          typeof activeTrip?.pickup_lat === 'number' && isFinite(activeTrip.pickup_lat) &&
          typeof activeTrip?.pickup_lng === 'number' && isFinite(activeTrip.pickup_lng) &&
          typeof activeTrip?.dropoff_lat === 'number' && isFinite(activeTrip.dropoff_lat) &&
          typeof activeTrip?.dropoff_lng === 'number' && isFinite(activeTrip.dropoff_lng);
        // Trip age is deliberately NOT part of the restore gate: legitimate
        // long rides can exceed 30-60 min and must restore cleanly. Backend is
        // authoritative — if it returned a live trip with valid coords, restore.
        const isRestorable =
          activeTrip?.id &&
          LIVE_STATUSES.includes(activeTrip?.status) &&
          hasValidCoords;

        if (isRestorable) {
          // Live trip restore. Suppress the trip-update channel's subscribe()
          // catch-up fetch for 3 s so it doesn't race against this restore.
          justRestoredRef.current = true;
          setTimeout(() => { justRestoredRef.current = false; }, 3000);

          // Set the ref synchronously so any Realtime callback in flight sees
          // the restored trip as "current" and doesn't wrongly ignore events.
          currentTripRef.current = { id: activeTrip.id, status: activeTrip.status as TripStatus };
          setCurrentTrip({ id: activeTrip.id, status: activeTrip.status as TripStatus });
          setIsOnline(true);

          // Re-assert online+unavailable on the DB in case a crash left the
          // driver's row in a weird state. Fire-and-forget — idempotent anyway.
          fetch(`${API_URL}/api/drivers/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ is_online: true, is_available: false }),
          }).catch(() => {});
        } else if (me?.is_online === true) {
          // Fresh state with stale is_online flag. Driver UI starts offline; sync DB.
          fetch(`${API_URL}/api/drivers/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ is_online: false, is_available: false }),
          }).catch(() => {});
        }
      } catch { /* non-fatal — bootstrap failure does not block the UI */ }
      finally {
        // Whatever happened above, the bootstrap decision is final. Mount
        // the map and tell the crash-loop breaker bootstrap is complete so
        // the healthy-checkpoint timer can start.
        if (isMounted.current) {
          setShouldMountMap(true);
          markBootstrapDone();
        }
      }
    })();
  }, [user, getToken, shouldSkipRestore]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Initial location on mount ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!isMounted.current) return;
        const { latitude, longitude } = loc.coords;
        // GPS can hand back NaN on the simulator or during a poor fix. The
        // MapView native layer crashes on non-finite values on Android.
        if (!isFinite(latitude) || !isFinite(longitude)) return;
        const coords = { latitude, longitude };
        setLocation(coords);
        // Defer animateToRegion until onMapReady has fired. State (not ref)
        // so the applying effect re-runs whichever order things land in.
        setPendingInitialRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
      } catch { /* location unavailable */ }
    })();
  }, []);

  // Apply the stashed initial region once the native map layer is ready.
  // Handles both orderings (GPS→mapReady or mapReady→GPS).
  useEffect(() => {
    if (!mapReady || !pendingInitialRegion) return;
    mapRef.current?.animateToRegion(pendingInitialRegion, 800);
    setPendingInitialRegion(null);
  }, [mapReady, pendingInitialRegion]);

  // ── Continuous location updates while online (watchPosition = no manual polling) ──
  useEffect(() => {
    if (!isOnline) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    // AbortController terminates any in-flight `fetch` PATCH when the effect
    // tears down (driver toggles offline, unmounts, or logs out). Without this
    // the native request can complete on a dead component and throw an
    // unhandled promise rejection on iOS — with New Arch off that's benign
    // but it still fires telemetry and has in rare cases been observed to
    // tombstone the bridge if it races with an RCTModule release.
    const abortController = new AbortController();

    (async () => {
      try {
        // Request foreground permission first (required on iOS before background).
        const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        // Distinguish permission states — iOS may return 'denied', 'restricted'
        // (MDM/parental lock), 'limited' (approximate only), or 'undetermined'.
        // Anything other than 'granted' means we can't start the watcher, but
        // we continue without alerting — driver will see "waiting for trips"
        // and figure it out. A future UX pass should prompt the user.
        if (fgStatus !== 'granted') {
          console.warn('[location] foreground permission not granted:', fgStatus);
          return;
        }

        // Background permission only makes sense in a dev-client / standalone build.
        // Expo Go's Info.plist does NOT declare NSLocationAlwaysAndWhenInUseUsageDescription
        // or UIBackgroundModes=['location'], so the native request either throws
        // synchronously OR emits an unhandled native promise rejection on iOS that
        // can crash the app under the New Architecture. Skip entirely in Expo Go.
        if (!IS_EXPO_GO) {
          try {
            await Location.requestBackgroundPermissionsAsync();
          } catch (bgErr) {
            console.warn('[location] background permission unavailable (foreground-only mode):', bgErr);
          }
        }

        if (cancelled) return;

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 10_000,
            distanceInterval: 30,
          },
          async (loc) => {
            // Guard: bail out immediately if effect was cleaned up or component
            // unmounted — this callback fires from a native thread and can arrive
            // after cleanup on real devices (background/foreground cycle).
            if (cancelled || !isMounted.current) return;

            // Validate coordinates before using them — GPS can return NaN/Infinity
            // on some devices when the fix is transitioning.
            const { latitude: lat, longitude: lng } = loc.coords;
            if (!isFinite(lat) || !isFinite(lng)) return;

            setLocation({ latitude: lat, longitude: lng });

            try {
              // Read token synchronously — no async gap means no window where the
              // effect can be cleaned up between the await and the token read.
              const token = getAccessToken();
              if (!token || cancelled || !isMounted.current) return;
              await fetch(`${API_URL}/api/drivers/location`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ lat, lng }),
                signal: abortController.signal,
              });
            } catch (err) {
              // AbortError is expected on cleanup — swallow silently.
              if (err instanceof Error && err.name === 'AbortError') return;
              console.warn('[location] PATCH failed:', err);
            }
          },
        );
      } catch (err) {
        console.warn('[location] setup failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
      abortController.abort();
    };
  }, [isOnline]);

  // ── Fetch trip details + rider contact when trip accepted ─────────────────
  useEffect(() => {
    if (!currentTrip) {
      setRiderInfo(null);
      setTripDetails(null);
      return;
    }

    // didCancel is set to true by the cleanup function below.
    // Every async continuation checks it before touching React state or the
    // MapView — this prevents the race condition where a cancel clears the trip
    // but the in-flight fetch completes afterwards and re-sets tripDetails
    // (which would then fire fitToCoordinates in an inconsistent state and
    // crash the native MapView on Android).
    let didCancel = false;

    (async () => {
      try {
        const token = await getToken();
        if (!token || didCancel || !isMounted.current) return;

        const tripRes = await fetch(`${API_URL}/api/trips/${currentTrip.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!tripRes.ok || didCancel || !isMounted.current) return;

        const d = await tripRes.json();
        if (didCancel || !isMounted.current) return;

        // Normalize coordinates at the trust boundary. `finiteLatLng` returns
        // null for NaN/Infinity/null/undefined/non-numbers/(0,0). Every
        // render and map command downstream checks for null only — they no
        // longer have to think about what counts as "valid".
        const safePickup  = finiteLatLng(d.pickup_lat,  d.pickup_lng);
        const safeDropoff = finiteLatLng(d.dropoff_lat, d.dropoff_lng);

        setTripDetails({
          pickup_address:  d.pickup_address  ?? 'Pickup location',
          dropoff_address: d.dropoff_address ?? 'Dropoff location',
          fare_amount:     d.fare_amount != null ? `${d.fare_amount} JD` : '',
          pickup_lat:  safePickup?.latitude  ?? null,
          pickup_lng:  safePickup?.longitude ?? null,
          dropoff_lat: safeDropoff?.latitude ?? null,
          dropoff_lng: safeDropoff?.longitude ?? null,
        });

        // Delayed map-fit: only fire if ALL of these still hold when the
        // timeout elapses:
        //   - the fetch was not cancelled (trip didn't change under us)
        //   - the component is still mounted
        //   - the native map layer has fired onMapReady
        //   - mapRef.current exists (sanity check)
        //   - the same trip is still current (prevents a fit on the NEW trip's
        //     screen using coords from the OLD trip)
        //   - pickup coord is finite
        //   - the driver's current location (if any) is finite and within 200 km
        // Any missed gate = skip. A skipped fit degrades to the user seeing the
        // already-set initialRegion, which is visually acceptable — calling
        // fitToCoordinates with stale/invalid state is a native crash.
        if (safePickup) {
          const savedTripId = currentTrip.id;
          setTimeout(() => {
            if (didCancel || !isMounted.current) return;
            if (!mapReadyRef.current) return;
            if (!mapRef.current) return;
            if (currentTripRef.current?.id !== savedTripId) return;

            const currentLoc = locationRef.current;
            const driverLocValid =
              currentLoc != null &&
              isFinite(currentLoc.latitude) && isFinite(currentLoc.longitude);

            // Only fit both points if the driver is within 200 km of pickup.
            // Otherwise fitToCoordinates would span the globe and produce an
            // extreme zoom-out that has been observed to crash MapView
            // natively on both iOS and Android.
            const nearPickup =
              driverLocValid &&
              haversineKm(
                currentLoc.latitude, currentLoc.longitude,
                safePickup.latitude, safePickup.longitude,
              ) < 200;

            try {
              if (nearPickup && driverLocValid) {
                mapRef.current.fitToCoordinates(
                  [currentLoc, safePickup],
                  {
                    edgePadding: { top: 100, right: 60, bottom: 320, left: 60 },
                    animated: true,
                  },
                );
              } else {
                mapRef.current.animateToRegion(
                  { ...safePickup, latitudeDelta: 0.02, longitudeDelta: 0.02 },
                  600,
                );
              }
            } catch (mapErr) {
              // Native map call rejected — swallow. The UI still renders the
              // trip panel; the map just won't auto-fit this time.
              console.warn('[dashboard] map fit/animate rejected:', mapErr);
            }
          }, 500);
        }

        if (didCancel || !isMounted.current) return;

        const contactRes = await fetch(`${API_URL}/api/trips/${currentTrip.id}/contact`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!contactRes.ok || didCancel || !isMounted.current) return;

        const c = await contactRes.json();
        if (didCancel || !isMounted.current) return;
        if (c.role === 'rider') {
          setRiderInfo({ name: c.name ?? 'Rider', phone: c.phone ?? null });
        }
      } catch { /* non-fatal */ }
    })();

    // Cleanup: signal all pending async work to abort so stale fetches cannot
    // call setState or trigger map operations after this trip is cleared.
    return () => { didCancel = true; };
  }, [currentTrip?.id, getToken]);

  // ── Realtime: rider cancels active trip ───────────────────────────────────
  useEffect(() => {
    if (!currentTrip) return;

    // Tear down any pre-existing channel with the same name before creating a
    // new one. In React Strict Mode (dev) effects run twice, and a fast
    // double-restore can leave two subscriptions alive for the same trip ID —
    // both handlers would fire on every CDC event, clearing state or showing
    // the "rider cancelled" alert twice.
    //
    // NOTE: supabase-js prefixes channel topics internally as "realtime:<name>",
    // so we compare against both forms to handle all client versions correctly.
    const channelName = `trip-updates-${currentTrip.id}`;
    const existing = supabase.getChannels().find(
      c => c.topic === channelName || c.topic === `realtime:${channelName}`,
    );
    if (existing) supabase.removeChannel(existing);

    const channel = supabase
      .channel(channelName)
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
            // Only show the "rider cancelled" alert when the cancellation came
            // from the rider. driverCancelledRef is set true in advanceTripStatus
            // before the cancel network call, so the CDC echo back to this
            // subscription is expected and should be silent.
            if (!driverCancelledRef.current) {
              Alert.alert('Trip Cancelled', 'The rider has cancelled this trip.');
            }
            driverCancelledRef.current = false;
          }
        } catch { /* guard against malformed payload */ }
      })
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch { /* ignore — channel may already be gone */ }
    };
  }, [currentTrip?.id, reconnectTick]);

  // ── Realtime: incoming trip offers ───────────────────────────────────────
  // Dependency is user?.id (UUID string) not the user object — the user object
  // gets a new reference on every Supabase token refresh (~hourly), which would
  // tear down and recreate the channel and silently drop offers during the gap.
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id; // stable local copy for the closure

    // Deduplication guard: remove any existing channel with this name before
    // creating a new one. On real devices, effect cleanup sometimes races with
    // the new effect (fast remount), leaving two subscriptions alive and causing
    // duplicate offer modals and double-state mutations.
    const offersChannelName = `driver-offers-${userId}`;
    const existingOffers = supabase.getChannels().find(
      c => c.topic === offersChannelName || c.topic === `realtime:${offersChannelName}`,
    );
    if (existingOffers) {
      try { supabase.removeChannel(existingOffers); } catch { /* ignore */ }
    }

    const channel = supabase
      .channel(offersChannelName)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'trip_offers',
        filter: `driver_id=eq.${userId}`,
      }, (payload) => {
        // Wrap the entire async handler — an unhandled rejection here crashes iOS
        (async () => {
          try {
            const offerData = payload.new;
            if (!offerData?.trip_id) return;

            // Fetch trip data via the backend API instead of querying Supabase
            // directly. Direct Supabase queries use the user's JWT and are subject
            // to Row-Level Security — if the RLS policy requires driver_id to
            // already match auth.uid(), a timing race (dispatch engine hasn't
            // committed the UPDATE yet) can return null and silently drop the offer.
            // The backend endpoint uses the service-role client (bypasses RLS) and
            // also verifies that this driver is the assigned one.
            const token = await getToken();
            if (!token) return;
            const tripRes = await fetch(`${API_URL}/api/trips/${offerData.trip_id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!tripRes.ok) return;
            const trip = await tripRes.json();

            // Don't show a new offer if driver is already on an active trip —
            // the backend should prevent this, but guard here for the race window.
            if (!trip || !isMounted.current || currentTripRef.current) return;

            try {
              // iOS only supports a single vibration pulse (ignores duration/pattern).
              // Android supports vibration patterns. Both wrapped in try/catch because
              // vibration can throw on devices without a vibrator or in silent mode.
              if (Platform.OS === 'android') {
                Vibration.vibrate([0, 400, 200, 400]);
              } else {
                // On iOS, Vibration.vibrate() ignores the argument — just call it.
                // Do NOT pass an array on iOS — it causes an unhandled rejection crash
                // on some iOS versions due to a React Native bridge type mismatch.
                Vibration.vibrate();
              }
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
              pickup_lat:       trip.pickup_lat  ?? null,
              pickup_lng:       trip.pickup_lng  ?? null,
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
    return () => {
      try { supabase.removeChannel(channel); } catch { /* ignore — channel may already be gone */ }
    };
  }, [user?.id, reconnectTick]);

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
    // ── Going OFFLINE ────────────────────────────────────────────────────────
    // Optimistic update is safe here — worst case the API call fails and the
    // driver sees themselves as offline while the backend still has them online,
    // which is a better UX than appearing stuck in a "going offline…" state.
    if (!value) {
      setIsOnline(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setOffer(null);
      try {
        const token = await getToken();
        if (token) {
          await fetch(`${API_URL}/api/drivers/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ is_online: false, is_available: false }),
          });
        }
      } catch { /* silent — UI is already offline */ }
      return;
    }

    // ── Going ONLINE ─────────────────────────────────────────────────────────
    // Check location permission BEFORE marking the driver online in the backend.
    // Without location access the position watcher can't start, the backend
    // never receives fresh coordinates, and dispatch will never find this driver.
    const { status: existingPerm } = await Location.getForegroundPermissionsAsync();
    if (existingPerm !== 'granted') {
      const { status: newPerm } = await Location.requestForegroundPermissionsAsync();
      if (newPerm !== 'granted') {
        Alert.alert(
          'Location Required',
          'Wasel needs your location to send you trips. Please enable Location in Settings.',
          [{ text: 'OK' }],
        );
        return; // Don't go online — driver sees switch snap back to Off
      }
    }

    // Only set isOnline=true AFTER the backend confirms the update.
    // This avoids starting the location watcher before the backend is ready.
    try {
      const token = await getToken();
      if (!token) { Alert.alert('Error', 'Session expired. Please sign in again.'); return; }
      const res = await fetch(`${API_URL}/api/drivers/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_online: true, is_available: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (isMounted.current) setIsOnline(true);
    } catch {
      if (isMounted.current) {
        Alert.alert('Could not go online', 'Check your connection and try again.');
      }
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
      // Guard: don't call Alert.alert after unmount — triggers a native bridge
      // null-pointer crash on Android if the JS context is being torn down.
      if (isMounted.current) {
        Alert.alert('Could not accept trip', 'The offer may have expired. Please try again.');
      }
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
    // Snapshot trip ID and full UI state before any async gap.
    const tripId           = currentTrip.id;
    const savedTrip        = currentTrip;
    const savedRiderInfo   = riderInfo;
    const savedTripDetails = tripDetails;

    // Optimistic clear for cancel: hide the trip panel immediately rather than
    // waiting 1-2s for the network round-trip (gives instant UI feedback).
    // Also set driverCancelledRef so the CDC echo back to the Realtime
    // subscription doesn't show "The rider has cancelled this trip."
    if (nextStatus === 'cancelled') {
      driverCancelledRef.current = true;
      setCurrentTrip(null);
      setRiderInfo(null);
      setTripDetails(null);
    }
    try {
      const token = await getToken();
      if (!token) throw new Error('No session — please sign in again.');
      const res = await fetch(`${API_URL}/api/trips/${tripId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server error (HTTP ${res.status})`);
      }
      if (!isMounted.current) return;
      if (nextStatus === 'completed') {
        setRatingTripId(tripId);
        setRatingStars(0);
        setShowRatingModal(true);
        setCurrentTrip(null);
        setRiderInfo(null);
        setTripDetails(null);
      } else if (nextStatus === 'cancelled') {
        // State was already cleared optimistically above.
        // Reset the flag after a short delay so the CDC echo for this cancel
        // is silently ignored first — then future rider-cancels alert properly.
        setTimeout(() => { driverCancelledRef.current = false; }, 4000);
      } else {
        setCurrentTrip({ id: tripId, status: nextStatus as TripStatus });
      }
    } catch (err: unknown) {
      // Guard: if the component unmounted while the network call was in-flight
      // (e.g., session expiry triggered navigation), skip the Alert and setState
      // calls — calling Alert.alert after the JS context is being torn down
      // causes a native bridge null-pointer crash on Android.
      if (!isMounted.current) return;

      const msg = err instanceof Error ? err.message : 'Please try again.';

      if (nextStatus === 'cancelled') {
        // If the backend says the trip is already in a terminal state, the trip
        // is gone regardless — silently accept it and stay cleared.
        // This prevents the "Cannot transition from 'cancelled' to 'cancelled'"
        // infinite loop where the catch block kept restoring a dead trip to screen.
        const alreadyTerminal =
          msg.includes("Cannot transition from 'cancelled'") ||
          msg.includes("Cannot transition from 'completed'") ||
          msg.includes('Trip not found');

        if (alreadyTerminal) {
          // Trip is already done. driverCancelledRef was set true before the call,
          // reset it after the CDC window so future rider-cancels alert correctly.
          setTimeout(() => { driverCancelledRef.current = false; }, 4000);
          return; // UI already cleared optimistically — nothing more to do
        }

        // Real failure (network error, auth, server error) — restore the trip
        // panel so the driver can see the booking and retry the cancel.
        driverCancelledRef.current = false;
        setCurrentTrip(savedTrip);
        setRiderInfo(savedRiderInfo);
        setTripDetails(savedTripDetails);
      }

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
      {/* Deferred MapView mount: show a pure black fill until bootstrap has
          completed (shouldMountMap = true). Keeps first-frame work minimal
          and avoids compounding a bootstrap crash with a simultaneous
          MapView native init on the same frame. */}
      {!shouldMountMap && <View style={[styles.map, { backgroundColor: '#0A0A0A' }]} />}
      {shouldMountMap && (
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={IS_EXPO_GO ? undefined : PROVIDER_GOOGLE}
        initialRegion={{ ...AMMAN, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation={false}
        // customMapStyle applied only on Android. On iOS under PROVIDER_GOOGLE
        // the large style JSON gets serialised across the bridge on every
        // re-render and has been observed to trigger MapView native aborts
        // during rapid state churn (trip restore + live updates). Android's
        // native Google Maps SDK handles style JSON as a first-class arg and
        // is stable. Styled iOS is a future nice-to-have, not a release goal.
        customMapStyle={Platform.OS === 'android' && !IS_EXPO_GO ? DARK_MAP_STYLE : undefined}
        onMapReady={() => setMapReady(true)}
      >
        {/* Gate ALL map children on mapReady — adding Markers/Polylines before
            the native map layer fires onMapReady causes native crashes. */}
        {mapReady && location && (
          <Marker coordinate={location}>
            <View style={styles.driverMarker}><View style={styles.driverMarkerDot} /></View>
          </Marker>
        )}
        {mapReady && tripDetails?.pickup_lat != null && tripDetails?.pickup_lng != null && (
          <Marker
            coordinate={{ latitude: tripDetails.pickup_lat, longitude: tripDetails.pickup_lng }}
            title="Pickup" pinColor="#F5A623"
          />
        )}
        {mapReady && currentTrip?.status === 'in_progress' &&
          tripDetails?.dropoff_lat != null && tripDetails?.dropoff_lng != null && (
          <Marker
            coordinate={{ latitude: tripDetails.dropoff_lat, longitude: tripDetails.dropoff_lng }}
            title="Dropoff" pinColor="#4CAF50"
          />
        )}
        {mapReady && location &&
          tripDetails?.pickup_lat != null && tripDetails?.pickup_lng != null &&
          (currentTrip?.status === 'accepted' || currentTrip?.status === 'en_route') && (
          <Polyline
            coordinates={[location, { latitude: tripDetails.pickup_lat, longitude: tripDetails.pickup_lng }]}
            strokeColor="#F5A623" strokeWidth={3} lineDashPattern={[6, 3]}
          />
        )}
        {mapReady && currentTrip?.status === 'in_progress' &&
          tripDetails?.pickup_lat != null && tripDetails?.pickup_lng != null &&
          tripDetails?.dropoff_lat != null && tripDetails?.dropoff_lng != null && (
          <Polyline
            coordinates={[
              { latitude: tripDetails.pickup_lat,  longitude: tripDetails.pickup_lng },
              { latitude: tripDetails.dropoff_lat, longitude: tripDetails.dropoff_lng },
            ]}
            strokeColor="#4CAF50" strokeWidth={3} lineDashPattern={[8, 4]}
          />
        )}
      </MapView>
      )}

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
                  style={[styles.goOnlineBtn, !isApproved && styles.goOnlineBtnDisabled]}
                  onPress={() => isApproved && toggleOnline(true)}
                  activeOpacity={isApproved ? 0.85 : 1}
                >
                  <Ionicons name="power" size={20} color="#000" />
                  <Text style={styles.goOnlineBtnText}>Go Online</Text>
                </TouchableOpacity>
                {!isApproved && (
                  <Text style={styles.pendingApprovalText}>Account pending approval</Text>
                )}
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
                    onPress={() => {
                      // .catch() required — Linking.openURL rejects on Android when
                      // the tel: URL is empty/invalid, crashing the JS thread if unhandled.
                      if (riderInfo.phone) {
                        Linking.openURL(`tel:${riderInfo.phone}`).catch(() => {});
                      }
                    }}
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

            {currentTrip && ['accepted', 'en_route'].includes(currentTrip.status) &&
              tripDetails?.pickup_lat != null && tripDetails?.pickup_lng != null && (
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => openNavigation(
                  tripDetails.pickup_lat as number,
                  tripDetails.pickup_lng as number,
                )}
                activeOpacity={0.8}
              >
                <Ionicons name="navigate-outline" size={18} color="#000" />
                <Text style={styles.navBtnTxt}>Navigate</Text>
              </TouchableOpacity>
            )}

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
  goOnlineBtnDisabled: { opacity: 0.4 },
  pendingApprovalText: { color: '#F5A623', fontSize: 12, textAlign: 'center', marginTop: 8 },

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

  // Navigate button
  navBtn: {
    backgroundColor: '#F5A623',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 8,
  },
  navBtnTxt: {
    color: '#000',
    fontWeight: '700',
    fontSize: 15,
  },
});
