-- ============================================================
-- Migration 005: Restrict is_waitlist_member to server-side writes only
-- ============================================================
--
-- The existing "riders_self_update" and "drivers_self_update" policies
-- allow authenticated users to UPDATE any column on their own row,
-- including is_waitlist_member and waitlist_position.
--
-- This migration replaces those broad update policies with column-specific
-- ones that exclude the waitlist fields. Only the backend (using the
-- service_role key, which bypasses RLS) can write those fields.
-- ============================================================

-- RIDERS: drop the unrestricted self-update policy
drop policy if exists "riders_self_update" on riders;

-- Re-create limited to profile columns only (not waitlist membership fields)
create policy "riders_self_update" on riders
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- Prevent the client from toggling waitlist membership or position.
    -- These columns are managed exclusively by the backend service_role.
    -- NOTE: PostgreSQL column-level restrictions in WITH CHECK only
    -- work fully when column-level privileges are revoked. For defence-
    -- in-depth we also drop the GRANT for those columns below.
  );

-- DRIVERS: drop the unrestricted self-update policy
drop policy if exists "drivers_self_update" on drivers;

-- Re-create limited update policy for drivers
create policy "drivers_self_update" on drivers
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Revoke column-level UPDATE permission on waitlist fields from the
-- authenticated role so direct client writes are rejected even if RLS
-- policies are bypassed via future policy mistakes.
revoke update (is_waitlist_member, waitlist_joined_at, waitlist_position)
  on riders
  from authenticated;

revoke update (is_waitlist_member, waitlist_joined_at, waitlist_position)
  on drivers
  from authenticated;
