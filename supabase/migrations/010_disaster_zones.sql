-- VYRA: interactive disaster zones (hazard, evacuation, shelter and restricted areas on the live map).
-- Run once in the Supabase SQL Editor AFTER 002_stage4_6.sql (needs public.current_user_role()). Safe to re-run.
--
-- Design
--   * geometry is validated GeoJSON (JSONB, [lng, lat]) + four bbox columns with a btree index, so the map can ask
--     for "zones in this viewport". If the PostGIS extension is already installed, a geography column with a GIST
--     index is added too (section 6); nothing here requires PostGIS.
--   * Row Level Security: everyone may READ published zones; only responders/admins may write; the privileged
--     service-role key is used only by the server-side feed importer.
--   * A BEFORE trigger enforces who may publish official warnings / evacuation orders and that important changes
--     carry a reason. An AFTER trigger writes an append-only audit log that clients can not forge or edit.

-- ---------------------------------------------------------------------------
-- 0. Helpers (current_user_role() normally exists from migration 002)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role::TEXT FROM public.profiles WHERE id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- 1. disaster_zones
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zone_geometry_ok(g jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT g IS NOT NULL
     AND g->>'type' IN ('Point', 'LineString', 'Polygon', 'MultiPolygon')
     AND jsonb_typeof(g->'coordinates') = 'array'
     AND NOT jsonb_path_exists(g->'coordinates', '$.** ? (@.type() == "number" && (@ < -180 || @ > 180))')
$$;

CREATE TABLE IF NOT EXISTS public.disaster_zones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  zone_type           TEXT NOT NULL CHECK (zone_type IN ('danger', 'elevated', 'caution', 'evacuation', 'shelter', 'restricted')),
  severity            TEXT NOT NULL CHECK (severity IN ('extreme', 'high', 'moderate', 'low', 'unknown')),
  hazard_type         TEXT NOT NULL CHECK (hazard_type IN ('flood', 'fire', 'storm', 'landslide', 'earthquake', 'heat', 'chemical', 'structural', 'infrastructure', 'other')),
  geometry            JSONB NOT NULL CHECK (public.zone_geometry_ok(geometry)),
  boundary_kind       TEXT NOT NULL CHECK (boundary_kind IN ('drawn', 'circle', 'administrative', 'road', 'point')),
  boundary_quality    TEXT NOT NULL DEFAULT 'approximate' CHECK (boundary_quality IN ('official', 'surveyed', 'approximate')),
  radius_m            NUMERIC CHECK (radius_m IS NULL OR (radius_m > 0 AND radius_m <= 200000)),
  radius_basis        TEXT,
  description         TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 4000),
  precautions         TEXT CHECK (precautions IS NULL OR char_length(precautions) <= 4000),
  status_detail       TEXT,
  evacuation_status   TEXT CHECK (evacuation_status IN ('order', 'proposed')),
  source_type         TEXT NOT NULL CHECK (source_type IN ('official_feed', 'official_manual', 'responder', 'citizen_report', 'ai_suggestion')),
  source_name         TEXT,
  source_url          TEXT CHECK (source_url IS NULL OR source_url ~* '^https?://'),
  external_id         TEXT,                       -- id in the source system (feed imports)
  feed_id             TEXT,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('official', 'human_verified', 'unverified', 'ai_suggested')),
  lifecycle           TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('draft', 'active', 'deactivated', 'cancelled')),
  valid_from          TIMESTAMPTZ DEFAULT NOW(),
  valid_until         TIMESTAMPTZ,
  related_report_ids  TEXT[] NOT NULL DEFAULT '{}',
  related_shelter_ids TEXT[] NOT NULL DEFAULT '{}',
  related_road_ids    TEXT[] NOT NULL DEFAULT '{}',
  bbox_min_lng        DOUBLE PRECISION NOT NULL CHECK (bbox_min_lng BETWEEN -180 AND 180),
  bbox_min_lat        DOUBLE PRECISION NOT NULL CHECK (bbox_min_lat BETWEEN -90 AND 90),
  bbox_max_lng        DOUBLE PRECISION NOT NULL CHECK (bbox_max_lng BETWEEN -180 AND 180),
  bbox_max_lat        DOUBLE PRECISION NOT NULL CHECK (bbox_max_lat BETWEEN -90 AND 90),
  revision            INTEGER NOT NULL DEFAULT 1,
  change_reason       TEXT,
  source_updated_at   TIMESTAMPTZ,
  created_by          UUID,                       -- set from auth.uid() by the trigger; NULL for feed imports
  created_by_name     TEXT,
  updated_by          UUID,
  updated_by_label    TEXT,                       -- email of the editor, or 'feed:<id>' for imports
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bbox_ordered CHECK (bbox_min_lng <= bbox_max_lng AND bbox_min_lat <= bbox_max_lat),
  CONSTRAINT valid_window CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  -- Circles only with a documented radius; nothing else may carry a radius.
  CONSTRAINT circle_needs_basis CHECK (
    (boundary_kind = 'circle' AND radius_m IS NOT NULL AND geometry->>'type' = 'Point' AND char_length(coalesce(radius_basis, '')) >= 10)
    OR (boundary_kind <> 'circle' AND radius_m IS NULL AND radius_basis IS NULL)
  ),
  CONSTRAINT boundary_matches_geometry CHECK (
    (boundary_kind = 'road' AND geometry->>'type' = 'LineString')
    OR (boundary_kind = 'point' AND geometry->>'type' = 'Point')
    OR (boundary_kind = 'circle' AND geometry->>'type' = 'Point')
    OR (boundary_kind IN ('drawn', 'administrative') AND geometry->>'type' IN ('Polygon', 'MultiPolygon'))
  ),
  -- Red only when official or checked by a person; green only for verified shelters.
  CONSTRAINT danger_must_be_verified CHECK (zone_type <> 'danger' OR verification_status IN ('official', 'human_verified')),
  CONSTRAINT shelter_must_be_verified CHECK (zone_type <> 'shelter' OR verification_status IN ('official', 'human_verified')),
  CONSTRAINT restricted_needs_detail CHECK (zone_type <> 'restricted' OR char_length(coalesce(status_detail, '')) >= 10),
  -- Blue: official order vs proposed plan must be explicit, and only official information is an order.
  CONSTRAINT evacuation_status_matches CHECK ((zone_type = 'evacuation') = (evacuation_status IS NOT NULL)),
  CONSTRAINT order_must_be_official CHECK (evacuation_status IS DISTINCT FROM 'order' OR verification_status = 'official'),
  CONSTRAINT official_consistent CHECK (
    (verification_status = 'official') = (source_type IN ('official_feed', 'official_manual'))
    AND (verification_status <> 'official' OR char_length(coalesce(source_name, '')) > 0)
  ),
  -- AI can suggest, never publish.
  CONSTRAINT ai_never_published CHECK (
    (verification_status = 'ai_suggested') = (source_type = 'ai_suggestion')
    AND (verification_status <> 'ai_suggested' OR lifecycle = 'draft')
  )
);

-- Same feed warning never appears twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_disaster_zones_feed_external ON public.disaster_zones (feed_id, external_id) WHERE feed_id IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_disaster_zones_bbox ON public.disaster_zones (bbox_min_lng, bbox_max_lng, bbox_min_lat, bbox_max_lat);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_state ON public.disaster_zones (lifecycle, valid_until);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_type ON public.disaster_zones (zone_type, verification_status);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_updated ON public.disaster_zones (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_disaster_zones_reports ON public.disaster_zones USING gin (related_report_ids);

-- ---------------------------------------------------------------------------
-- 2. Audit log (append-only) and feed status
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zone_audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id    UUID NOT NULL,                        -- deliberately no FK: history survives deleting a draft
  action     TEXT NOT NULL CHECK (action IN ('create', 'update', 'deactivate', 'cancel', 'reactivate', 'import', 'import_update', 'expire', 'delete')),
  actor      TEXT NOT NULL,
  actor_role TEXT,
  reason     TEXT,
  changes    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zone_audit_zone ON public.zone_audit_log (zone_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.zone_feed_status (
  feed_id             TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  last_attempt_at     TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error          TEXT,
  zones_seen          INTEGER NOT NULL DEFAULT 0,
  stale_after_minutes INTEGER NOT NULL DEFAULT 120
);

-- ---------------------------------------------------------------------------
-- 3. Guard trigger: who may publish what, and reasons for important changes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zone_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
  -- service_role (server-side feed importer) or a direct SQL session (migrations, SQL editor); never an API user
  v_service BOOLEAN := (coalesce(auth.role(), '') = 'service_role' OR session_user IN ('postgres', 'supabase_admin'));
  v_official_new BOOLEAN;
  v_official_old BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_role := public.current_user_role();
    IF v_role IS NULL OR v_role NOT IN ('responder', 'admin') THEN
      RAISE EXCEPTION 'Only responders and administrators can manage zones' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT v_service THEN
    RAISE EXCEPTION 'Sign in to manage zones' USING ERRCODE = '42501';
  END IF;

  v_official_new := NEW.verification_status = 'official' OR NEW.source_type IN ('official_feed', 'official_manual') OR NEW.evacuation_status = 'order';
  IF TG_OP = 'UPDATE' THEN
    v_official_old := OLD.verification_status = 'official' OR OLD.source_type IN ('official_feed', 'official_manual') OR OLD.evacuation_status = 'order';
  END IF;

  -- Only administrators (or the server-side importer) touch official information.
  IF v_uid IS NOT NULL AND v_role <> 'admin' AND (v_official_new OR v_official_old) THEN
    RAISE EXCEPTION 'Only an administrator can publish or change official warnings and evacuation orders' USING ERRCODE = '42501';
  END IF;

  IF v_uid IS NOT NULL THEN
    NEW.updated_by := v_uid;
    NEW.updated_by_label := (SELECT email FROM public.profiles WHERE id = v_uid);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL THEN
      NEW.created_by := v_uid;
      NEW.created_by_name := coalesce((SELECT full_name FROM public.profiles WHERE id = v_uid), NEW.updated_by_label);
    END IF;
    NEW.revision := 1;
    NEW.created_at := NOW();
    NEW.updated_at := NOW();
  ELSE
    -- Identity fields never change.
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    IF v_uid IS NOT NULL THEN
      NEW.feed_id := OLD.feed_id;
      NEW.external_id := OLD.external_id;
    END IF;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := NOW();
    IF v_uid IS NOT NULL
       AND (NEW.zone_type, NEW.severity, NEW.verification_status, NEW.lifecycle, NEW.geometry, NEW.radius_m, NEW.valid_from, NEW.valid_until, NEW.evacuation_status, NEW.source_type)
           IS DISTINCT FROM
           (OLD.zone_type, OLD.severity, OLD.verification_status, OLD.lifecycle, OLD.geometry, OLD.radius_m, OLD.valid_from, OLD.valid_until, OLD.evacuation_status, OLD.source_type)
       AND char_length(btrim(coalesce(NEW.change_reason, ''))) < 5 THEN
      RAISE EXCEPTION 'Record a reason for this change (at least 5 characters)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zone_guard ON public.disaster_zones;
CREATE TRIGGER zone_guard BEFORE INSERT OR UPDATE ON public.disaster_zones FOR EACH ROW EXECUTE FUNCTION public.zone_guard();

-- Deleting is limited by RLS to administrators and unpublished drafts; guard the service role too.
CREATE OR REPLACE FUNCTION public.zone_delete_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'Published zones are cancelled, not deleted, so their history is kept' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS zone_delete_guard ON public.disaster_zones;
CREATE TRIGGER zone_delete_guard BEFORE DELETE ON public.disaster_zones FOR EACH ROW EXECUTE FUNCTION public.zone_delete_guard();

-- ---------------------------------------------------------------------------
-- 4. Audit trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.zone_changes(o jsonb, n jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('from', o -> k, 'to', n -> k)), '{}'::jsonb)
  FROM jsonb_object_keys(o || n) AS k
  WHERE (o -> k) IS DISTINCT FROM (n -> k)
    AND k NOT IN ('updated_at', 'updated_by', 'updated_by_label', 'revision', 'change_reason', 'bbox_min_lng', 'bbox_min_lat', 'bbox_max_lng', 'bbox_max_lat', 'geom')
$$;

CREATE OR REPLACE FUNCTION public.zone_audit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_role   TEXT;
  v_actor  TEXT;
  v_feed   BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.zone_audit_log (zone_id, action, actor, actor_role, reason)
    VALUES (OLD.id, 'delete', coalesce((SELECT email FROM public.profiles WHERE id = auth.uid()), 'unknown'), public.current_user_role(), 'Draft discarded');
    RETURN OLD;
  END IF;

  v_feed  := NEW.source_type = 'official_feed' AND auth.uid() IS NULL;
  v_role  := CASE WHEN auth.uid() IS NOT NULL THEN public.current_user_role() WHEN v_feed THEN 'feed' ELSE 'service' END;
  v_actor := coalesce(NEW.updated_by_label, 'system');

  IF TG_OP = 'INSERT' THEN
    v_action := CASE WHEN v_feed THEN 'import' ELSE 'create' END;
    INSERT INTO public.zone_audit_log (zone_id, action, actor, actor_role, reason, changes)
    VALUES (NEW.id, v_action, v_actor, v_role, NEW.change_reason, '{}'::jsonb);
  ELSE
    v_action := CASE
      WHEN NEW.lifecycle = 'cancelled' AND OLD.lifecycle <> 'cancelled' THEN 'cancel'
      WHEN NEW.lifecycle = 'deactivated' AND OLD.lifecycle <> 'deactivated' THEN CASE WHEN v_feed THEN 'expire' ELSE 'deactivate' END
      WHEN NEW.lifecycle = 'active' AND OLD.lifecycle IN ('deactivated', 'cancelled', 'draft') THEN 'reactivate'
      WHEN v_feed THEN 'import_update'
      ELSE 'update' END;
    INSERT INTO public.zone_audit_log (zone_id, action, actor, actor_role, reason, changes)
    VALUES (NEW.id, v_action, v_actor, v_role, NEW.change_reason, public.zone_changes(to_jsonb(OLD), to_jsonb(NEW)));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zone_audit_ins_upd ON public.disaster_zones;
CREATE TRIGGER zone_audit_ins_upd AFTER INSERT OR UPDATE ON public.disaster_zones FOR EACH ROW EXECUTE FUNCTION public.zone_audit();
DROP TRIGGER IF EXISTS zone_audit_del ON public.disaster_zones;
CREATE TRIGGER zone_audit_del AFTER DELETE ON public.disaster_zones FOR EACH ROW EXECUTE FUNCTION public.zone_audit();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.disaster_zones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zone_feed_status ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('disaster_zones', 'zone_audit_log', 'zone_feed_status') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- Anyone may read published zones. AI suggestions and drafts are never public.
CREATE POLICY "Public can read published zones" ON public.disaster_zones FOR SELECT
  USING (verification_status <> 'ai_suggested' AND lifecycle <> 'draft');
CREATE POLICY "Staff can read all zones" ON public.disaster_zones FOR SELECT
  USING (public.current_user_role() IN ('responder', 'admin'));
-- Only staff write. The guard trigger adds: official / evacuation orders are administrator-only.
CREATE POLICY "Staff can create zones" ON public.disaster_zones FOR INSERT
  WITH CHECK (public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY "Staff can update zones" ON public.disaster_zones FOR UPDATE
  USING (public.current_user_role() IN ('responder', 'admin'))
  WITH CHECK (public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY "Admins can delete draft zones" ON public.disaster_zones FOR DELETE
  USING (public.current_user_role() = 'admin' AND lifecycle = 'draft');

-- Audit log: staff read; nobody writes through the API (only the SECURITY DEFINER trigger).
CREATE POLICY "Staff can read zone audit log" ON public.zone_audit_log FOR SELECT
  USING (public.current_user_role() IN ('responder', 'admin'));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.zone_audit_log FROM anon, authenticated;

-- Feed status is public (so the map can warn about stale data); written only with the service-role key.
CREATE POLICY "Public can read feed status" ON public.zone_feed_status FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.zone_feed_status FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Optional PostGIS column (only when the extension is already installed)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    ALTER TABLE public.disaster_zones ADD COLUMN IF NOT EXISTS geom geography(Geometry, 4326);
    CREATE INDEX IF NOT EXISTS idx_disaster_zones_geom ON public.disaster_zones USING gist (geom);
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.zone_fill_geom() RETURNS TRIGGER LANGUAGE plpgsql AS $b$
      BEGIN
        NEW.geom := ST_SetSRID(ST_GeomFromGeoJSON(NEW.geometry::text), 4326)::geography;
        RETURN NEW;
      END $b$
    $fn$;
    DROP TRIGGER IF EXISTS zone_fill_geom ON public.disaster_zones;
    CREATE TRIGGER zone_fill_geom BEFORE INSERT OR UPDATE OF geometry ON public.disaster_zones FOR EACH ROW EXECUTE FUNCTION public.zone_fill_geom();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
