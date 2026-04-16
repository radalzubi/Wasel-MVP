import { supabase } from '../lib/supabase';
import { haversineKm } from './geo';
import { bmpScore, DriverCandidate } from './scoring';

const OFFER_TIMEOUT_SECONDS = 15;
const MAX_SEARCH_RADIUS_KM = 10;

export async function dispatchTrip(tripId: string, pickupLat: number, pickupLng: number): Promise<string | null> {
  const { data: drivers, error } = await supabase
    .from('drivers')
    .select('id, current_location, subscription_tier, activity_score, idle_time_minutes')
    .eq('is_online', true)
    .eq('is_available', true);

  if (error || !drivers?.length) {
    await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
    return null;
  }

  type ScoredDriver = { driverId: string; score: number; distKm: number };

  const scored: ScoredDriver[] = drivers
    .map((d) => {
      const coords = d.current_location?.coordinates as [number, number] | undefined;
      if (!coords) return null;
      const [lng, lat] = coords;
      const distKm = haversineKm(pickupLat, pickupLng, lat, lng);
      if (distKm > MAX_SEARCH_RADIUS_KM) return null;

      const candidate: DriverCandidate = {
        id: d.id,
        subscription_tier: d.subscription_tier as 1 | 2 | 3,
        activity_score: d.activity_score ?? 0.5,
        idle_time_minutes: d.idle_time_minutes ?? 0,
      };

      return { driverId: d.id, score: bmpScore(candidate, distKm), distKm };
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

  // Auto-expire and log if not accepted
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

      // Re-dispatch to next available candidate (skip winner)
      const nextCandidate = scored[1];
      if (nextCandidate) {
        await redispatch(tripId, nextCandidate.driverId);
      } else {
        await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
      }
    }
  }, OFFER_TIMEOUT_SECONDS * 1000);

  return winner.driverId;
}

async function redispatch(tripId: string, driverId: string) {
  const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000).toISOString();
  await supabase.from('trips').update({ driver_id: driverId }).eq('id', tripId);
  await supabase.from('trip_offers').insert({ trip_id: tripId, driver_id: driverId, expires_at: expiresAt });
}
