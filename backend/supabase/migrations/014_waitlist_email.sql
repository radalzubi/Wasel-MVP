-- Migration 014: add optional email column to waitlist
-- Allows riders/drivers to provide an email when joining the waitlist
-- so we can notify them when the app launches.

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS email TEXT;
