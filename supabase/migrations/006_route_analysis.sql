-- 006: AI Route and Hazard Analysis (audit trail + optional hazard verification fields)
-- Safe to run more than once. Run in the Supabase SQL editor after 001-005.
--
-- Part 1 adds OPTIONAL columns. The app works without them (it reads them only when present), but
-- without them route_hazards can never be "confirmed", because that table had no verification info.
-- Part 2 creates the audit tables. Without them, route analysis still runs but approval stays disabled.

-- ---- Part 1: hazard provenance ------------------------------------------------------------------
ALTER TABLE route_hazards
  ADD COLUMN IF NOT EXISTS hazard_type TEXT CHECK (hazard_type IN ('road_closure','flooding','damaged_infrastructure','structural_collapse','debris','fire','landslide','electrical','gas_leak','other')),
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','confirmed','resolved','expired')),
  ADD COLUMN IF NOT EXISTS blocks_road BOOLEAN,                -- NULL = unknown whether the road is closed
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS evidence JSONB;                     -- array of short strings

ALTER TABLE blocked_roads
  ADD COLUMN IF NOT EXISTS verification_status TEXT CHECK (verification_status IN ('unverified','confirmed','resolved','expired')),
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS evidence JSONB;

-- ---- Part 2: audit tables ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_analyses (
  id UUID PRIMARY KEY,
  requested_by UUID NOT NULL REFERENCES profiles(id),
  analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  vehicle TEXT NOT NULL,
  origin_lat NUMERIC NOT NULL,
  origin_lng NUMERIC NOT NULL,
  destination_lat NUMERIC NOT NULL,
  destination_lng NUMERIC NOT NULL,
  provider TEXT NOT NULL,
  data_sources JSONB NOT NULL DEFAULT '[]',       -- per-source status, counts, newest record time
  skipped_records INTEGER NOT NULL DEFAULT 0,
  hazard_ids TEXT[] NOT NULL DEFAULT '{}',        -- ids across route_hazards / blocked_roads / emergency_reports
  candidates JSONB NOT NULL DEFAULT '[]',         -- summaries: status, distance, duration, hazard ids, limitation codes
  newest_record_at TIMESTAMP WITH TIME ZONE,
  ai_state TEXT,
  notices JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_decisions (
  id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL REFERENCES route_analyses(id) ON DELETE CASCADE,
  candidate_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  note TEXT,
  acknowledged_limitations BOOLEAN NOT NULL DEFAULT FALSE,
  candidate_status TEXT NOT NULL,
  decided_by UUID NOT NULL REFERENCES profiles(id),
  decided_by_name TEXT,
  decided_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_analyses_requested_by ON route_analyses(requested_by, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_route_decisions_analysis ON route_decisions(analysis_id);

-- Row-level security. Unlike the older open policies, these use the role of the signed-in user
-- (public.current_user_role(), defined in vyra_complete_schema.sql) and cannot be edited afterwards.
ALTER TABLE route_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Responders read route analyses" ON route_analyses;
CREATE POLICY "Responders read route analyses" ON route_analyses FOR SELECT
  USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Responders add own route analyses" ON route_analyses;
CREATE POLICY "Responders add own route analyses" ON route_analyses FOR INSERT
  WITH CHECK (public.current_user_role() IN ('responder','admin') AND requested_by = auth.uid());

DROP POLICY IF EXISTS "Responders read route decisions" ON route_decisions;
CREATE POLICY "Responders read route decisions" ON route_decisions FOR SELECT
  USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Responders add own route decisions" ON route_decisions;
CREATE POLICY "Responders add own route decisions" ON route_decisions FOR INSERT
  WITH CHECK (public.current_user_role() IN ('responder','admin') AND decided_by = auth.uid());

NOTIFY pgrst, 'reload schema';
