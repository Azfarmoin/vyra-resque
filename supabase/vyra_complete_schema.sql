-- =============================================================================
<<<<<<< HEAD
-- VYRA (Vulnerability, Yielded Response & Assistance) - complete database schema (Stages 1-6)
=======
-- VYRA - complete database schema (Stages 1-6)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
--
-- Based on the original supabase/schema.sql, extended for:
--   Stage 4 - structured emergency reports
--   Stage 5 - verified map layers (shelters, rescue teams, blocked roads)
--   Stage 6 - explainable triage (overrides + audit history)
--
-- Works on BOTH a brand-new Supabase project and the existing database:
-- everything is "create if missing / add if missing", so it is safe to re-run.
-- It replaces migrations 002, 004 and 005. Run it once in the SQL Editor, then
<<<<<<< HEAD
-- (optionally) run seed/vyra_full_seed.sql for the full simulated demo data and accounts.
=======
-- (optionally) run migrations/003_demo_seed.sql for simulated demo data.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extensions and enum types
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('citizen', 'responder', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE report_status AS ENUM ('pending', 'investigating', 'assigned', 'resolved', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Existing databases: add the Stage 6 'cancelled' status (for duplicates / false alarms).
ALTER TYPE report_status ADD VALUE IF NOT EXISTS 'cancelled';

DO $$ BEGIN CREATE TYPE team_status AS ENUM ('available', 'assigned', 'unavailable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE resource_type AS ENUM ('vehicle', 'boat', 'first_aid', 'medical_supplies', 'food', 'water');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE resource_status AS ENUM ('available', 'in_use', 'maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

<<<<<<< HEAD
DO $$ BEGIN CREATE TYPE dispatch_status AS ENUM ('pending', 'en_route', 'on_scene', 'completed', 'cancelled');
=======
DO $$ BEGIN CREATE TYPE dispatch_status AS ENUM ('pending', 'en_route', 'on_scene', 'completed');
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE shelter_status AS ENUM ('open', 'full', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 2. Tables (original Stage 1-3 tables, with Stage 4-6 columns included)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  role user_role DEFAULT 'citizen',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID REFERENCES profiles(id) ON DELETE SET NULL,   -- NULL = anonymous report
  location_lat NUMERIC,
  location_lng NUMERIC,
  location_address TEXT,
  people_count INTEGER,                                          -- NULL = unknown (not "1")
  immediate_danger BOOLEAN DEFAULT FALSE,
  injury_details TEXT,
  medical_needs TEXT,                                            -- free-text medical details
  contact_info TEXT,
  status report_status DEFAULT 'pending',
  priority_score INTEGER DEFAULT 0,                              -- triage score (not capped at 100)
  priority_explanation JSONB,                                    -- full triage explanation snapshot
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rescue_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_name TEXT NOT NULL,
  team_leader TEXT,
  contact_number TEXT,
  capabilities TEXT[],
  current_location_lat NUMERIC,
  current_location_lng NUMERIC,
  status team_status DEFAULT 'available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource_type resource_type NOT NULL,
  quantity INTEGER DEFAULT 1,
  team_id UUID REFERENCES rescue_teams(id) ON DELETE SET NULL,
  status resource_status DEFAULT 'available',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES emergency_reports(id) ON DELETE CASCADE,
  team_id UUID REFERENCES rescue_teams(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES profiles(id),
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status dispatch_status DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shelters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  location_lat NUMERIC,
  location_lng NUMERIC,
  address TEXT,
  capacity INTEGER,
  current_occupancy INTEGER DEFAULT 0,
  contact_number TEXT,
  status shelter_status DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stage 6: audit history - status changes, verification, priority overrides (append-only)
CREATE TABLE IF NOT EXISTS report_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID NOT NULL REFERENCES emergency_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('created', 'status', 'verify', 'override', 'override_cleared')),
  actor TEXT NOT NULL DEFAULT 'system',
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Stage 5: blocked roads shown on the map (only verified ones are displayed)
CREATE TABLE IF NOT EXISTS blocked_roads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
<<<<<<< HEAD
  reason TEXT NOT NULL DEFAULT 'other' CHECK (reason IN ('flooding', 'debris', 'collapse', 'structural', 'other')),
=======
  reason TEXT NOT NULL DEFAULT 'other' CHECK (reason IN ('flooding', 'debris', 'collapse', 'other')),
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  area TEXT,
  path JSONB NOT NULL,                       -- [[lat, lng], [lat, lng], ...]
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- -----------------------------------------------------------------------------
-- 3. Stage 4-6 columns (added to existing tables; no-ops on a fresh database)
-- -----------------------------------------------------------------------------
ALTER TABLE emergency_reports
  ADD COLUMN IF NOT EXISTS client_id TEXT,                         -- device-generated id: retries never duplicate
  ADD COLUMN IF NOT EXISTS location_source TEXT DEFAULT 'manual',  -- 'gps' | 'manual'
  ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC,
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS dangers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS danger_details TEXT,
  ADD COLUMN IF NOT EXISTS injury_severity TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS injury_count INTEGER,
  ADD COLUMN IF NOT EXISTS medical_need_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS can_evacuate TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS vulnerabilities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS triage_override JSONB;                  -- { priority, reason, by, at }

ALTER TABLE shelters
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS services TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rescue_teams
  ADD COLUMN IF NOT EXISTS area TEXT,
  ADD COLUMN IF NOT EXISTS team_type TEXT,                         -- boat | medical | search_rescue | fire | logistics
  ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;


-- -----------------------------------------------------------------------------
-- 4. Bring an existing database in line with this schema
-- -----------------------------------------------------------------------------
-- Unknown people count must stay NULL, not silently become 1.
ALTER TABLE emergency_reports ALTER COLUMN people_count DROP DEFAULT;

-- Optional fields must be optional (the live DB required reporter_id, which
-- blocked anonymous reports - people in an emergency must not need an account).
DO $$
DECLARE col record;
BEGIN
  FOR col IN
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND is_nullable = 'NO'
      AND (table_name, column_name) IN (
        ('emergency_reports', 'reporter_id'), ('emergency_reports', 'location_address'),
        ('emergency_reports', 'people_count'), ('emergency_reports', 'injury_details'),
        ('emergency_reports', 'medical_needs'), ('emergency_reports', 'contact_info'),
        ('emergency_reports', 'priority_explanation'),
        ('shelters', 'address'), ('shelters', 'capacity'), ('shelters', 'contact_number'),
        ('shelters', 'current_occupancy'),
        ('rescue_teams', 'team_leader'), ('rescue_teams', 'contact_number'),
        ('rescue_teams', 'capabilities'))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', col.table_name, col.column_name);
    RAISE NOTICE 'Made %.% optional', col.table_name, col.column_name;
  END LOOP;
END $$;

-- Replace any older CHECK rules on emergency_reports (e.g. the old 0-100 cap on
-- priority_score) with the Stage 4-6 rules below.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.emergency_reports'::regclass AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.emergency_reports DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE 'Dropped old check constraint %', c.conname;
  END LOOP;
END $$;

-- NOT VALID: enforced for new/updated rows without failing on old data.
ALTER TABLE emergency_reports
  ADD CONSTRAINT emergency_reports_priority_score_check CHECK (priority_score >= 0) NOT VALID,
  ADD CONSTRAINT emergency_reports_people_count_check CHECK (people_count IS NULL OR people_count >= 1) NOT VALID,
  ADD CONSTRAINT emergency_reports_location_source_check CHECK (location_source IN ('gps', 'manual')) NOT VALID,
  ADD CONSTRAINT emergency_reports_injury_severity_check CHECK (injury_severity IN ('none', 'minor', 'serious', 'critical', 'unknown')) NOT VALID,
  ADD CONSTRAINT emergency_reports_injury_count_check CHECK (injury_count IS NULL OR injury_count >= 0) NOT VALID,
  ADD CONSTRAINT emergency_reports_can_evacuate_check CHECK (can_evacuate IN ('yes', 'no', 'unknown')) NOT VALID;


<<<<<<< HEAD
-- Blocked-road reasons: 'structural' (cracked bridges, damaged embankments) is allowed too.
-- Replaces the older 4-value rule on existing databases; safe to re-run.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.blocked_roads'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.blocked_roads DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE blocked_roads
  ADD CONSTRAINT blocked_roads_reason_check CHECK (reason IN ('flooding', 'debris', 'collapse', 'structural', 'other'));


=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_emergency_reports_status ON emergency_reports(status);
CREATE INDEX IF NOT EXISTS idx_emergency_reports_location ON emergency_reports(location_lat, location_lng);
CREATE INDEX IF NOT EXISTS idx_emergency_reports_created_at ON emergency_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_emergency_reports_area ON emergency_reports(area);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_reports_client_id ON emergency_reports(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rescue_teams_status ON rescue_teams(status);
CREATE INDEX IF NOT EXISTS idx_dispatches_report_id ON dispatches(report_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_team_id ON dispatches(team_id);
CREATE INDEX IF NOT EXISTS idx_report_events_report_id ON report_events(report_id, created_at);


-- -----------------------------------------------------------------------------
-- 6. updated_at triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'emergency_reports', 'rescue_teams', 'resources', 'dispatches', 'shelters', 'blocked_roads'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 7. Row Level Security
--    Removes every existing policy first. This fixes the live error
--    'infinite recursion detected in policy for relation "profiles"'
--    (a profiles policy that queried profiles), then recreates the same open
--    rules as the original schema. Stage 9 should tighten these using
--    current_user_role(), which reads the role without triggering RLS.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role::TEXT FROM public.profiles WHERE id = auth.uid() $$;

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('profiles', 'emergency_reports', 'rescue_teams', 'resources', 'dispatches',
                        'shelters', 'report_events', 'blocked_roads')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE rescue_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelters ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_roads ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "Public profiles are viewable by everyone" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile" ON profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (true);

-- Emergency reports
CREATE POLICY "Anyone can view reports" ON emergency_reports FOR SELECT USING (true);
CREATE POLICY "Anyone can create reports" ON emergency_reports FOR INSERT WITH CHECK (true);
CREATE POLICY "Responders and admins can update reports" ON emergency_reports FOR UPDATE USING (true);

-- Rescue teams
CREATE POLICY "Anyone can view teams" ON rescue_teams FOR SELECT USING (true);
CREATE POLICY "Admins can create teams" ON rescue_teams FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can update teams" ON rescue_teams FOR UPDATE USING (true);

-- Resources
CREATE POLICY "Anyone can view resources" ON resources FOR SELECT USING (true);
CREATE POLICY "Admins can manage resources" ON resources FOR ALL USING (true);

-- Dispatches
CREATE POLICY "Anyone can view dispatches" ON dispatches FOR SELECT USING (true);
CREATE POLICY "Responders and admins can create dispatches" ON dispatches FOR INSERT WITH CHECK (true);
CREATE POLICY "Responders and admins can update dispatches" ON dispatches FOR UPDATE USING (true);

-- Shelters
CREATE POLICY "Anyone can view shelters" ON shelters FOR SELECT USING (true);
CREATE POLICY "Admins can manage shelters" ON shelters FOR ALL USING (true);

-- Report events: append-only (no UPDATE/DELETE policy, so history cannot be edited via the API)
CREATE POLICY "Anyone can view report events" ON report_events FOR SELECT USING (true);
CREATE POLICY "Anyone can add report events" ON report_events FOR INSERT WITH CHECK (true);

-- Blocked roads
CREATE POLICY "Anyone can view blocked roads" ON blocked_roads FOR SELECT USING (true);
CREATE POLICY "Admins can manage blocked roads" ON blocked_roads FOR ALL USING (true);


-- Make the API (PostgREST) pick up the changes immediately.
NOTIFY pgrst, 'reload schema';
