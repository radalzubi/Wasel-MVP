import { supabase } from '../lib/supabase';
import { haversineKm } from './geo';
import { bmpScore, DriverCandidate } from './scoring';

const OFFER_TIMEOUT_SECONDS = 15;
const MAX_SEARCH_RADIUS_KM = 10;
const MAX_DISPATCH_ROUNDS = 5; // prevent infinite loop if many drivers decline

export async function dispatchTrip(
  tripId: string,
  pickupLat: number,
  pickupLng: number,
  round = 0,
): Promise<string | null> {
  // Safety valve: cancel after too many failed rounds
  if (round >= MAX_DISPATCH_ROUNDS) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  // Determine which drivers already received an offer for this trip (skip them)
  const { data: previousOffers } = await supabase
    .from('trip_offers')
    .select('driver_id')
    .eq('trip_id', tripId);

  const alreadyOffered = new Set((previousOffers || []).map((o) => o.driver_id));

  // Re-query live availability every round so driver status is fresh
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, current_location, subscription_tier, activity_score, idle_time_minutes')
    .eq('is_online', true)
    .eq('is_available', true);

  if (error || !drivers?.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  type ScoredDriver = { driverId: string; score: number };

  const scored: ScoredDriver[] = drivers
    .filter((d) => !alreadyOffered.has(d.id))
    .map((d) => {
      const coords = d.current_location?.coordinates as [number, number] | undefined;
      if (!coords) return null;
      const [lng, lat] = coords;
      const distKm = haversineKm(pickupLat, pickupLng, lat, lng);
      if (distKm > MAX_SEARCH_RADIUS_KM) return null;

      const candidate: DriverCandidate = {
        id: d.id,
        subscription_tier: ((d.subscription_tier ?? 1) as 1 | 2 | 3),
        activity_score: d.activity_score ?? 0.5,
        idle_time_minutes: d.idle_time_minutes ?? 0,
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
    status: 'dispatching',
    driver_id: winner.driverId,
    bmp_score: winner.score,
  }).eq('id', tripId);

  const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();

  await supabase.from('trip_offers').insert({
    trip_id: tripId,
    driver_id: winner.driverId,
    expires_at: expiresAt,
  });

  // Auto-expire and recursively re-dispatch if the driver doesn't respond
  setTimeout(async () => {
    const { data: offer } = await supabase
      .from('trip_offers')
      .select('status')
      .eq('trip_id', tripId)
      .eq('driver_id', winner.driverId)
      .single();

    if (offer?.status === 'pending') {
      await supabase.from('trip_offers')
        .update({ status: 'expired' })
        .eq('trip_id', tripId)
        .eq('driver_id', winner.driverId);

      // Next round: re-query fresh availability, skip all previously offered drivers
      dispatchTrip(tripId, pickupLat, pickupLng, round + 1).catch(console.error);
    }
  }, OFFER_TIMEOUT_SECONDS * 1000);

  return winner.driverId;
}
