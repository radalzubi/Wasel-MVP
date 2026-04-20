import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin as supabase } from '../lib/supabase';

const router = Router();

// Jordanian mobile numbers: +9627[789]XXXXXXX (11 digits after country code)
const JORDAN_PHONE_REGEX = /^\+9627[789]\d{7}$/;

const WaitlistSchema = z.object({
  phone: z.string().regex(JORDAN_PHONE_REGEX, 'Phone must be a valid Jordanian mobile number (+9627XXXXXXXX)'),
  name: z.string().min(1).max(100),
  role: z.enum(['rider', 'driver']),
  city: z.string().max(100).optional(),
  vehicle_type: z.string().max(100).optional(),
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
  const { count, error } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true });

  if (error) return res.status(500).json({ error: 'Failed to fetch count' });
  res.json({ count: count ?? 0 });
});

export default router;
