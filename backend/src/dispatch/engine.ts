import { supabaseAdmin as supabase } from '../lib/supabase';
import { haversineKm } from './geo';
import { bmpScore, DriverCandidate } from './scoring';

const OFFER_TIMEOUT_SECONDS = 15;
const MAX_SEARCH_RADIUS_KM  = 10;

// In development, ignore geographic distance so cross-region testing works
// (e.g. driver in Indiana, rider in Amman).  Production always uses the real radius.
const EFFECTIVE_RADIUS_KM =
  process.env.NODE_ENV === 'development' ? 99_999 : MAX_SEARCH_RADIUS_KM;

// P6: Maximum dispatch rounds before a trip is auto-cancelled.
// Exported so the poller and dispatchTrip use the same constant.
export const MAX_DISPATCH_ROUNDS = 5;

// P6: How often the DB poller checks for expired pending offers.
const POLLER_INTERVAL_MS = 5_000;

// ----------------------------------------------------------------
// dispatchTrip
//
// Single-shot: finds the best available driver for the given trip,
// creates a trip_offer row, and returns the driverId (or null if
// no suitable driver was found).
//
// P6: The function no longer schedules its own retry via setTimeout.
//     Retry / expiry logic is owned by startDispatchPoller() below.
//     This makes it restart-safe: if the process dies mid-dispatch,
//     the poller will pick up the expired offer on next restart.
//
// P5: Subscription tier is now derived from the subscriptions table
//     (active subscription with the highest tier).  drivers.subscription_tier
//     is used as a fallback when no paid subscription row exists.
// ----------------------------------------------------------------
export async function dispatchTrip(
  tripId: string,
  pickupLat: number,
  pickupLng: number,
): Promise<string | null> {
  // Guard: only dispatch if the trip is still in a dispatchable state.
  const { data: currentTrip } = await supabase
    .from('trips')
    .select('status')
    .eq('id', tripId)
    .in('status', ['requested', 'dispatching'])
    .maybeSingle();

  if (!currentTrip) return null; // trip was accepted, cancelled, or not found

  // Determine which drivers already received an offer for this trip (skip them)
  const { data: previousOffers } = await supabase
    .from('trip_offers')
    .select('driver_id')
    .eq('trip_id', tripId);

  const alreadyOffered = new Set((previousOffers || []).map((o) => o.driver_id));

  // Re-query live availability every round so driver status is fresh
  // Select plain float columns for coordinates: Supabase REST returns PostGIS
  // geometry (current_location) as a WKB hex string, not as a GeoJSON object,
  // so we cannot use `.coordinates` on it directly.  The location_lat/location_lng
  // plain columns are maintained alongside the geometry column by the PATCH
  // /api/drivers/location endpoint and are always safe to use in JS arithmetic.
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, location_lat, location_lng, subscription_tier, activity_score, became_available_at')
    .eq('is_online', true)
    .eq('is_available', true);

  if (error || !drivers?.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  // P5: Look up active subscription tiers for all candidate drivers.
  // A driver may have a paid subscription with a higher tier than their
  // drivers.subscription_tier default.  We take the highest active tier.
  const driverIds = drivers.map((d) => d.id);
  const now = new Date().toISOString();
  const { data: activeSubs } = await supabase
    .from('subscriptions')
    .select('driver_id, tier')
    .gt('expires_at', now)
    .in('driver_id', driverIds);

  // Build a map: driverId → highest active subscription tier
  const activeSubTier = new Map<string, number>();
  for (const sub of activeSubs ?? []) {
    const current = activeSubTier.get(sub.driver_id) ?? 0;
    if (sub.tier > current) activeSubTier.set(sub.driver_id, sub.tier);
  }

  type ScoredDriver = { driverId: string; score: number };

  const scored: ScoredDriver[] = drivers
    .filter((d) => !alreadyOffered.has(d.id))
    .map((d) => {
      if (d.location_lat == null || d.location_lng == null) return null;
      const distKm = haversineKm(pickupLat, pickupLng, d.location_lat, d.location_lng);
      if (distKm > EFFECTIVE_RADIUS_KM) return null;

      // P5: Effective tier = active subscription tier if present,
      //     otherwise fall back to the column value (admin-set default).
      const effectiveTier = (activeSubTier.get(d.id) ?? d.subscription_tier ?? 1) as 1 | 2 | 3;

      // P5: Real idle time derived from became_available_at instead of the
      //     stale idle_time_minutes column that was never updated.
      const idleMinutes = d.became_available_at
        ? (Date.now() - new Date(d.became_available_at).getTime()) / 60_000
        : 0;

      const candidate: DriverCandidate = {
        id:                d.id,
        subscription_tier: effectiveTier,
        activity_score:    d.activity_score ?? 0.5,
        idle_time_minutes: idleMinutes,
      };

      return { driverId: d.id, score: bmpScore(candidate, distKm) };
    })
    .filter((d): d is ScoredDriver => d !== null)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  const winner = scored[0];

  await supabase.from('trips').update({
    status:    'dispatching',
    driver_id: winner.driverId,
    bmp_score: winner.score,
  }).eq('id', tripId);

  const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1_000).toISOString();

  await supabase.from('trip_offers').insert({
    trip_id:    tripId,
    driver_id:  winner.driverId,
    expires_at: expiresAt,
  });

  // No setTimeout here — the poller owns the retry lifecycle (P6).
  return winner.driverId;
}

// ----------------------------------------------------------------
// startDispatchPoller — P6: DB-based offer expiry and retry
//
// Replaces the recursive setTimeout chain that was previously inside
// dispatchTrip.  By polling the database every POLLER_INTERVAL_MS:
//
//   1. Process restarts no longer lose in-flight dispatches — the
//      poller will pick up any pending-but-expired offer on startup.
//
//   2. Multi-instance safety: the offer row is updated with an
//      optimistic WHERE status='pending' check, so only the first
//      instance to acquire the row will proceed with re-dispatch.
//
// Call this exactly once from index.ts after the server starts.
// ----------------------------------------------------------------
export function startDispatchPoller(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const now = new Date().toISOString();

      // Find all pending offers that have passed their expiry time.
      const { data: expiredOffers, error: queryErr } = await supabase
        .from('trip_offers')
        .select('id, trip_id, driver_id')
        .eq('status', 'pending')
        .lt('expires_at', now);

      if (queryErr) {
        console.error('[dispatch-poller] query error:', queryErr.message);
        return;
      }
      if (!expiredOffers?.length) return;

      for (const offer of expiredOffers) {
        // Atomically mark the offer as expired.
        // The .eq('status', 'pending') guard prevents double-processing on
        // multi-instance deployments or back-to-back poller ticks.
        const { data: updatedRows } = await supabase
          .from('trip_offers')
          .update({ status: 'expired' })
          .eq('id', offer.id)
          .eq('status', 'pending')
          .select('id');

        if (!updatedRows?.length) continue; // another instance or tick already handled this

        // Only continue if the trip is still waiting for a driver.
        const { data: trip } = await supabase
          .from('trips')
          .select('status, pickup_lat, pickup_lng')
          .eq('id', offer.trip_id)
          .eq('status', 'dispatching') // terminal guard
          .maybeSingle();

        if (!trip) continue; // trip was accepted, cancelled, or not found

        // Count all offers (any status) for this trip to determine round number.
        const { count: offerCount } = await supabase
          .from('trip_offers')
          .select('*', { count: 'exact', head: true })
          .eq('trip_id', offer.trip_id);

        if ((offerCount ?? 0) >= MAX_DISPATCH_ROUNDS) {
          // All rounds exhausted — cancel the trip.
          await supabase.from('trips')
            .update({ status: 'cancelled' })
            .eq('id', offer.trip_id);
          console.log(`[dispatch-poller] trip ${offer.trip_id} cancelled — exhausted ${MAX_DISPATCH_ROUNDS} rounds`);
          continue;
        }

        // Re-dispatch to the next best available driver.
        dispatchTrip(offer.trip_id, trip.pickup_lat, trip.pickup_lng)
          .catch((err) => console.error('[dispatch-poller] re-dispatch error:', err));
      }
    } catch (err) {
      console.error('[dispatch-poller] unexpected error:', err);
    }
  }, POLLER_INTERVAL_MS);
}
