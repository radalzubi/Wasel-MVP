import { Router } from 'express';
import { supabaseAdmin as supabase } from '../lib/supabase';
import { requireAuth, requireRider, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/riders/me — returns the authenticated rider's profile
// Explicit column list: excludes internal fields (waitlist_position, etc.)
// that have no client-facing purpose.
router.get('/me', requireAuth, requireRider, async (req: AuthRequest, res) => {
  const { data, error } = await supabase
    .from('riders')
    .select('id, phone, name, is_waitlist_member, waitlist_joined_at, waitlist_position, created_at')
    .eq('id', req.userId!)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch rider profile' });
  if (!data) return res.status(404).json({ error: 'Rider not found' });

  res.json(data);
});

export default router;
