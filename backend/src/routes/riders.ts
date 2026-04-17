import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRider, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/riders/me — returns the authenticated rider's profile
router.get('/me', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .eq('id', req.userId!)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch rider profile' });
  if (!data) return res.status(404).json({ error: 'Rider not found' });

  res.json(data);
});

export default router;
