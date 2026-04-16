import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// PATCH /api/drivers/location — update driver GPS
router.patch('/location', requireAuth, async (req: AuthRequest, res) => {
  const { lat, lng } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng required' });
  }

  const { error } = await supabase
    .from('drivers')
    .update({
      current_location: `SRID=4326;POINT(${lng} ${lat})`,
    })
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// PATCH /api/drivers/status — toggle online/available
router.patch('/status', requireAuth, async (req: AuthRequest, res) => {
  const StatusSchema = z.object({
    is_online: z.boolean().optional(),
    is_available: z.boolean().optional(),
  });
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase
    .from('drivers')
    .update(parsed.data)
    .eq('id', req.userId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// GET /api/drivers/me
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('id', req.userId)
    .single();

  if (error) return res.status(404).json({ error: 'Driver not found' });
  res.json(data);
});

export default router;
