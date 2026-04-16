import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { dispatchTrip } from '../dispatch/engine';

const router = Router();

const TripRequestSchema = z.object({
  pickup_lat: z.number(),
  pickup_lng: z.number(),
  dropoff_lat: z.number(),
  dropoff_lng: z.number(),
  pickup_address: z.string().optional(),
  dropoff_address: z.string().optional(),
  payment_method: z.enum(['cash', 'cliq']).default('cash'),
});

// POST /api/trips — rider requests a ride
router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const parsed = TripRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, payment_method } = parsed.data;

  const { data: trip, error } = await supabase
    .from('trips')
    .insert({
      rider_id: req.userId,
      pickup_location: `SRID=4326;POINT(${pickup_lng} ${pickup_lat})`,
      dropoff_location: `SRID=4326;POINT(${dropoff_lng} ${dropoff_lat})`,
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

// POST /api/trips/:id/accept — driver accepts offer
router.post('/:id/accept', requireAuth, async (req: AuthRequest, res) => {
  const tripId = req.params.id;

  await supabase.from('trip_offers')
    .update({ status: 'accepted' })
    .eq('trip_id', tripId)
    .eq('driver_id', req.userId);

  const { error } = await supabase.from('trips')
    .update({ status: 'accepted', driver_id: req.userId })
    .eq('id', tripId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, status: 'accepted' });
});

// POST /api/trips/:id/status — advance trip status
router.post('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  const StatusSchema = z.object({
    status: z.enum(['en_route', 'arrived', 'in_progress', 'completed', 'cancelled']),
  });
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const updates: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === 'completed') updates.completed_at = new Date().toISOString();

  const { error } = await supabase.from('trips').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, status: parsed.data.status });
});

// GET /api/trips/:id
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Trip not found' });
  res.json(data);
});

export default router;
