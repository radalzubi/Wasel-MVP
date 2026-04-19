-- =============================================================================
-- Wasel: Production Launch Reset
--
-- Run this in Supabase Dashboard → SQL Editor immediately before going live
-- with real users. Creates a clean slate while preserving everything structural.
--
-- ⚠️  IRREVERSIBLE. Create a full database backup first:
--     Supabase Dashboard → Settings → Database → Create backup
--
-- What this does:
--   1. Deletes all trips and cascaded records (trip_offers, trip_status_history)
--   2. Removes hardcoded test accounts (phone +96279000000x)
--   3. Resets driver online/GPS/token state without deleting their profiles
--      (real approved drivers keep their account and vehicle details)
--   4. Clears rider push tokens (re-registered automatically on next app open)
--   5. Removes test waitlist entries
--
-- What this does NOT do:
--   - Does not delete real driver accounts or vehicle registrations
--   - Does not delete real rider accounts
--   - Does not drop any tables, indexes, or functions
--   - Does not touch the Supabase Auth user table (see manual step below)
-- =============================================================================

BEGIN;

-- ── 1. Trip data (cascade deletes trip_offers + trip_status_history) ──────
TRUNCATE TABLE trips CASCADE;

-- ── 2. Remove test driver and rider accounts ──────────────────────────────
-- These are the hardcoded dev accounts created by the backend test bypass.
-- Phone numbers match DEV_USERS in backend/src/routes/auth.ts.
DELETE FROM drivers WHERE phone IN ('+962790000001', '+962790000002');
DELETE FROM riders  WHERE phone IN ('+962790000001', '+962790000002');

-- ── 3. Reset all driver status fields ────────────────────────────────────
-- Keeps name, vehicle, approval, and subscription — only clears runtime state.
UPDATE drivers SET
  is_online           = false,
  is_available        = false,
  became_available_at = null,
  location_lat        = null,
  location_lng        = null,
  push_token          = null,
  activity_score      = 0.5,
  bmp_score           = null;

-- ── 4. Clear rider push tokens ────────────────────────────────────────────
-- Tokens expire after ~1 month. Clear them now; riders re-register on next open.
UPDATE riders SET push_token = null;

-- ── 5. Remove test waitlist entries ──────────────────────────────────────
DELETE FROM waitlist WHERE phone IN ('+962790000001', '+962790000002');

COMMIT;

-- =============================================================================
-- MANUAL STEP (required after running this SQL):
--
-- Delete the test Supabase Auth users manually:
--   1. Open Supabase Dashboard → Authentication → Users
--   2. Search for "test-rider@wasel.dev" and delete it
--   3. Search for "test-driver@wasel.dev" and delete it
--
-- These Auth records are not in a directly accessible table so they cannot
-- be deleted via SQL in the SQL Editor.
--
-- After deleting Auth users + running this SQL:
--   - Disable TEST_BYPASS_ENABLED in Railway environment variables
--   - Set NODE_ENV=production in Railway (if not already set)
--   - The backend will then require real OTP for all logins
-- =============================================================================
