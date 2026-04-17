import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { otpLimiter } from '../index';

const router = Router();

const PhoneSchema = z.object({
  phone: z.string().regex(/^\+9627[789]\d{7}$/, 'Must be a valid Jordanian mobile number (+9627XXXXXXXX)'),
});

const VerifySchema = z.object({
  phone: z.string().regex(/^\+9627[789]\d{7}$/),
  token: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  role: z.enum(['rider', 'driver']),
});

// POST /api/auth/send-otp
router.post('/send-otp', otpLimiter, async (req, res) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { error } = await supabase.auth.signInWithOtp({ phone: parsed.data.phone });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: 'OTP sent' });
});

// POST /api/auth/verify
router.post('/verify', otpLimiter, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone, token, role } = parsed.data;

  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error || !data.session) return res.status(401).json({ error: error?.message || 'Invalid OTP' });

  const userId = data.user!.id;

  // Only create rider profile from this endpoint.
  // Driver profiles require separate admin-approved onboarding.
  if (role === 'rider') {
    await supabase.from('riders').upsert({ id: userId, phone }, { onConflict: 'id' });
  } else {
    // For drivers: check if a pre-approved driver record exists.
    // If not, return an error — drivers must be onboarded via admin.
    const { data: existingDriver } = await supabase
      .from('drivers')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingDriver) {
      // Still allow login but don't auto-create driver profile
      // Admin must approve the driver first
      return res.status(403).json({
        error: 'Driver account pending approval. Please contact Wasel support.',
        session: data.session,
      });
    }
  }

  res.json({ session: data.session, user: { id: userId, phone, role } });
});

export default router;
