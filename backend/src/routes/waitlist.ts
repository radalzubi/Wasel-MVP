import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const router = Router();

const WaitlistSchema = z.object({
  phone: z.string().min(8).max(20),
  name: z.string().min(1).max(100),
  role: z.enum(['rider', 'driver']),
  city: z.string().optional(),
  vehicle_type: z.string().optional(),
  referral_code: z.string().optional(),
});

// POST /api/waitlist
router.post('/', async (req, res) => {
  const parsed = WaitlistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data, error } = await supabase
    .from('waitlist')
    .insert(parsed.data)
    .select('id, created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already on waitlist' });
    return res.status(500).json({ error: 'Failed to join waitlist' });
  }

  res.status(201).json({ message: 'Successfully joined waitlist', id: data.id });
});

// GET /api/waitlist/count
router.get('/count', async (_req, res) => {
  const { count } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true });

  res.json({ count });
});

export default router;
