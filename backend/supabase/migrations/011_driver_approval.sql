-- Migration 011: Driver approval gate
-- Adds is_approved column so admins must vet drivers before they go live.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;

-- Existing drivers who were manually inserted are considered approved.
-- This UPDATE runs after the column is added, so it's safe.
UPDATE drivers SET is_approved = true WHERE is_approved = false;
