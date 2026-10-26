-- Offline-first reporting (safe to run more than once).
-- Run in the Supabase SQL editor after 001-005.

-- 1. Report fields captured on the device -------------------------------------------------------
ALTER TABLE emergency_reports
  ADD COLUMN IF NOT EXISTS client_id TEXT,                          -- idempotency key (exists since 002)
  ADD COLUMN IF NOT EXISTS submitted_offline BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS client_created_at TIMESTAMPTZ,           -- device clock when queued (unverified)
  ADD COLUMN IF NOT EXISTS incident_time TIMESTAMPTZ,               -- reporter-stated time of the incident (unverified)
  ADD COLUMN IF NOT EXISTS reporter_urgency TEXT
    CHECK (reporter_urgency IS NULL OR reporter_urgency IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ;        -- when the device produced the GPS fix

-- Coordinates are optional so a landmark-only report (no GPS, no map) can still be received.
ALTER TABLE emergency_reports ALTER COLUMN location_lat DROP NOT NULL;
ALTER TABLE emergency_reports ALTER COLUMN location_lng DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_reports_client_id
  ON emergency_reports(client_id) WHERE client_id IS NOT NULL;

-- 2. Photo metadata ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_attachments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id     UUID NOT NULL REFERENCES emergency_reports(id) ON DELETE CASCADE,
  client_id     TEXT NOT NULL,                 -- generated on the device; makes upload retries idempotent
  storage_path  TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_report_attachments_report_id ON report_attachments(report_id);

ALTER TABLE report_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Server can add attachment details" ON report_attachments;
DROP POLICY IF EXISTS "Attachment details are readable" ON report_attachments;
-- Same model as the other tables in this project: the API route (which checks who the caller is) inserts.
CREATE POLICY "Server can add attachment details" ON report_attachments FOR INSERT WITH CHECK (true);
-- Metadata only (path, size, type): contains nothing personal. The image files themselves stay private.
CREATE POLICY "Attachment details are readable" ON report_attachments FOR SELECT USING (true);

-- 3. Private storage bucket --------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-attachments', 'report-attachments', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = FALSE, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Insert-only for the API (publishable key). There is deliberately NO select/update/delete policy,
-- so the files cannot be listed or downloaded with the publishable key. Responders read photos
-- through GET /api/reports/:id/attachments/:aid, which uses SUPABASE_SERVICE_ROLE_KEY on the server.
DROP POLICY IF EXISTS "Report photos: insert only" ON storage.objects;
CREATE POLICY "Report photos: insert only" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'report-attachments');
