import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin as supabase } from '../lib/supabase';
import { requireAuth, requireDriver, AuthRequest } from '../middleware/auth';

const router = Router();

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// PATCH /api/drivers/location — update driver GPS
router.patch('/location', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const parsed = LocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { lat, lng } = parsed.data;

  const { error } = await supabase
    .from('drivers')
    .update({
      location_lat: lat,
      location_lng: lng,
    })
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: 'Failed to update location' });
  res.json({ ok: true });
});

// PATCH /api/drivers/status — toggle online/available
router.patch('/status', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const StatusSchema = z.object({
    is_online: z.boolean().optional(),
    is_available: z.boolean().optional(),
  });
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Reject empty-body requests to prevent silent no-op updates
  if (parsed.data.is_online === undefined && parsed.data.is_available === undefined) {
    return res.status(400).json({ error: 'At least one of is_online or is_available must be provided' });
  }

  const updates: Record<string, unknown> = { ...parsed.data };

  // P5: When a driver marks themselves as available, stamp became_available_at
  // so the dispatch engine can calculate real idle-time for BMP scoring.
  if (parsed.data.is_available === true) {
    updates.became_available_at = new Date().toISOString();
  } else if (parsed.data.is_available === false) {
    updates.became_available_at = null;
  }

  const { error } = await supabase
    .from('drivers')
    .update(updates)
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: 'Failed to update status' });
  res.json({ ok: true });
});

// GET /api/drivers/me
// Explicit column list: excludes internal scoring fields (activity_score, bmp_score,
// became_available_at) that are algorithm internals with no client-facing purpose.
router.get('/me', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('drivers')
    .select('id, name, phone, vehicle_make, vehicle_model, vehicle_plate, subscription_tier, is_approved, is_online, is_available, location_lat, location_lng, created_at')
    .eq('id', req.userId)
    .single();

  if (error) {
    console.error('[drivers/me] DB error for driver', req.userId, ':', error.message);
    return res.status(500).json({ error: 'Failed to fetch driver profile' });
  }
  if (!data) return res.status(404).json({ error: 'Driver not found' });
  res.json(data);
});

// PATCH /api/drivers/push-token — register or refresh Expo push token
router.patch('/push-token', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const PushTokenSchema = z.object({
    token: z.string().min(1),
  });
  const parsed = PushTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase
    .from('drivers')
    .update({ push_token: parsed.data.token })
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: 'Failed to save push token' });
  res.json({ ok: true });
});

const RegisterSchema = z.object({
  name:          z.string().min(2).max(80),
  vehicle_make:  z.string().min(1).max(40),
  vehicle_model: z.string().min(1).max(40),
  vehicle_plate: z.string().min(2).max(20),
});

// POST /api/drivers/register — first-time driver profile creation.
// Called after OTP verify returns { status: 'pending_registration' }.
// In dev/test mode (TEST_BYPASS_ENABLED or NODE_ENV=development/test), drivers
// are auto-approved so the full ride flow can be tested immediately.
// In production, is_approved=false and an admin must approve before going online.
router.post('/register', requireAuth, async (req: AuthRequest, res) => {
  // Prevent overwriting an existing approved profile.
  const { data: existing } = await supabase
    .from('drivers')
    .select('id')
    .eq('id', req.userId)
    .maybeSingle();
  if (existing) return res.status(409).json({ error: 'Driver profile already exists' });

  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Get the phone number from the auth user record.
  const { data: authUser } = await supabase.auth.admin.getUserById(req.userId!);
  const phone = authUser?.user?.phone ?? '';

  const isTestBypassEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.TEST_BYPASS_ENABLED === 'true';

  const { error } = await supabase.from('drivers').insert({
    id:            req.userId,
    phone,
    name:          parsed.data.name,
    vehicle_make:  parsed.data.vehicle_make,
    vehicle_model: parsed.data.vehicle_model,
    vehicle_plate: parsed.data.vehicle_plate.toUpperCase(),
    // Auto-approve in dev/test so the full ride flow can be exercised immediately.
    // In production this stays false until an admin approves the driver.
    is_approved:   isTestBypassEnabled,
    is_online:     false,
    is_available:  false,
  });

  if (error) {
    console.error('[drivers/register] insert error:', error.message);
    return res.status(500).json({ error: 'Failed to create driver profile' });
  }

  // Stamp app_metadata.role = 'driver' so requireAuth resolves role from the JWT
  // without a DB round-trip. Non-fatal — DB row is the authoritative fallback.
  supabase.auth.admin.updateUserById(req.userId!, { app_metadata: { role: 'driver' } })
    .catch((e: unknown) => console.warn('[drivers/register] app_metadata stamp failed:', e));

  res.status(201).json({ ok: true, status: 'pending_approval' });
});

// GET /api/drivers/trips — last 20 completed/cancelled trips + earnings summary
router.get('/trips', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('trips')
    .select(`
      id, status, pickup_address, dropoff_address,
      fare_amount, created_at, completed_at, rider_rating
    `)
    .eq('driver_id', req.userId)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Failed to fetch trips' });

  const trips = data ?? [];
  const completed = trips.filter(t => t.status === 'completed');
  const totalEarnings = completed.reduce((sum, t) => sum + Number(t.fare_amount ?? 0), 0);
  const today = new Date().toDateString();
  const todayEarnings = completed
    .filter(t => t.completed_at && new Date(t.completed_at).toDateString() === today)
    .reduce((sum, t) => sum + Number(t.fare_amount ?? 0), 0);

  res.json({
    trips,
    summary: {
      total_trips:       completed.length,
      total_earnings_jd: Number(totalEarnings.toFixed(2)),
      today_earnings_jd: Number(todayEarnings.toFixed(2)),
    },
  });
});

export default router;
