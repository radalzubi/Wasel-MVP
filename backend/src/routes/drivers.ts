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
      current_location: `SRID=4326;POINT(${lng} ${lat})`,
      // Plain float columns so the dispatch engine can read them without
      // needing PostGIS-aware queries (Supabase REST returns geometry as WKB hex).
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
router.get('/me', requireAuth, requireDriver, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', req.userId)
    .single();

  if (error) return res.status(404).json({ error: 'Driver not found' });
  res.json(data);
});

export default router;
