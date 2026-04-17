import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { otpLimiter } from '../index';

const router = Router();

// ----------------------------------------------------------------
// Validation schemas
// ----------------------------------------------------------------

const PhoneSchema = z.object({
  phone: z.string().regex(/^\+9627[789]\d{7}$/, 'Must be a valid Jordanian mobile number (+9627XXXXXXXX)'),
});

const VerifySchema = z.object({
  phone: z.string().regex(/^\+9627[789]\d{7}$/),
  token: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  role: z.enum(['rider', 'driver']),
});

// ----------------------------------------------------------------
// Dev / test user constants
// ----------------------------------------------------------------

/** Test phones that bypass real OTP in non-production environments.
 *  Must match the Jordanian regex: +9627[789]\d{7}
 *  +962 79 0000001 = valid format (9 digits after country code) */
const TEST_PHONES = new Set(['+962790000001', '+962790000002']);
const TEST_OTP   = '123456';

const DEV_USERS = {
  rider:  { email: 'test-rider@wasel.dev',  password: 'change-me-dev-password', phone: '+962790000001' },
  driver: { email: 'test-driver@wasel.dev', password: 'change-me-dev-password', phone: '+962790000002' },
} as const;

type DevRole = keyof typeof DEV_USERS;

/** Returns the dev user config for a test phone, or null if not a test phone. */
function devUserForPhone(phone: string): { role: DevRole; email: string; password: string; phone: string } | null {
  if (phone === DEV_USERS.rider.phone)  return { role: 'rider',  ...DEV_USERS.rider  };
  if (phone === DEV_USERS.driver.phone) return { role: 'driver', ...DEV_USERS.driver };
  return null;
}

// ----------------------------------------------------------------
// Waitlist membership helper
// ----------------------------------------------------------------

/**
 * Looks up whether `phone` is on the waitlist and, if so, updates the
 * rider/driver row with is_waitlist_member, waitlist_joined_at, and
 * waitlist_position (= number of waitlist rows created on or before theirs).
 */
async function applyWaitlistMembership(userId: string, phone: string, table: 'riders' | 'drivers'): Promise<void> {
  const { data: wl } = await supabase
    .from('waitlist')
    .select('created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!wl) return;

  // Count waitlist entries created at or before this one to determine position
  const { count } = await supabase
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .lte('created_at', wl.created_at);

  await supabase
    .from(table)
    .update({
      is_waitlist_member: true,
      waitlist_joined_at: wl.created_at,
      waitlist_position:  count ?? 0,
    })
    .eq('id', userId);
}

// ----------------------------------------------------------------
// POST /api/auth/send-otp
// ----------------------------------------------------------------

router.post('/send-otp', otpLimiter, async (req, res) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone } = parsed.data;

  // Dev bypass: skip real OTP for test phones outside production
  if (process.env.NODE_ENV !== 'production' && TEST_PHONES.has(phone)) {
    return res.json({ message: 'OTP sent' });
  }

  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });

  res.json({ message: 'OTP sent' });
});

// ----------------------------------------------------------------
// POST /api/auth/verify
// ----------------------------------------------------------------

router.post('/verify', otpLimiter, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone, token, role } = parsed.data;

  // ------------------------------------------------------------------
  // Dev bypass: test phones + magic OTP skip real Supabase verification
  // ------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production' && TEST_PHONES.has(phone) && token === TEST_OTP) {
    const devUser = devUserForPhone(phone)!;
    const creds   = DEV_USERS[devUser.role];

    // Ensure the test user exists in Supabase Auth
    const { error: createErr } = await supabase.auth.admin.createUser({
      email:         creds.email,
      password:      creds.password,
      email_confirm: true,
      phone:         creds.phone,
      phone_confirm: true,
    });
    // Ignore "already exists" errors (code 422 / message contains "already registered")
    if (createErr && !createErr.message.toLowerCase().includes('already')) {
      return res.status(500).json({ error: createErr.message });
    }

    const { data, error: signInErr } = await supabase.auth.signInWithPassword({
      email:    creds.email,
      password: creds.password,
    });
    if (signInErr || !data.session) {
      return res.status(500).json({ error: signInErr?.message || 'Dev sign-in failed' });
    }

    const userId = data.user!.id;

    if (role === 'rider') {
      await supabase.from('riders').upsert({ id: userId, phone }, { onConflict: 'id' });
      await applyWaitlistMembership(userId, phone, 'riders');
    } else {
      await supabase.from('drivers').upsert({
        id:               userId,
        phone:            creds.phone,
        name:             'Test Driver',
        vehicle_make:     'Toyota',
        vehicle_model:    'Corolla',
        vehicle_plate:    'TEST-001',
        subscription_tier: 2,
      }, { onConflict: 'id' });
      await applyWaitlistMembership(userId, phone, 'drivers');
    }

    return res.json({ session: data.session, user: { id: userId, phone, role } });
  }

  // ------------------------------------------------------------------
  // Normal OTP verification
  // ------------------------------------------------------------------
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error || !data.session) return res.status(401).json({ error: 'Invalid or expired OTP' });

  const userId = data.user!.id;

  if (role === 'rider') {
    await supabase.from('riders').upsert({ id: userId, phone }, { onConflict: 'id' });
    await applyWaitlistMembership(userId, phone, 'riders');
  } else {
    // Drivers must be pre-approved — check for an existing profile
    const { data: existingDriver } = await supabase
      .from('drivers')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingDriver) {
      // Allow the session through but signal the app that approval is pending
      return res.status(403).json({
        error:   'Driver account pending approval. Please contact Wasel support.',
        session: data.session,
      });
    }

    await applyWaitlistMembership(userId, phone, 'drivers');
  }

  res.json({ session: data.session, user: { id: userId, phone, role } });
});

// ----------------------------------------------------------------
// POST /api/auth/dev-login — DEV ONLY, never runs in production
// ----------------------------------------------------------------

router.post('/dev-login', otpLimiter, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { role } = req.body;
  if (role !== 'rider' && role !== 'driver') {
    return res.status(400).json({ error: 'role must be rider or driver' });
  }

  const creds = DEV_USERS[role as DevRole];

  // Try signing in — if the test user doesn't exist yet, create them first
  let { data, error } = await supabase.auth.signInWithPassword({
    email:    creds.email,
    password: creds.password,
  });

  if (error) {
    const { error: createErr } = await supabase.auth.admin.createUser({
      email:         creds.email,
      password:      creds.password,
      email_confirm: true,
      phone:         creds.phone,
      phone_confirm: true,
    });
    if (createErr) return res.status(500).json({ error: createErr.message });

    ({ data, error } = await supabase.auth.signInWithPassword({
      email:    creds.email,
      password: creds.password,
    }));
  }

  if (error || !data.session) {
    return res.status(500).json({ error: error?.message || 'Dev login failed' });
  }

  const userId = data.user!.id;

  if (role === 'rider') {
    await supabase.from('riders').upsert({ id: userId, phone: creds.phone }, { onConflict: 'id' });
    await applyWaitlistMembership(userId, creds.phone, 'riders');
  } else {
    await supabase.from('drivers').upsert({
      id:               userId,
      phone:            creds.phone,
      name:             'Test Driver',
      vehicle_make:     'Toyota',
      vehicle_model:    'Corolla',
      vehicle_plate:    'TEST-001',
      subscription_tier: 2,
    }, { onConflict: 'id' });
    await applyWaitlistMembership(userId, creds.phone, 'drivers');
  }

  res.json({ session: data.session, user: { id: userId, phone: creds.phone, role } });
});

export default router;
