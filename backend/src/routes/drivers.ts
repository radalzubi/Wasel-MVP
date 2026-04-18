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
    .select('id, name, phone, vehicle_make, vehicle_model, vehicle_plate, subscription_tier, is_online, is_available, location_lat, location_lng, created_at')
    .eq('id', req.userId)
    .single();

  if (error) {
    console.error('[drivers/me] DB error for driver', req.userId, ':', error.message);
    return res.status(500).json({ error: 'Failed to fetch driver profile' });
  }
  if (!data) return res.status(404).json({ error: 'Driver not found' });
  res.json(data);
});

export default router;
