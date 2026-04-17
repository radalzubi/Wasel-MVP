import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { requireAuth, requireDriver, requireRider, AuthRequest } from '../middleware/auth';
import { dispatchTrip } from '../dispatch/engine';

const router = Router();

// Strict UUID v4 pattern (version nibble = 4, variant nibble = 8|9|a|b)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// Valid trip-status state-machine transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  requested:   ['dispatching', 'cancelled'],   // rider can cancel before dispatch starts
  dispatching: ['accepted', 'cancelled'],       // rider can cancel during dispatch
  accepted:    ['en_route', 'cancelled'],
  en_route:    ['arrived', 'cancelled'],
  arrived:     ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed:   [],
  cancelled:   [],
};

const TripRequestSchema = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  dropoff_lat: z.number().min(-90).max(90),
  dropoff_lng: z.number().min(-180).max(180),
  pickup_address: z.string().max(500).optional(),
  dropoff_address: z.string().max(500).optional(),
  payment_method: z.enum(['cash', 'cliq']).default('cash'),
  fare_amount: z.number().positive().optional(),
});

// POST /api/trips — rider requests a ride
router.post('/', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const parsed = TripRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Prevent dispatch-timer accumulation: one active trip per rider at a time.
  // Without this, a rider can create trips faster than drivers accept, building
  // up unbounded in-memory setTimeout chains in the dispatch engine.
  const { count: activeCount } = await supabase
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', req.userId)
    .not('status', 'in', '("completed","cancelled")');

  if ((activeCount ?? 0) > 0) {
    return res.status(409).json({ error: 'You already have an active trip in progress.' });
  }

  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, payment_method, fare_amount } = parsed.data;

  const { data: trip, error } = await supabase
    .from('trips')
    .insert({
      rider_id: req.userId,
      pickup_location: `SRID=4326;POINT(${pickup_lng} ${pickup_lat})`,
      dropoff_location: `SRID=4326;POINT(${dropoff_lng} ${dropoff_lat})`,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      pickup_address,
      dropoff_address,
      payment_method,
      fare_amount: fare_amount ?? null,
      status: 'requested',
    })
    .select('id')
    .single();

  if (error || !trip) return res.status(500).json({ error: 'Failed to create trip' });

  // Fire dispatch asynchronously
  dispatchTrip(trip.id, pickup_lat, pickup_lng).catch(console.error);

  res.status(201).json({ tripId: trip.id, status: 'requested' });
});

// POST /api/trips/:id/accept — driver accepts their assigned offer
router.post('/:id/accept', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const tripId = req.params.id;
  if (!isValidUUID(tripId)) return res.status(400).json({ error: 'Invalid trip ID' });

  // Verify this driver has a valid pending offer for this trip
  const { data: offer } = await supabase
    .from('trip_offers')
    .select('id, expires_at')
    .eq('trip_id', tripId)
    .eq('driver_id', req.userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (!offer) return res.status(403).json({ error: 'No active offer for this driver' });
  if (new Date(offer.expires_at) < new Date()) {
    return res.status(410).json({ error: 'Offer has expired' });
  }

  await supabase.from('trip_offers')
    .update({ status: 'accepted' })
    .eq('id', offer.id);

  const { error } = await supabase.from('trips')
    .update({ status: 'accepted', driver_id: req.userId })
    .eq('id', tripId);

  if (error) return res.status(500).json({ error: 'Failed to accept trip' });

  // Mark driver as unavailable while on a trip
  await supabase.from('drivers').update({ is_available: false }).eq('id', req.userId);

  res.json({ ok: true, status: 'accepted' });
});

// POST /api/trips/:id/status — advance trip status (driver or rider for cancel)
router.post('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

  const StatusSchema = z.object({
    status: z.enum(['dispatching', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled']),
  });
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Verify caller owns this trip
  const { data: trip } = await supabase
    .from('trips')
    .select('rider_id, driver_id, status')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const isDriver = trip.driver_id === req.userId;
  const isRider = trip.rider_id === req.userId;

  // Both isDriver and isRider are checked above; reaching here means the caller is on this trip.
  if (!isDriver && !isRider) return res.status(403).json({ error: 'Not your trip' });

  // Both the rider and the driver may cancel the trip.
  // Only the driver may advance all other statuses (en_route, arrived, in_progress, completed).
  if (parsed.data.status !== 'cancelled' && !isDriver) {
    return res.status(403).json({ error: 'Only the driver can advance trip status' });
  }

  // Enforce state-machine: reject transitions that skip steps or re-enter terminal states.
  const allowedNext = VALID_TRANSITIONS[trip.status] ?? [];
  if (!allowedNext.includes(parsed.data.status)) {
    return res.status(409).json({
      error: `Cannot transition from '${trip.status}' to '${parsed.data.status}'`,
      allowed: allowedNext,
    });
  }

  const updates: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === 'completed') {
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await supabase.from('trips').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to update trip status' });

  // Free the driver when the trip completes
  if (parsed.data.status === 'completed' && trip.driver_id) {
    await supabase.from('drivers').update({ is_available: true }).eq('id', trip.driver_id);
  }

  res.json({ ok: true, status: parsed.data.status });
});

// POST /api/trips/:id/decline — driver declines their offer
router.post('/:id/decline', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const tripId = req.params.id;
  if (!isValidUUID(tripId)) return res.status(400).json({ error: 'Invalid trip ID' });

  const { error } = await supabase
    .from('trip_offers')
    .update({ status: 'declined' })
    .eq('trip_id', tripId)
    .eq('driver_id', req.userId)
    .eq('status', 'pending');

  if (error) return res.status(500).json({ error: 'Failed to decline offer' });
  res.json({ ok: true });
});

// GET /api/trips/:id — only rider or driver on the trip
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

  // Explicit column list: excludes internal fields (bmp_score, dispatch metadata)
  // that clients have no legitimate need to see and that leak algorithm details.
  const { data, error } = await supabase
    .from('trips')
    .select('id, rider_id, driver_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, payment_method, created_at, completed_at')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Trip not found' });

  if (data.rider_id !== req.userId && data.driver_id !== req.userId) {
    return res.status(403).json({ error: 'Not your trip' });
  }

  res.json(data);
});

export default router;
