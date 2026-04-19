-- Migration 012: Remove unused PostGIS geometry columns
--
-- Context: drivers.current_location, trips.pickup_location, and
-- trips.dropoff_location were created in migration 002 but have never
-- been read by any active code path. The backend uses plain float columns
-- (location_lat/lng, pickup_lat/lng, dropoff_lat/lng) for all distance
-- calculations (JS haversine in dispatch/geo.ts).
--
-- Migration 010 already made pickup_location / dropoff_location nullable
-- so new inserts work without them. This migration drops them entirely to:
--   1. Remove the storage overhead on every row
--   2. Remove the write overhead (PostGIS geography columns are expensive to update)
--   3. Eliminate the confusing dead columns from the schema
--
-- Safe to run: grep the entire codebase for "current_location",
-- "pickup_location", "dropoff_location" — zero results outside migrations.
-- =========================================================================

ALTER TABLE drivers DROP COLUMN IF EXISTS current_location;
ALTER TABLE trips   DROP COLUMN IF EXISTS pickup_location;
ALTER TABLE trips   DROP COLUMN IF EXISTS dropoff_location;

-- If PostGIS is no longer needed for anything else in the project,
-- the extension itself can be removed. Uncomment only if you are certain
-- no other tables, views, or functions depend on it.
-- DROP EXTENSION IF EXISTS postgis;
