-- Migration 015: add rating aggregate columns to drivers and riders
-- average_rating: rolling average of all per-trip star ratings (1–5)
-- rating_count:   number of rated trips; used to compute the average
-- Both default to 5.00/0 so new users start at a neutral "no rating yet" state.

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS rating_count   INT          DEFAULT 0;

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS average_rating NUMERIC(3,2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS rating_count   INT          DEFAULT 0;

-- Backfill existing rows from trips that already have ratings.
-- Drivers
UPDATE drivers d
SET
  average_rating = sub.avg_rating,
  rating_count   = sub.cnt
FROM (
  SELECT driver_id,
         ROUND(AVG(driver_rating)::NUMERIC, 2) AS avg_rating,
         COUNT(*)                               AS cnt
  FROM trips
  WHERE driver_rating IS NOT NULL
  GROUP BY driver_id
) sub
WHERE d.id = sub.driver_id;

-- Riders
UPDATE riders r
SET
  average_rating = sub.avg_rating,
  rating_count   = sub.cnt
FROM (
  SELECT rider_id,
         ROUND(AVG(rider_rating)::NUMERIC, 2) AS avg_rating,
         COUNT(*)                             AS cnt
  FROM trips
  WHERE rider_rating IS NOT NULL
  GROUP BY rider_id
) sub
WHERE r.id = sub.rider_id;
