-- VYRA early-warning system (alerts, provider health, push subscriptions, delivery log, audit trail).
-- Safe to run more than once. Requires vyra_complete_schema.sql (profiles, current_user_role(), update_updated_at_column()).
-- Server code writes with the service-role key, which bypasses RLS. Browsers (anon / signed-in) get only what is listed below.

CREATE TABLE IF NOT EXISTS public.disaster_alerts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           TEXT NOT NULL,
  external_alert_id  TEXT NOT NULL,
  origin             TEXT NOT NULL CHECK (origin IN ('official','observation','internal_estimate','manual')),
  hazard_type        TEXT NOT NULL CHECK (hazard_type IN ('heavy_rain','river_flood','cyclone','heatwave','thunderstorm_wind','landslide','wildfire','earthquake','other')),
  severity           TEXT NOT NULL CHECK (severity IN ('information','watch','warning','emergency')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','superseded','expired')),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  instruction        TEXT,
  affected_area      TEXT NOT NULL DEFAULT '',
  geometry           JSONB NOT NULL DEFAULT '[]'::jsonb,       -- array of {description, geometry[], geocodes[]}
  source_url         TEXT,
  source_name        TEXT NOT NULL,
  issued_at          TIMESTAMPTZ NOT NULL,
  starts_at          TIMESTAMPTZ,
  expires_at         TIMESTAMPTZ,
  last_updated_at    TIMESTAMPTZ NOT NULL,
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision           INTEGER NOT NULL DEFAULT 1,
  content_hash       TEXT NOT NULL,
  source_severity    JSONB,
  ai_summary         JSONB,
  review_flags       TEXT[] NOT NULL DEFAULT '{}',
  limitations        TEXT[] NOT NULL DEFAULT '{}',
  raw_source_metadata JSONB,                                    -- only what is needed to review an alert; never credentials
  created_by         TEXT,                                      -- administrator email for manual announcements
  CONSTRAINT disaster_alerts_unique_source UNIQUE (provider, external_alert_id)
);
CREATE INDEX IF NOT EXISTS disaster_alerts_status_expiry_idx ON public.disaster_alerts (status, expires_at);
CREATE INDEX IF NOT EXISTS disaster_alerts_updated_idx ON public.disaster_alerts (last_updated_at DESC);
CREATE INDEX IF NOT EXISTS disaster_alerts_hazard_idx ON public.disaster_alerts (hazard_type, severity);

CREATE TABLE IF NOT EXISTS public.alert_provider_health (
  provider             TEXT PRIMARY KEY,
  enabled              BOOLEAN NOT NULL DEFAULT true,
  configured           BOOLEAN NOT NULL DEFAULT false,
  last_attempt_at      TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  last_error           TEXT,                                    -- sanitised: no URLs or secrets
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_item_count      INTEGER,
  rejected_last_run    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.alert_provider_settings (   -- admin on/off switches only; credentials stay in environment variables
  provider   TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_ingest_issues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  kind              TEXT NOT NULL,
  detail            TEXT NOT NULL,
  external_alert_id TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_ingest_issues_created_idx ON public.alert_ingest_issues (created_at DESC);

CREATE TABLE IF NOT EXISTS public.alert_audit_log (           -- append-only
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor    TEXT NOT NULL,
  action   TEXT NOT NULL,
  alert_id UUID,
  detail   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS alert_audit_log_at_idx ON public.alert_audit_log (at DESC);

CREATE TABLE IF NOT EXISTS public.alert_push_subscriptions (  -- endpoint + keys are secrets: no browser access at all
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  user_id          UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  locations        JSONB NOT NULL DEFAULT '[]'::jsonb,
  hazard_types     TEXT[] NOT NULL DEFAULT '{}',
  minimum_severity TEXT NOT NULL DEFAULT 'warning' CHECK (minimum_severity IN ('information','watch','warning','emergency')),
  language         TEXT NOT NULL DEFAULT 'en',
  failure_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_push_subscriptions_user_idx ON public.alert_push_subscriptions (user_id);

CREATE TABLE IF NOT EXISTS public.alert_notifications (       -- one row per (alert revision, subscriber, kind): the de-duplication guard
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES public.disaster_alerts(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL,
  subscription_id UUID NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('new','update','cancel')),
  outcome         TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','sent','failed','gone')),
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alert_notifications_once UNIQUE (alert_id, revision, subscription_id, kind)
);
CREATE INDEX IF NOT EXISTS alert_notifications_created_idx ON public.alert_notifications (created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_alert_preferences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  selected_locations JSONB NOT NULL DEFAULT '[]'::jsonb,
  hazard_types       TEXT[] NOT NULL DEFAULT '{}',
  minimum_severity   TEXT NOT NULL DEFAULT 'warning' CHECK (minimum_severity IN ('information','watch','warning','emergency')),
  push_enabled       BOOLEAN NOT NULL DEFAULT false,
  language           TEXT NOT NULL DEFAULT 'en',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS update_user_alert_preferences_updated_at ON public.user_alert_preferences;
CREATE TRIGGER update_user_alert_preferences_updated_at BEFORE UPDATE ON public.user_alert_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------- Row Level Security
ALTER TABLE public.disaster_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_provider_health    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_provider_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_ingest_issues      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_alert_preferences   ENABLE ROW LEVEL SECURITY;

-- Alerts are public information, but raw source metadata and administrator identities are not.
DROP POLICY IF EXISTS "Anyone can read alerts" ON public.disaster_alerts;
CREATE POLICY "Anyone can read alerts" ON public.disaster_alerts FOR SELECT USING (true);
REVOKE ALL ON public.disaster_alerts FROM anon, authenticated;
GRANT SELECT (id, provider, external_alert_id, origin, hazard_type, severity, status, title, description, instruction, affected_area, geometry,
              source_url, source_name, issued_at, starts_at, expires_at, last_updated_at, first_seen_at, last_seen_at, revision, content_hash,
              source_severity, ai_summary, review_flags, limitations)
  ON public.disaster_alerts TO anon, authenticated;

-- Operational tables: administrators can read; nobody can write from a browser (the server uses the service role).
DROP POLICY IF EXISTS "Admins read provider health" ON public.alert_provider_health;
CREATE POLICY "Admins read provider health" ON public.alert_provider_health FOR SELECT USING (public.current_user_role() = 'admin');
DROP POLICY IF EXISTS "Admins read provider settings" ON public.alert_provider_settings;
CREATE POLICY "Admins read provider settings" ON public.alert_provider_settings FOR SELECT USING (public.current_user_role() = 'admin');
DROP POLICY IF EXISTS "Admins read ingest issues" ON public.alert_ingest_issues;
CREATE POLICY "Admins read ingest issues" ON public.alert_ingest_issues FOR SELECT USING (public.current_user_role() = 'admin');
DROP POLICY IF EXISTS "Admins read alert audit log" ON public.alert_audit_log;
CREATE POLICY "Admins read alert audit log" ON public.alert_audit_log FOR SELECT USING (public.current_user_role() = 'admin');
DROP POLICY IF EXISTS "Admins read notification log" ON public.alert_notifications;
CREATE POLICY "Admins read notification log" ON public.alert_notifications FOR SELECT USING (public.current_user_role() = 'admin');
REVOKE ALL ON public.alert_provider_health, public.alert_provider_settings, public.alert_ingest_issues, public.alert_audit_log, public.alert_notifications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.alert_provider_health, public.alert_provider_settings, public.alert_ingest_issues, public.alert_audit_log, public.alert_notifications FROM authenticated;

-- Push subscriptions: no policies = no browser access whatsoever (endpoint and keys are secrets).
REVOKE ALL ON public.alert_push_subscriptions FROM anon, authenticated;

-- Preferences: each signed-in person sees and edits only their own row.
DROP POLICY IF EXISTS "Users read own alert preferences" ON public.user_alert_preferences;
CREATE POLICY "Users read own alert preferences" ON public.user_alert_preferences FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own alert preferences" ON public.user_alert_preferences;
CREATE POLICY "Users insert own alert preferences" ON public.user_alert_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own alert preferences" ON public.user_alert_preferences;
CREATE POLICY "Users update own alert preferences" ON public.user_alert_preferences FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own alert preferences" ON public.user_alert_preferences;
CREATE POLICY "Users delete own alert preferences" ON public.user_alert_preferences FOR DELETE USING (auth.uid() = user_id);
REVOKE ALL ON public.user_alert_preferences FROM anon;
