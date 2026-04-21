-- 013_trip_last_activity_at.sql
-- Introduce trips.last_activity_at to replace the incorrect use of created_at
-- as an activity/staleness signal in live-trip restore paths.
--
-- created_at is the birth timestamp of the trip row — it never changes after
-- insert. Using it to reason about "is this trip still alive / how recently
-- did anything happen on it" has been silently wrong for every long ride
-- (airport runs, rush hour trips, cross-city fares) and is the deep cause of
-- the reopen-crash-loop where a restored "live" trip snaps back into an
-- inconsistent state.
--
-- last_activity_at is bumped by every state-transition path:
--   - row insert (DEFAULT now())
--   - driver accepting the offer
--   - every status transition (en_route / arrived / in_progress / completed / cancelled)
--   - each driver GPS ping while the trip is live
--
-- Restore routes (/api/trips/active, /api/trips/driver-active) order by
-- last_activity_at DESC so if multiple live trips exist (a data-integrity
-- violation), the one with the most recent real activity wins.

-- ── 1. Add the column ────────────────────────────────────────────────────
-- NOT NULL with a DEFAULT lets PostgreSQL backfill existing rows atomically
-- without table rewrite (a metadata-only operation on Postgres 11+). We
-- explicitly override the default immediately below to use a more useful
-- value for historical rows.
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

-- ── 2. Backfill historical rows ──────────────────────────────────────────
-- Best-effort: completed_at if the trip finished, else created_at. Never
-- leaves the column behind "now at migration time" which would make every
-- historical row look artificially fresh after deploy.
UPDATE trips
SET last_activity_at = COALESCE(completed_at, created_at)
WHERE last_activity_at IS NULL
   OR last_activity_at = created_at  -- touch rows that took the DEFAULT
   OR last_activity_at > COALESCE(completed_at, created_at);

-- ── 3. Partial index for live-trip restore queries ───────────────────────
-- /api/trips/active and /api/trips/driver-active both do:
--   WHERE {rider,driver}_id = $1 AND status IN (live) ORDER BY last_activity_at DESC
-- A partial index keyed on the live-status subset keeps this index tiny
-- (terminal rows — the vast majority — are excluded) while still answering
-- the hot query in index order, no sort.
CREATE INDEX IF NOT EXISTS trips_live_activity_idx
  ON trips (last_activity_at DESC)
  WHERE status IN ('accepted', 'en_route', 'arrived', 'in_progress');

-- Also ensure the most common restore filters are covered. The per-user
-- indexes already exist (trips_rider_idx, trips_driver_idx from 002) so
-- PostgreSQL can bitmap-AND them with the live_activity_idx if needed.
