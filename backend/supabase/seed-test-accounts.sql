-- =============================================================================
-- Wasel: Re-seed dev/test account profiles
--
-- Run this in Supabase Dashboard → SQL Editor any time the drivers/riders
-- profile rows are missing after a DB reset (reset-for-production.sql
-- deletes them, and the apps won't auto-recreate them if they reuse a cached
-- session instead of going through the login flow again).
--
-- Safe to run multiple times (ON CONFLICT DO UPDATE).
-- Only affects the two test accounts — real user data is untouched.
--
-- When to run:
--   1. After reset-for-production.sql (in dev/test environments)
--   2. Any time the driver sees "Account pending approval" but should be approved
--   3. Any time the rider gets "Failed to create trip" and the DB rows are gone
-- =============================================================================

-- ── Driver profile ────────────────────────────────────────────────────────────
-- Looks up the auth user by the test email so the UUID is always correct,
-- even if the auth user was deleted and re-created (new UUID assigned).
INSERT INTO drivers (
  id, phone, name, vehicle_make, vehicle_model, vehicle_plate,
  subscription_tier, is_approved, is_online, is_available,
  location_lat, location_lng, activity_score
)
SELECT
  u.id,
  '+962790000002',
  'Test Driver',
  'Toyota',
  'Corolla',
  'TEST-001',
  2,        -- Gold tier
  true,     -- Pre-approved so driver can go online immediately
  false,
  true,
  31.9539,  -- Amman city centre — dispatch engine can locate driver on login
  35.9106,
  0.5
FROM auth.users u
WHERE u.email = 'test-driver@wasel.dev'
ON CONFLICT (id) DO UPDATE SET
  is_approved  = true,
  location_lat = 31.9539,
  location_lng = 35.9106;

-- ── Rider profile ─────────────────────────────────────────────────────────────
INSERT INTO riders (id, phone)
SELECT u.id, '+962790000001'
FROM auth.users u
WHERE u.email = 'test-rider@wasel.dev'
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- After running this SQL:
--   1. Force-close and reopen both apps (so they re-fetch the profile via API)
--   2. The driver's Go Online button should become active
--   3. The rider should be able to create trips
--
-- No logout/login required — the cached session JWT is still valid.
-- =============================================================================
