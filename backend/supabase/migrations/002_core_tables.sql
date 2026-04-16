-- Enable PostGIS
create extension if not exists postgis;

-- Riders
create table if not exists riders (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  name text,
  created_at timestamptz default now()
);

-- Drivers
create table if not exists drivers (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text unique not null,
  name text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  is_online boolean default false,
  is_available boolean default true,
  subscription_tier int default 1 check (subscription_tier in (1, 2, 3)),
  activity_score float default 0.5,
  idle_time_minutes int default 0,
  current_location geography(Point, 4326),
  created_at timestamptz default now()
);

create index if not exists drivers_online_idx on drivers(is_online, is_available);

-- Trips
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid references riders(id),
  driver_id uuid references drivers(id),
  status text not null default 'requested'
    check (status in ('requested','dispatching','accepted','en_route','arrived','in_progress','completed','cancelled')),
  pickup_location geography(Point, 4326) not null,
  dropoff_location geography(Point, 4326) not null,
  pickup_address text,
  dropoff_address text,
  fare_amount decimal(10,2),
  payment_method text default 'cash' check (payment_method in ('cash', 'cliq')),
  bmp_score float,
  created_at timestamptz default now(),
  completed_at timestamptz
);

create index if not exists trips_rider_idx on trips(rider_id);
create index if not exists trips_driver_idx on trips(driver_id);
create index if not exists trips_status_idx on trips(status);

-- Trip offers (realtime dispatch delivery)
create table if not exists trip_offers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  driver_id uuid references drivers(id),
  status text default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz default (now() + interval '15 seconds'),
  created_at timestamptz default now()
);

-- Enable Supabase Realtime on trip_offers
alter publication supabase_realtime add table trip_offers;

-- Driver subscriptions
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references drivers(id),
  tier int not null check (tier in (1, 2, 3)),
  started_at timestamptz default now(),
  expires_at timestamptz not null,
  amount_jd decimal(10,2)
);

-- Trip status history (immutable audit log)
create table if not exists trip_status_history (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  status text not null,
  changed_at timestamptz default now()
);
