import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const router = Router();

const PhoneSchema = z.object({ phone: z.string().min(8) });
const VerifySchema = z.object({
  phone: z.string().min(8),
  token: z.string().min(4),
  role: z.enum(['rider', 'driver']),
});

// POST /api/auth/send-otp
router.post('/send-otp', async (req, res) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: 'OTP sent' });
});

// POST /api/auth/verify
router.post('/verify', async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone, token, role } = parsed.data;

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error || !data.session) return res.status(401).json({ error: error?.message || 'Invalid OTP' });

  // Upsert profile
  const table = role === 'driver' ? 'drivers' : 'riders';
  await supabase.from(table).upsert({ id: data.user!.id, phone }, { onConflict: 'id' });

  res.json({ session: data.session, user: { id: data.user!.id, phone } });
});

export default router;
