import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { requireAuth, requireRider, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/riders/me — returns the authenticated rider's profile
router.get('/me', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('riders')
    .select('id, phone, name, is_waitlist_member, waitlist_joined_at, waitlist_position, created_at')
    .eq('id', req.userId!)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Rider not found' });

  res.json(data);
});

export default router;
