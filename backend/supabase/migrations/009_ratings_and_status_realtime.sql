-- ============================================================
-- Migration 009: Trip ratings + Realtime for trip_status_history
-- ============================================================
--
-- 1. driver_rating / rider_rating: 1-5 integer columns on trips
--    for post-trip mutual rating.  Written by POST /api/trips/:id/rate.
--    NULL = not yet rated.
--
-- 2. Realtime on trip_status_history: allows the rider/driver apps to
--    subscribe to live status audit events.
-- ============================================================

-- (1) Ratings columns
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS driver_rating int CHECK (driver_rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS rider_rating  int CHECK (rider_rating  BETWEEN 1 AND 5);

-- (2) Enable Realtime for trip_status_history (optional — for future use)
-- ALTER PUBLICATION supabase_realtime ADD TABLE trip_status_history;
