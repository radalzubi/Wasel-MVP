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

// POST /api/auth/dev-login — DEV ONLY, never runs in production
const DEV_USERS = {
  rider:  { email: 'test-rider@wasel.dev',  password: 'change-me-dev-password', phone: '+96279000001' },
  driver: { email: 'test-driver@wasel.dev', password: 'change-me-dev-password', phone: '+96279000002' },
} as const;

router.post('/dev-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { role } = req.body;
  if (role !== 'rider' && role !== 'driver') {
    return res.status(400).json({ error: 'role must be rider or driver' });
  }

  const creds = DEV_USERS[role];

  // Try signing in — if the test user doesn't exist yet, create them first
  let { data, error } = await supabase.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });

  if (error) {
    // First run: create the test user
    const { error: createErr } = await supabase.auth.admin.createUser({
      email: creds.email,
      password: creds.password,
      email_confirm: true,
      phone: creds.phone,
      phone_confirm: true,
    });
    if (createErr) return res.status(500).json({ error: createErr.message });

    ({ data, error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    }));
  }

  if (error || !data.session) {
    return res.status(500).json({ error: error?.message || 'Dev login failed' });
  }

  const userId = data.user!.id;

  // Ensure the profile row exists
  if (role === 'rider') {
    await supabase.from('riders').upsert({ id: userId, phone: creds.phone }, { onConflict: 'id' });
  } else {
    await supabase.from('drivers').upsert({
      id: userId,
      phone: creds.phone,
      name: 'Test Driver',
      vehicle_make: 'Toyota',
      vehicle_model: 'Corolla',
      vehicle_plate: 'TEST-001',
      subscription_tier: 2,
    }, { onConflict: 'id' });
  }

  res.json({ session: data.session, user: { id: userId, phone: creds.phone, role } });
});

export default router;
