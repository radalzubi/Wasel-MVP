-- ============================================================
-- Migration 004: Waitlist membership fields on riders/drivers
-- ============================================================
--
-- waitlist_position: populated when the rider/driver first signs up
-- by counting how many waitlist entries existed at or before their
-- phone's waitlist entry (i.e. position = count of rows with
-- created_at <= their waitlist row's created_at).
-- ============================================================

-- RIDERS: add waitlist membership columns
alter table riders
  add column if not exists is_waitlist_member  boolean      default false,
  add column if not exists waitlist_joined_at  timestamptz,
  add column if not exists waitlist_position   int;

-- DRIVERS: add waitlist membership columns
alter table drivers
  add column if not exists is_waitlist_member  boolean      default false,
  add column if not exists waitlist_joined_at  timestamptz,
  add column if not exists waitlist_position   int;

-- Chronological indexes (used when querying riders/drivers in signup order)
create index if not exists riders_created_at_idx  on riders(created_at);
create index if not exists drivers_created_at_idx on drivers(created_at);

-- RLS policies: riders/drivers can read their own waitlist membership status
-- (existing self-read policies already cover all columns via SELECT *, so
-- these explicit policies are provided for clarity / future column-level RLS)

-- No additional policies needed: the existing "riders_self_read" and
-- "drivers_self_read" policies grant SELECT on all columns for the row owner.
-- If column-level security is enabled in the future, add explicit grants here.
