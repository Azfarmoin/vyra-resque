-- Multi-channel delivery (safe to run more than once).
-- Run in the Supabase SQL editor after 001-015. Needed only for the radio / SMS / Bluetooth gateway features:
-- the normal internet submission works without it.

ALTER TABLE emergency_reports
  ADD COLUMN IF NOT EXISTS ingest_channel TEXT
    CHECK (ingest_channel IS NULL OR ingest_channel IN ('internet', 'radio', 'sms', 'bluetooth', 'manual')),  -- how the FIRST copy reached VYRA
  ADD COLUMN IF NOT EXISTS partial BOOLEAN NOT NULL DEFAULT FALSE;  -- only the short emergency message has arrived so far

-- A short message creates a "partial" report. The full report (same client_id) later completes it in place.
CREATE INDEX IF NOT EXISTS idx_emergency_reports_partial ON emergency_reports(partial) WHERE partial;
