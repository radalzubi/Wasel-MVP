-- ============================================================
-- Migration 007: Plain lat/lng columns on drivers table
-- ============================================================
--
-- Supabase REST API returns PostGIS geometry columns as WKB hex
-- strings, not GeoJSON objects.  The dispatch engine cannot call
-- `.coordinates` on a hex string, so every driver was silently
-- filtered out (no GPS) and trips were immediately cancelled.
--
-- Fix: add plain double-precision columns alongside the geometry.
-- The PATCH /api/drivers/location endpoint writes both formats;
-- the dispatch engine reads the plain columns for arithmetic.
-- ============================================================

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS location_lat double precision,
  ADD COLUMN IF NOT EXISTS location_lng double precision;

-- Back-fill from existing geometry
UPDATE drivers
SET
  location_lat = ST_Y(current_location::geometry),
  location_lng = ST_X(current_location::geometry)
WHERE current_location IS NOT NULL;
