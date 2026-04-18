import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin as supabase } from '../lib/supabase';
import { requireAuth, requireDriver, requireRider, AuthRequest } from '../middleware/auth';
import { dispatchTrip } from '../dispatch/engine';
import { haversineKm } from '../dispatch/geo';
import { sendPush } from '../lib/push';

const router = Router();

// Strict UUID v4 pattern (version nibble = 4, variant nibble = 8|9|a|b)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// Valid trip-status state-machine transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  requested:    ['dispatching', 'cancelled'],   // rider can cancel before dispatch starts
  dispatching:  ['accepted', 'cancelled'],       // rider can cancel during dispatch
  accepted:     ['en_route', 'cancelled'],
  en_route:     ['arrived', 'cancelled'],
  arrived:      ['in_progress', 'cancelled'],
  in_progress:  ['completed'],
  completed:    [],
  cancelled:    [],
};

// ----------------------------------------------------------------
// P4: Authoritative server-side fare calculation.
//
// Clients must NOT supply fare_amount — they receive the server's
// calculated value in the 201 response and store it locally. This
// prevents manipulated client payloads from overwriting business-
// critical revenue figures in the database.
//
// Formula: base 0.50 JD + 0.35 JD per km, minimum 1.50 JD.
// Rounded to 2 decimal places.
// ----------------------------------------------------------------
function calculateFare(
  pickupLat: number, pickupLng: number,
  dropoffLat: number, dropoffLng: number,
): number {
  const distKm = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  return Math.round(Math.max(1.50, 0.50 + distKm * 0.35) * 100) / 100;
}

// ----------------------------------------------------------------
// P5: Write an immutable status-change record to trip_status_history.
// Fire-and-forget — failure does not block the main response.
// ----------------------------------------------------------------
function recordStatusHistory(tripId: string, status: string): void {
  supabase
    .from('trip_status_history')
    .insert({ trip_id: tripId, status })
    .then(({ error }) => {
      if (error) console.error('[status-history] insert failed:', error.message);
    });
}

// ----------------------------------------------------------------
// P5: Update driver activity_score via the DB-level RPC so the
// read-modify-write is atomic and survives concurrent requests.
// completed=true → reward (EMA towards 1.0)
// completed=false → penalise driver cancellation (EMA towards 0.0)
// ----------------------------------------------------------------
function updateDriverActivityScore(driverId: string, completed: boolean): void {
  supabase
    .rpc('update_driver_activity_score', { p_driver_id: driverId, p_completed: completed })
    .then(({ error }) => {
      if (error) console.error('[activity-score] RPC failed:', error.message);
    });
}

// ----------------------------------------------------------------
// Schema — fare_amount intentionally absent (calculated server-side)
// ----------------------------------------------------------------
const TripRequestSchema = z.object({
  pickup_lat:      z.number().min(-90).max(90),
  pickup_lng:      z.number().min(-180).max(180),
  dropoff_lat:     z.number().min(-90).max(90),
  dropoff_lng:     z.number().min(-180).max(180),
  pickup_address:  z.string().max(500).optional(),
  dropoff_address: z.string().max(500).optional(),
  payment_method:  z.enum(['cash', 'cliq']).default('cash'),
  // fare_amount is NOT accepted from clients — we calculate it here.
});

// POST /api/trips — rider requests a ride
router.post('/', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const parsed = TripRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Prevent dispatch-timer accumulation: one active trip per rider at a time.
  // Without this, a rider can create trips faster than drivers accept, building
  // up unbounded in-memory setTimeout chains in the dispatch engine.
  const { count: activeCount, error: countErr } = await supabase
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', req.userId)
    .in('status', ['requested', 'dispatching', 'accepted', 'en_route', 'arrived', 'in_progress']);

  if (countErr) {
    console.error('[trips POST] active-count query failed:', countErr.message);
    return res.status(500).json({ error: 'Failed to check active trips' });
  }

  if ((activeCount ?? 0) > 0) {
    return res.status(409).json({ error: 'You already have an active trip in progress.' });
  }

  const {
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    pickup_address, dropoff_address, payment_method,
  } = parsed.data;

  // P4: Calculate fare server-side so the stored value is authoritative.
  const fare_amount = calculateFare(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng);

  const { data: trip, error } = await supabase
    .from('trips')
    .insert({
      rider_id:         req.userId,
      pickup_lat,
      pickup_lng,
      dropoff_lat,
      dropoff_lng,
      pickup_address,
      dropoff_address,
      payment_method,
      fare_amount,
      status: 'requested',
    })
    .select('id')
    .single();

  if (error || !trip) {
    console.error('[trips POST] insert failed:', error?.message);
    return res.status(500).json({ error: 'Failed to create trip' });
  }

  // Write initial status to audit log
  recordStatusHistory(trip.id, 'requested');

  // Fire dispatch asynchronously
  dispatchTrip(trip.id, pickup_lat, pickup_lng).catch(console.error);

  res.status(201).json({ tripId: trip.id, status: 'requested', fare_amount });
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

  // Optimistic concurrency guard: only update if the offer is still pending.
  // Without this, a race between the poller (which expires offers) and the
  // driver accepting can result in two drivers being assigned to the same trip.
  const { data: acceptedRows, error: offerUpdateErr } = await supabase
    .from('trip_offers')
    .update({ status: 'accepted' })
    .eq('id', offer.id)
    .eq('status', 'pending')  // atomic guard — prevents double-processing
    .select('id');

  if (offerUpdateErr) {
    console.error('[trips/accept] offer update failed:', offerUpdateErr.message);
    return res.status(500).json({ error: 'Failed to accept offer' });
  }
  if (!acceptedRows?.length) {
    // Poller expired this offer between our read and this write
    return res.status(410).json({ error: 'Offer has expired or was already processed' });
  }

  // Atomic guard: only accept if trip is still 'dispatching'.
  // Between the offer check above and this update, the rider may cancel or
  // another instance may have processed this trip — the status guard makes
  // this transition atomic and prevents resurrecting a cancelled trip.
  const { data: acceptedTripRows, error } = await supabase.from('trips')
    .update({ status: 'accepted', driver_id: req.userId })
    .eq('id', tripId)
    .eq('status', 'dispatching')
    .select('id, rider_id');

  if (error) return res.status(500).json({ error: 'Failed to accept trip' });
  if (!acceptedTripRows?.length) {
    return res.status(409).json({ error: 'Trip is no longer available' });
  }

  // Mark driver as unavailable while on a trip.
  // became_available_at is cleared (set to null) — idle time stops counting.
  await supabase.from('drivers')
    .update({ is_available: false, became_available_at: null })
    .eq('id', req.userId);

  recordStatusHistory(tripId, 'accepted');

  // Notify rider their driver is confirmed.
  const acceptedTrip = acceptedTripRows[0];
  void Promise.resolve(
    supabase
      .from('riders')
      .select('push_token')
      .eq('id', acceptedTrip.rider_id)
      .maybeSingle(),
  ).then(({ data }) => {
    sendPush(
      data?.push_token,
      '✅ Driver Confirmed',
      'Your driver is on the way. Track them live in the app.',
      { type: 'trip_accepted', tripId },
    );
  }).catch(() => {});

  res.json({ ok: true, status: 'accepted' });
});

// POST /api/trips/:id/status — advance trip status (driver or rider for cancel)
router.post('/:id/status', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

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
  const isRider  = trip.rider_id  === req.userId;

  if (!isDriver && !isRider) return res.status(403).json({ error: 'Not your trip' });

  // Both the rider and the driver may cancel the trip.
  // Only the driver may advance all other statuses.
  if (parsed.data.status !== 'cancelled' && !isDriver) {
    return res.status(403).json({ error: 'Only the driver can advance trip status' });
  }

  // Enforce state-machine: reject illegal transitions.
  const allowedNext = VALID_TRANSITIONS[trip.status] ?? [];
  if (!allowedNext.includes(parsed.data.status)) {
    return res.status(409).json({
      error:   `Cannot transition from '${trip.status}' to '${parsed.data.status}'`,
      allowed: allowedNext,
    });
  }

  const updates: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === 'completed') {
    updates.completed_at = new Date().toISOString();
  }

  const { error } = await supabase.from('trips').update(updates).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Failed to update trip status' });

  // Write to immutable audit log
  recordStatusHistory(req.params.id, parsed.data.status);

  // Post-transition side effects
  if (parsed.data.status === 'completed' && trip.driver_id) {
    // Free the driver and restart their idle timer
    await supabase.from('drivers')
      .update({ is_available: true, became_available_at: new Date().toISOString() })
      .eq('id', trip.driver_id);
    // P5: Reward driver for completing a trip
    updateDriverActivityScore(trip.driver_id, true);
  }

  if (parsed.data.status === 'cancelled' && trip.driver_id) {
    // Free the driver regardless of who cancelled
    await supabase.from('drivers')
      .update({ is_available: true, became_available_at: new Date().toISOString() })
      .eq('id', trip.driver_id);
    // P5: Penalise driver only when they are the one cancelling an in-flight trip
    if (isDriver && trip.status !== 'requested' && trip.status !== 'dispatching') {
      updateDriverActivityScore(trip.driver_id, false);
    }
  }

  // Push the counter-party on cancellation.
  const newStatus = parsed.data.status;
  const tripId = req.params.id;
  if (newStatus === 'cancelled') {
    const cancellerIsRider = req.userId === trip.rider_id;
    if (cancellerIsRider && trip.driver_id) {
      void Promise.resolve(
        supabase.from('drivers').select('push_token').eq('id', trip.driver_id).maybeSingle(),
      ).then(({ data }) => sendPush(data?.push_token, '❌ Trip Cancelled', 'The rider cancelled this trip.', { type: 'trip_cancelled', tripId }))
        .catch(() => {});
    } else if (!cancellerIsRider) {
      void Promise.resolve(
        supabase.from('riders').select('push_token').eq('id', trip.rider_id).maybeSingle(),
      ).then(({ data }) => sendPush(data?.push_token, '❌ Trip Cancelled', "Your driver cancelled. We'll find you another one.", { type: 'trip_cancelled', tripId }))
        .catch(() => {});
    }
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

  // Immediately re-dispatch to the next available driver rather than waiting for the
  // poller's 15s timeout. Declined offers have status='declined' and the poller
  // only processes status='pending' expired offers, so without this re-dispatch the
  // trip would be stuck in 'dispatching' forever.
  // Fetch trip coordinates for re-dispatch (fire-and-forget, don't block the response).
  void supabase
    .from('trips')
    .select('pickup_lat, pickup_lng, status')
    .eq('id', tripId)
    .eq('status', 'dispatching') // only re-dispatch if still waiting for a driver
    .maybeSingle()
    .then(({ data: trip, error: fetchErr }) => {
      if (fetchErr) {
        console.error('[decline] trip-fetch for re-dispatch failed:', fetchErr.message);
        return;
      }
      if (trip?.pickup_lat != null && trip?.pickup_lng != null) {
        dispatchTrip(tripId, trip.pickup_lat, trip.pickup_lng)
          .catch((err: unknown) => console.error('[decline] re-dispatch failed for trip', tripId, ':', err));
      }
    });
});

// GET /api/trips/any-pending — returns the most recent non-terminal trip for the rider,
// regardless of status (including 'requested' and 'dispatching').
// Used by the 409 "Cancel & Retry" dialog to locate a stale trip that is blocking
// new requests even though no driver has been assigned yet.
// Without this, stale pre-dispatch trips cannot be found by GET /trips/active (which
// only returns live-status trips) and the cancel-and-retry loop never terminates.
// Must be declared BEFORE /:id so Express doesn't treat "any-pending" as a UUID.
router.get('/any-pending', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const NON_TERMINAL = ['requested', 'dispatching', 'accepted', 'en_route', 'arrived', 'in_progress'];

  const { data, error } = await supabase
    .from('trips')
    .select('id, status')
    .eq('rider_id', req.userId!)
    .in('status', NON_TERMINAL)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[trips/any-pending] DB error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch pending trip' });
  }

  res.json(data ?? null); // null = no pending trip
});

// GET /api/trips/active — rider's live trip (driver already assigned), used to restore UI after
// app restart. Only returns trips where a driver is actively involved so the client never
// accidentally restores a stale pre-dispatch trip.
// Must be declared BEFORE /:id so Express doesn't treat "active" as a UUID.
router.get('/active', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const LIVE_STATUSES = ['accepted', 'en_route', 'arrived', 'in_progress'];

  // Data integrity check: if multiple active trips exist (TOCTOU race window),
  // log it so it can be investigated. The DB-level fix is:
  //   CREATE UNIQUE INDEX one_active_trip_per_rider ON trips (rider_id)
  //   WHERE status NOT IN ('completed','cancelled');
  const { data: allActive } = await supabase
    .from('trips')
    .select('id')
    .eq('rider_id', req.userId!)
    .in('status', LIVE_STATUSES);

  if ((allActive?.length ?? 0) > 1) {
    console.error(`[trips/active] DATA INTEGRITY: rider ${req.userId} has ${allActive!.length} concurrent active trips — investigate immediately`);
  }

  const { data, error } = await supabase
    .from('trips')
    .select('id, driver_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, fare_amount')
    .eq('rider_id', req.userId!)
    .in('status', LIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[trips/active] DB error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch active trip' });
  }

  res.json(data ?? null); // null = no active trip (not an error)
});

// GET /api/trips/driver-active — driver's current assigned trip, used to restore the driver UI
// after an app restart mid-trip. Without this, a driver who relaunches the app mid-trip sees
// the offline screen and cannot advance the trip — leaving the rider stranded.
// Must be declared BEFORE /:id so Express doesn't treat "driver-active" as a UUID.
router.get('/driver-active', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const LIVE_STATUSES = ['accepted', 'en_route', 'arrived', 'in_progress'];
  const { data, error } = await supabase
    .from('trips')
    .select('id, rider_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, fare_amount')
    .eq('driver_id', req.userId!)
    .in('status', LIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[trips/driver-active] DB error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch active trip' });
  }

  res.json(data ?? null); // null = no active trip
});

// GET /api/trips/:id — only rider or driver on the trip
router.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

  // Explicit column list: excludes internal fields (bmp_score, dispatch metadata)
  // that clients have no legitimate need to see and that leak algorithm details.
  const { data, error } = await supabase
    .from('trips')
    .select('id, rider_id, driver_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_address, dropoff_address, fare_amount, payment_method, created_at, completed_at')
    .eq('id', req.params.id)
    .maybeSingle();

  // P2 fix: distinguish database errors from genuine "not found".
  // Previously, any DB error (schema mismatch, RPC error) silently became a 404,
  // making root-cause analysis impossible and returning misleading responses.
  if (error) {
    console.error('[trips GET] DB error for trip', req.params.id, ':', error.message);
    return res.status(500).json({ error: 'Failed to fetch trip' });
  }
  if (!data) return res.status(404).json({ error: 'Trip not found' });

  if (data.rider_id !== req.userId && data.driver_id !== req.userId) {
    return res.status(403).json({ error: 'Not your trip' });
  }

  res.json(data);
});

// GET /api/trips/:id/contact — counterparty name + phone (driver gets rider info, rider gets driver info)
// Only exposed once a driver is assigned and the trip is active. Never leaks data pre-assignment.
router.get('/:id/contact', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

  const { data: trip, error: tripErr } = await supabase
    .from('trips')
    .select('rider_id, driver_id, status')
    .eq('id', req.params.id)
    .maybeSingle();

  if (tripErr) {
    console.error('[trips/contact] DB error:', tripErr.message);
    return res.status(500).json({ error: 'Failed to fetch trip' });
  }
  if (!trip) return res.status(404).json({ error: 'Trip not found' });

  const isRider  = trip.rider_id  === req.userId;
  const isDriver = trip.driver_id === req.userId;
  if (!isRider && !isDriver) return res.status(403).json({ error: 'Not your trip' });

  // Only expose contact once a driver has been assigned and the trip is underway
  const VISIBLE_STATUSES = ['accepted', 'en_route', 'arrived', 'in_progress'];
  if (!VISIBLE_STATUSES.includes(trip.status)) {
    return res.status(404).json({ error: 'Contact not yet available' });
  }

  if (isRider && trip.driver_id) {
    const { data: driver, error: dErr } = await supabase
      .from('drivers')
      .select('name, phone, vehicle_make, vehicle_model, vehicle_plate')
      .eq('id', trip.driver_id)
      .single();
    if (dErr || !driver) return res.status(404).json({ error: 'Driver not found' });
    return res.json({
      role:    'driver',
      name:    driver.name    ?? null,
      phone:   driver.phone   ?? null,
      vehicle: [driver.vehicle_make, driver.vehicle_model].filter(Boolean).join(' ') || null,
      plate:   driver.vehicle_plate ?? null,
    });
  }

  if (isDriver && trip.rider_id) {
    const { data: rider, error: rErr } = await supabase
      .from('riders')
      .select('name, phone')
      .eq('id', trip.rider_id)
      .single();
    if (rErr || !rider) return res.status(404).json({ error: 'Rider not found' });
    return res.json({ role: 'rider', name: rider.name ?? null, phone: rider.phone ?? null });
  }

  return res.status(404).json({ error: 'Contact not found' });
});

// POST /api/trips/:id/rate — rider rates driver, driver rates rider
router.post('/:id/rate', requireAuth, async (req: AuthRequest, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: 'Invalid trip ID' });

  const RateSchema = z.object({
    rating: z.number().int().min(1).max(5),
    ratee:  z.enum(['driver', 'rider']),
  });
  const parsed = RateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data: trip } = await supabase
    .from('trips')
    .select('rider_id, driver_id, status, driver_rating, rider_rating')
    .eq('id', req.params.id)
    .maybeSingle();

  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  if (trip.status !== 'completed') return res.status(409).json({ error: 'Can only rate completed trips' });

  const isRider  = trip.rider_id  === req.userId;
  const isDriver = trip.driver_id === req.userId;
  if (!isRider && !isDriver) return res.status(403).json({ error: 'Not your trip' });

  // Rider rates driver; driver rates rider — prevent double submission
  if (parsed.data.ratee === 'driver' && !isRider)  return res.status(403).json({ error: 'Only the rider can rate the driver' });
  if (parsed.data.ratee === 'rider'  && !isDriver) return res.status(403).json({ error: 'Only the driver can rate the rider' });

  const column = parsed.data.ratee === 'driver' ? 'driver_rating' : 'rider_rating';

  // Idempotency guard: reject if already rated
  if (trip[column] != null) {
    return res.status(409).json({ error: 'Already rated' });
  }

  const { error } = await supabase
    .from('trips')
    .update({ [column]: parsed.data.rating })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: 'Failed to save rating' });
  res.json({ ok: true });
});

export default router;
