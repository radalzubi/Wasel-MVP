-- ============================================================
-- Migration 003: RLS policies + raw coordinate columns
-- ============================================================

-- Add plain float columns to trips so clients can read coords
-- without PostGIS functions (avoids WKB hex parsing on frontend)
alter table trips add column if not exists pickup_lat  float;
alter table trips add column if not exists pickup_lng  float;
alter table trips add column if not exists dropoff_lat float;
alter table trips add column if not exists dropoff_lng float;

-- ============================================================
-- Row Level Security
-- NOTE: The backend uses the service_role key which bypasses RLS.
--       These policies protect direct client (anon key) access,
--       including Realtime subscriptions from the mobile apps.
-- ============================================================

-- RIDERS ---------------------------------------------------
alter table riders enable row level security;

create policy "riders_self_read"   on riders for select using (auth.uid() = id);
create policy "riders_self_insert" on riders for insert with check (auth.uid() = id);
create policy "riders_self_update" on riders for update using (auth.uid() = id);

-- DRIVERS --------------------------------------------------
alter table drivers enable row level security;

-- Drivers manage their own profile
create policy "drivers_self_read"   on drivers for select using (auth.uid() = id);
create policy "drivers_self_update" on drivers for update using (auth.uid() = id);

-- Riders with an active trip can read their assigned driver's info
create policy "riders_read_active_driver" on drivers
  for select using (
    exists (
      select 1 from trips
      where trips.driver_id = drivers.id
        and trips.rider_id  = auth.uid()
        and trips.status in ('dispatching','accepted','en_route','arrived','in_progress')
    )
  );

-- TRIPS ----------------------------------------------------
alter table trips enable row level security;

create policy "trips_rider_insert" on trips
  for insert with check (auth.uid() = rider_id);

create policy "trips_rider_read" on trips
  for select using (auth.uid() = rider_id);

create policy "trips_driver_read" on trips
  for select using (auth.uid() = driver_id);

-- Riders can update (cancel) their own trips
create policy "trips_rider_update" on trips
  for update using (auth.uid() = rider_id);

-- Drivers can advance status on their assigned trips
create policy "trips_driver_update" on trips
  for update using (auth.uid() = driver_id);

-- TRIP_OFFERS ----------------------------------------------
alter table trip_offers enable row level security;

-- Drivers receive their own offers via Realtime
create policy "offers_driver_read" on trip_offers
  for select using (auth.uid() = driver_id);

-- SUBSCRIPTIONS --------------------------------------------
alter table subscriptions enable row level security;

create policy "subscriptions_driver_read" on subscriptions
  for select using (auth.uid() = driver_id);

-- TRIP_STATUS_HISTORY --------------------------------------
alter table trip_status_history enable row level security;

create policy "history_participant_read" on trip_status_history
  for select using (
    exists (
      select 1 from trips
      where trips.id = trip_status_history.trip_id
        and (trips.rider_id = auth.uid() or trips.driver_id = auth.uid())
    )
  );
