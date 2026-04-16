-- Waitlist table
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text not null,
  role text not null check (role in ('rider', 'driver')),
  city text,
  vehicle_type text,
  referral_code text,
  created_at timestamptz default now()
);

create index if not exists waitlist_role_idx on waitlist(role);
create index if not exists waitlist_created_at_idx on waitlist(created_at);
