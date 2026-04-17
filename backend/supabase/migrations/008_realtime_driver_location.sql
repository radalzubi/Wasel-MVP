-- Migration 008: Add drivers table to Realtime publication + belt-and-suspenders
--               trip read policy for drivers.
--
-- Problem fixed:
--   1. Riders could not see the driver's live location on the map after a trip
--      was accepted because the `drivers` table was not in the Realtime
--      publication.  The existing RLS policy (riders_read_active_driver) already
--      allowed riders to SELECT driver rows for their active trip — the only
--      missing piece was the Realtime subscription event stream.
--
--   2. In rare timing windows the driver's JWT might arrive at the DB before the
--      trip row's driver_id column is updated (though in practice driver_id is
--      written before the trip_offer INSERT).  The new policy provides a
--      belt-and-suspenders read path via trip_offers.

-- 1. Enable Realtime streaming for the drivers table.
--    RLS on drivers already restricts which rows each subscriber can receive:
--      • drivers_self_read      — drivers see their own row
--      • riders_read_active_driver — riders see the driver for their active trip
ALTER PUBLICATION supabase_realtime ADD TABLE drivers;

-- 2. Allow drivers to SELECT a trip row if they have any offer for it
--    (complements the existing trips_driver_read policy which requires driver_id = auth.uid()).
CREATE POLICY trips_driver_offer_read ON trips
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trip_offers
      WHERE trip_offers.trip_id = trips.id
        AND trip_offers.driver_id = auth.uid()
    )
  );
