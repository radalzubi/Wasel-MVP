-- =========================================================================
-- Migration 010: Schema Fixes for MVP Launch
-- Run via Supabase Dashboard → SQL Editor
-- =========================================================================

-- 1. Fix PostGIS NOT NULL blocker
-- pickup_location and dropoff_location are geography(Point,4326) NOT NULL
-- but the backend never writes them — every POST /api/trips silently fails.
ALTER TABLE trips
  ALTER COLUMN pickup_location  DROP NOT NULL,
  ALTER COLUMN dropoff_location DROP NOT NULL;

-- 2. Partial unique index — one active trip per rider (TOCTOU protection)
CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_rider
  ON trips (rider_id)
  WHERE status NOT IN ('completed', 'cancelled');

-- 3. Performance indexes
CREATE INDEX IF NOT EXISTS trip_offers_status_expires_idx
  ON trip_offers (status, expires_at);

CREATE INDEX IF NOT EXISTS trip_offers_driver_id_idx
  ON trip_offers (driver_id);

CREATE INDEX IF NOT EXISTS trips_status_created_idx
  ON trips (status, created_at);

CREATE INDEX IF NOT EXISTS subscriptions_driver_expires_idx
  ON subscriptions (driver_id, expires_at);

-- 4. Push token columns (needed for Task 3 push notifications)
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS push_token text;
ALTER TABLE riders  ADD COLUMN IF NOT EXISTS push_token text;

-- 5. Waitlist RLS (phone numbers are PII, currently unprotected)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'waitlist'
      AND policyname = 'waitlist_public_insert'
  ) THEN
    CREATE POLICY "waitlist_public_insert"
      ON waitlist FOR INSERT
      WITH CHECK (true);
  END IF;
END$$;

-- 6. Drop dead column
ALTER TABLE drivers DROP COLUMN IF EXISTS idle_time_minutes;

-- 7. Add CHECK constraint to trip_status_history
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname    = 'trip_status_history_status_check'
      AND conrelid   = 'trip_status_history'::regclass
  ) THEN
    ALTER TABLE trip_status_history
      ADD CONSTRAINT trip_status_history_status_check
      CHECK (status IN ('requested','dispatching','accepted','en_route','arrived','in_progress','completed','cancelled'));
  END IF;
END$$;
