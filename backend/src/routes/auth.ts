import { Router } from 'express';
import { z } from 'zod';
import { supabase, supabaseAdmin } from '../lib/supabase';
import { otpLimiter } from '../index';

const router = Router();

// ----------------------------------------------------------------
// Validation schemas
// ----------------------------------------------------------------

const PhoneSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in international format (e.g. +962790000003 or +12125551234)'),
});

const VerifySchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  token: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  role: z.enum(['rider', 'driver']),
});

// ----------------------------------------------------------------
// Dev / test user constants
// ----------------------------------------------------------------

/** Test phones that bypass real OTP in non-production environments. */
const TEST_PHONES = new Set(['+962790000001', '+962790000002']);
const TEST_OTP   = '123456';

// SECURITY: The dev test password is read from the DEV_TEST_PASSWORD environment
// variable. Although the dev-login and OTP bypass routes are gated on NODE_ENV,
// this variable should still be set to a strong, unique secret in any
// production-adjacent environment (staging, CI) to prevent accidental exposure.
const DEV_TEST_PASSWORD = process.env.DEV_TEST_PASSWORD || 'change-me-dev-password';

const DEV_USERS: Record<'rider' | 'driver', { email: string; password: string; phone: string }> = {
  rider:  { email: 'test-rider@wasel.dev',  password: DEV_TEST_PASSWORD, phone: '+962790000001' },
  driver: { email: 'test-driver@wasel.dev', password: DEV_TEST_PASSWORD, phone: '+962790000002' },
};

type DevRole = keyof typeof DEV_USERS;

/** Returns the dev user config for a test phone, or null if not a test phone. */
function devUserForPhone(phone: string): { role: DevRole; email: string; password: string; phone: string } | null {
  if (phone === DEV_USERS.rider.phone)  return { role: 'rider'  as const, ...DEV_USERS.rider  };
  if (phone === DEV_USERS.driver.phone) return { role: 'driver' as const, ...DEV_USERS.driver };
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
  const { data: wl } = await supabaseAdmin
    .from('waitlist')
    .select('created_at')
    .eq('phone', phone)
    .maybeSingle();

  if (!wl) return;

  // Count waitlist entries created at or before this one to determine position
  const { count } = await supabaseAdmin
    .from('waitlist')
    .select('*', { count: 'exact', head: true })
    .lte('created_at', wl.created_at);

  await supabaseAdmin
    .from(table)
    .update({
      is_waitlist_member: true,
      waitlist_joined_at: wl.created_at,
      waitlist_position:  count ?? 0,
    })
    .eq('id', userId);
}

// ----------------------------------------------------------------
// Per-phone OTP throttle (defence-in-depth on top of the IP-based otpLimiter)
// Max 3 OTP sends per phone number per 15-minute window.
// ----------------------------------------------------------------

const PHONE_OTP_MAX        = 3;
const PHONE_OTP_WINDOW_MS  = 15 * 60 * 1000;
const phoneOtpMap          = new Map<string, { count: number; resetAt: number }>();

function isPhoneThrottled(phone: string): boolean {
  const now  = Date.now();
  const entry = phoneOtpMap.get(phone);
  if (!entry || entry.resetAt <= now) {
    phoneOtpMap.set(phone, { count: 1, resetAt: now + PHONE_OTP_WINDOW_MS });
    return false;
  }
  if (entry.count >= PHONE_OTP_MAX) return true;
  entry.count++;
  return false;
}

// ----------------------------------------------------------------
// Dev helper: ensure a clean drivers profile row exists
//
// In dev mode the test auth users have stable UUIDs (Supabase Auth
// generates them deterministically from the email). However, if the
// Supabase Auth DB was wiped and re-seeded, a new UUID would be
// assigned while the old drivers row (with a different UUID) still
// holds the test phone number, causing a unique-constraint violation
// on the phone column.  This helper clears any stale conflicting row
// before the upsert so the dev environment always converges to a
// consistent state.
// ----------------------------------------------------------------

async function ensureDevDriverProfile(userId: string, phone: string): Promise<void> {
  // Remove any stale row that holds the phone but belongs to a different user.
  // This is safe in dev mode: there should only ever be one test driver.
  // supabaseAdmin is used here (and in all DB-write helpers in this file) to
  // avoid the user-JWT pollution described in lib/supabase.ts.
  await supabaseAdmin
    .from('drivers')
    .delete()
    .eq('phone', phone)
    .neq('id', userId);

  const { error } = await supabaseAdmin.from('drivers').upsert({
    id:                userId,
    phone,
    name:              'Test Driver',
    vehicle_make:      'Toyota',
    vehicle_model:     'Corolla',
    vehicle_plate:     'TEST-001',
    subscription_tier: 2,
    became_available_at: new Date().toISOString(),
    // Default to Amman city centre so the dispatch engine can locate this driver
    // immediately after login, before the first real GPS ping (sent 10s after
    // the driver goes online in the dashboard).
    location_lat:      31.9539,
    location_lng:      35.9106,
  }, { onConflict: 'id' });

  if (error) {
    // Re-throw so the caller can return a proper 500.
    throw new Error(`Driver upsert failed: ${error.message}`);
  }
}

async function ensureDevRiderProfile(userId: string, phone: string): Promise<void> {
  // Same stale-row cleanup for the rider side.
  await supabaseAdmin
    .from('riders')
    .delete()
    .eq('phone', phone)
    .neq('id', userId);

  const { error } = await supabaseAdmin.from('riders').upsert(
    { id: userId, phone },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`Rider upsert failed: ${error.message}`);
  }
}

// ----------------------------------------------------------------
// POST /api/auth/send-otp
// ----------------------------------------------------------------

router.post('/send-otp', otpLimiter, async (req, res) => {
  const parsed = PhoneSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { phone } = parsed.data;

  // Test-account bypass: skip real OTP for hardcoded test phones.
  // Controlled by TEST_BYPASS_ENABLED env var, independent of NODE_ENV so
  // Railway can run NODE_ENV=production while still allowing test logins.
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.TEST_BYPASS_ENABLED === 'true';
  if (isTestBypassEnabled && TEST_PHONES.has(phone)) {
    return res.json({ message: 'OTP sent' });
  }

  // Per-phone rate limit: blocks SMS-flooding of a specific number even when
  // the attacker rotates IPs to bypass the IP-based otpLimiter above.
  if (isPhoneThrottled(phone)) {
    return res.status(429).json({ error: 'Too many OTP requests for this number. Try again later.' });
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
  // Test-account bypass: hardcoded phones + magic OTP.
  // Controlled by TEST_BYPASS_ENABLED, independent of NODE_ENV.
  // ------------------------------------------------------------------
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.TEST_BYPASS_ENABLED === 'true';
  if (isTestBypassEnabled && TEST_PHONES.has(phone) && token === TEST_OTP) {
    const devUser = devUserForPhone(phone)!;
    const creds   = DEV_USERS[devUser.role];

    // Ensure the test user exists in Supabase Auth
    // Use supabaseAdmin to avoid user-JWT pollution on the shared supabase client
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email:         creds.email,
      password:      creds.password,
      email_confirm: true,
      phone:         creds.phone,
      phone_confirm: true,
    });
    // Ignore "already exists" errors (code 422 / message contains "already registered")
    if (createErr && !createErr.message.toLowerCase().includes('already')) {
      return res.status(500).json({ error: 'Failed to initialise dev user' });
    }

    const { data, error: signInErr } = await supabase.auth.signInWithPassword({
      email:    creds.email,
      password: creds.password,
    });
    if (signInErr || !data.session) {
      return res.status(500).json({ error: 'Dev sign-in failed' });
    }

    const userId = data.user!.id;

    // Use the canonical role bound to the test phone, not the client-supplied role,
    // to prevent a caller from forcing a driver test account into the riders table.
    const canonicalRole = devUser.role;

    try {
      if (canonicalRole === 'rider') {
        await ensureDevRiderProfile(userId, creds.phone);
        await applyWaitlistMembership(userId, creds.phone, 'riders');
      } else {
        await ensureDevDriverProfile(userId, creds.phone);
        await applyWaitlistMembership(userId, creds.phone, 'drivers');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Profile setup failed';
      console.error('[dev/verify] profile upsert error:', msg);
      return res.status(500).json({ error: 'Failed to create dev profile' });
    }

    // Stamp app_metadata so role resolves from JWT without a DB round-trip.
    supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role: canonicalRole } })
      .catch((e) => console.warn('[dev/verify] app_metadata stamp failed:', e));

    return res.json({ session: data.session, user: { id: userId, phone, role: canonicalRole } });
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

  // Guard against Supabase returning a session without an embedded user object
  if (!data.user) {
    console.error('[verify] OTP succeeded but no user in response');
    return res.status(500).json({ error: 'Authentication error. Please try again.' });
  }

  const userId = data.user.id;

  if (role === 'rider') {
    // supabaseAdmin: avoids user-JWT pollution from verifyOtp() above
    const { error: upsertErr } = await supabaseAdmin
      .from('riders')
      .upsert({ id: userId, phone }, { onConflict: 'id' });
    if (upsertErr) {
      console.error('[verify] Rider upsert failed:', upsertErr.message);
      return res.status(500).json({ error: 'Failed to create rider profile' });
    }
    // Stamp role in app_metadata so requireAuth never has to do a DB lookup.
    // Non-fatal — DB row is the authoritative fallback.
    supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role: 'rider' } })
      .catch((e) => console.warn('[verify] app_metadata rider stamp failed:', e));
    // Non-fatal: waitlist membership failure should not block login
    try { await applyWaitlistMembership(userId, phone, 'riders'); } catch { /* non-fatal */ }
  } else {
    // Drivers must be pre-approved — check for an existing profile
    const { data: existingDriver } = await supabaseAdmin
      .from('drivers')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (!existingDriver) {
      // Driver doesn't have a profile yet — send them to the registration screen.
      // Stamp as driver now so subsequent registration calls know the role.
      supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role: 'driver' } })
        .catch((e) => console.warn('[verify] app_metadata driver stamp (pre-reg) failed:', e));
      return res.status(200).json({ status: 'pending_registration', session: data.session });
    }

    // Stamp role in app_metadata for fast role resolution going forward.
    supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role: 'driver' } })
      .catch((e) => console.warn('[verify] app_metadata driver stamp failed:', e));
    // Non-fatal: waitlist membership failure should not block login
    try { await applyWaitlistMembership(userId, phone, 'drivers'); } catch { /* non-fatal */ }
  }

  res.json({ session: data.session, user: { id: userId, phone, role } });
});

// ----------------------------------------------------------------
// POST /api/auth/dev-login — DEV ONLY, never runs in production
//
// SECURITY NOTE: This endpoint exists at a well-known path and issues real
// Supabase sessions for test accounts. It is blocked in production (returns
// 404 so its existence is not disclosed). Ensure NODE_ENV='production' is set
// in all production and production-adjacent deployments. Any hit to this
// endpoint is logged below for auditability.
// ----------------------------------------------------------------

router.post('/dev-login', otpLimiter, async (req, res) => {
  // Allowlist pattern (same as OTP bypass) — unset or unrecognised NODE_ENV is treated
  // as production-equivalent so the endpoint stays closed on misconfigured deploys.
  // Controlled by TEST_BYPASS_ENABLED env var, independent of NODE_ENV so Railway
  // can run NODE_ENV=production while still allowing test logins when explicitly enabled.
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    process.env.TEST_BYPASS_ENABLED === 'true';
  if (!isTestBypassEnabled) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Audit log: record every access attempt in non-production environments.
  console.warn(`[DEV-LOGIN] Endpoint hit — role="${req.body?.role}" ip="${req.ip}" env="${process.env.NODE_ENV}"`);

  const { role } = req.body;
  if (role !== 'rider' && role !== 'driver') {
    return res.status(400).json({ error: 'role must be rider or driver' });
  }

  const creds = DEV_USERS[role as DevRole];

  // Try signing in first. If the test user doesn't exist yet, create them.
  let { data, error } = await supabase.auth.signInWithPassword({
    email:    creds.email,
    password: creds.password,
  });

  if (error) {
    // Use supabaseAdmin to avoid JWT-pollution on the shared supabase client
    const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email:         creds.email,
      password:      creds.password,
      email_confirm: true,
      phone:         creds.phone,
      phone_confirm: true,
    });
    // P1 fix: "already registered" is not a fatal error — the user exists,
    // we just need to retry sign-in (possibly the password changed via env var).
    if (createErr && !createErr.message.toLowerCase().includes('already')) {
      return res.status(500).json({ error: 'Failed to initialise dev user' });
    }

    // User either just created or already existed — retry sign-in.
    ({ data, error } = await supabase.auth.signInWithPassword({
      email:    creds.email,
      password: creds.password,
    }));
  }

  if (error || !data.session) {
    return res.status(500).json({ error: 'Dev login failed' });
  }

  const userId = data.user!.id;

  // P1 fix: use helpers that validate upsert results and handle stale
  // phone-conflict rows that can accumulate across Supabase Auth resets.
  try {
    if (role === 'rider') {
      await ensureDevRiderProfile(userId, creds.phone);
      await applyWaitlistMembership(userId, creds.phone, 'riders');
    } else {
      await ensureDevDriverProfile(userId, creds.phone);
      await applyWaitlistMembership(userId, creds.phone, 'drivers');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Profile setup failed';
    console.error('[dev-login] profile upsert error:', msg);
    return res.status(500).json({ error: 'Failed to create dev profile. Check server logs.' });
  }

  // Stamp app_metadata so the role is always readable from the JWT without a DB lookup.
  supabaseAdmin.auth.admin.updateUserById(userId, { app_metadata: { role } })
    .catch((e) => console.warn('[dev-login] app_metadata stamp failed:', e));

  res.json({ session: data.session, user: { id: userId, phone: creds.phone, role } });
});

export default router;
