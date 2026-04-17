-- ============================================================
-- Migration 006: Dispatch improvements and subscription integrity
-- ============================================================
--
-- 1. became_available_at: tracks the exact moment a driver
--    becomes available so the dispatch engine can compute real
--    idle-time for BMP scoring (replaces the stale idle_time_minutes
--    column that was never maintained).
--
-- 2. supabase_realtime for trips: the rider app subscribes to
--    postgres_changes on the trips table to receive live status
--    updates (driver accepted, en_route, arrived, etc.).
--    Without this, Realtime events are silently dropped and the
--    rider home screen never leaves the "Finding drivers..." state.
--
-- 3. update_driver_activity_score: atomic EMA update function so
--    the backend does not need a read-modify-write round-trip when
--    scoring driver reliability after each trip completion or
--    driver-initiated cancellation.
-- ============================================================

-- (1) Track driver idle time from a real timestamp
ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS became_available_at timestamptz;

-- (2) Enable Realtime for trips so riders get live status events
ALTER PUBLICATION supabase_realtime ADD TABLE trips;

-- (3) Atomic activity-score update (exponential moving average)
--
-- p_completed = true  → reward completion:   score = 0.9s + 0.1
-- p_completed = false → penalise driver cancel: score = 0.9s + 0.0
--
-- Result is clamped to [0.0, 1.0].
-- SECURITY DEFINER so the backend can call this via the service role
-- without needing UPDATE on drivers through the anon role.
CREATE OR REPLACE FUNCTION update_driver_activity_score(
  p_driver_id uuid,
  p_completed  boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE drivers
  SET activity_score = GREATEST(0.0, LEAST(1.0,
    0.9 * COALESCE(activity_score, 0.5)
    + CASE WHEN p_completed THEN 0.1 ELSE 0.0 END
  ))
  WHERE id = p_driver_id;
END;
$$;

-- Grant execute to the service role (used by the backend)
GRANT EXECUTE ON FUNCTION update_driver_activity_score(uuid, boolean) TO service_role;
