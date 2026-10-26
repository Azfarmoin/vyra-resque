-- VYRA Stages 4-6: emergency reporting, live disaster map, explainable triage.
-- Run once in the Supabase SQL Editor after supabase/schema.sql. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Fix "infinite recursion detected in policy for relation profiles".
--    A policy on profiles that queries profiles recurses forever and breaks every
--    table whose policy checks profiles (emergency_reports could not be read).
--    Replace all profiles policies with the non-recursive ones from schema.sql, and
--    give later role checks a SECURITY DEFINER helper that bypasses RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role::TEXT FROM public.profiles WHERE id = auth.uid() $$;

-- Needed by the updated_at triggers below (exists if schema.sql was run; harmless otherwise).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public' AND tablename IN ('profiles', 'emergency_reports') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Same (open) rules as schema.sql. Stage 9 tightens these with current_user_role().
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (true);

CREATE POLICY "Anyone can view reports" ON emergency_reports FOR SELECT USING (true);
CREATE POLICY "Anyone can create reports" ON emergency_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Responders and admins can update reports" ON emergency_reports FOR UPDATE USING (true);

-- ---------------------------------------------------------------------------
-- 1. Stage 4 - structured emergency reports
-- ---------------------------------------------------------------------------
-- Allow the 'cancelled' status whether status is the report_status enum or plain text.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'report_status') THEN
    ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'cancelled';
  END IF;
END $$;

ALTER TABLE emergency_reports
  ADD COLUMN IF NOT EXISTS client_id TEXT,                       -- generated on the device; makes retries idempotent
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual' CHECK (location_source IN ('gps', 'manual')),
  ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC,
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS dangers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS danger_details TEXT,
  ADD COLUMN IF NOT EXISTS injury_severity TEXT NOT NULL DEFAULT 'unknown'
    CHECK (injury_severity IN ('none', 'minor', 'serious', 'critical', 'unknown')),
  ADD COLUMN IF NOT EXISTS injury_count INTEGER CHECK (injury_count >= 0),
  ADD COLUMN IF NOT EXISTS medical_need_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_evacuate TEXT NOT NULL DEFAULT 'unknown' CHECK (can_evacuate IN ('yes', 'no', 'unknown')),
  ADD COLUMN IF NOT EXISTS vulnerabilities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
  -- Stage 6: a responder's decision { priority, reason, by, at }. NULL = use the suggestion.
  ADD COLUMN IF NOT EXISTS triage_override JSONB;

-- Unknown people count must stay NULL (unknown), not silently become 1.
ALTER TABLE emergency_reports ALTER COLUMN people_count DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_reports_client_id ON emergency_reports(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emergency_reports_area ON emergency_reports(area);

-- ---------------------------------------------------------------------------
-- 2. Stage 6 - audit history (status changes, verification, priority overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES emergency_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'status', 'verify', 'override', 'override_cleared')),
  actor TEXT NOT NULL DEFAULT 'system',
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_report_events_report_id ON report_events(report_id, created_at);
ALTER TABLE report_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view report events" ON report_events;
DROP POLICY IF EXISTS "Anyone can add report events" ON report_events;
CREATE POLICY "Anyone can view report events" ON report_events FOR SELECT USING (true);
-- Append-only: no UPDATE/DELETE policies, so history cannot be edited through the API.
CREATE POLICY "Anyone can add report events" ON report_events FOR INSERT WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Stage 5 - verified map layers
-- ---------------------------------------------------------------------------
ALTER TABLE shelters
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rescue_teams
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS team_type TEXT,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS blocked_roads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'other' CHECK (reason IN ('flooding', 'debris', 'collapse', 'other')),
  area TEXT,
  path JSONB NOT NULL,                      -- [[lat, lng], [lat, lng], ...]
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
ALTER TABLE blocked_roads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view blocked roads" ON blocked_roads;
DROP POLICY IF EXISTS "Admins can manage blocked roads" ON blocked_roads;
CREATE POLICY "Anyone can view blocked roads" ON blocked_roads FOR SELECT USING (true);
CREATE POLICY "Admins can manage blocked roads" ON blocked_roads FOR ALL USING (true);

DROP TRIGGER IF EXISTS update_blocked_roads_updated_at ON blocked_roads;
CREATE TRIGGER update_blocked_roads_updated_at BEFORE UPDATE ON blocked_roads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Ask PostgREST to pick up the new columns immediately.
NOTIFY pgrst, 'reload schema';
