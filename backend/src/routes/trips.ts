import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { requireAuth, requireDriver, requireRider, AuthRequest } from '../middleware/auth';
import { dispatchTrip } from '../dispatch/engine';

const router = Router();

const TripRequestSchema = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  dropoff_lat: z.number().min(-90).max(90),
  dropoff_lng: z.number().min(-180).max(180),
  pickup_address: z.string().max(500).optional(),
  dropoff_address: z.string().max(500).optional(),
  payment_method: z.enum(['cash', 'cliq']).default('cash'),
});

// POST /api/trips — rider requests a ride
router.post('/', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const parsed = TripRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, payment_method } = parsed.data;

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

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, status: 'accepted' });
});

// POST /api/trips/:id/status — advance trip status (driver or rider for cancel)
router.post('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const StatusSchema = z.object({
    status: z.enum(['en_route', 'arrived', 'in_progress', 'completed', 'cancelled']),
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

  if (!isDriver && !isRider) return res.status(403).json({ error: 'Not your trip' });

  // Only riders can cancel; only drivers can advance other statuses
  if (parsed.data.status === 'cancelled' && !isRider && !isDriver) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (parsed.data.status !== 'cancelled' && !isDriver) {
    return res.status(403).json({ error: 'Only the driver can advance trip status' });
  }

  const updates: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === 'completed') updates.completed_at = new Date().toISOString();

  const { error } = await supabase.from('trips').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, status: parsed.data.status });
});

// GET /api/trips/:id — only rider or driver on the trip
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ error: 'Trip not found' });

  if (data.rider_id !== req.userId && data.driver_id !== req.userId) {
    return res.status(403).json({ error: 'Not your trip' });
  }

  res.json(data);
});

export default router;
