-- 014: Satellite imagery comparison and change detection.
-- Safe to run more than once. Run after 001-010 (needs profiles and public.current_user_role()).
--
-- Design: every table here is APPEND-ONLY. An analysis row (imagery identifiers, original scene metadata, method,
-- parameters, quality checks, results) is never updated. A review is a new row in satellite_reviews; the current review
-- state is simply the newest row (no row = "needs_review"). Links to incidents / hazards / zones are new rows.
-- Nothing in these tables changes emergency_reports, disaster_zones, route_hazards, blocked_roads, dispatches or triage.

CREATE TABLE IF NOT EXISTS satellite_analyses (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_by_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed','failed')),
  error TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('planetary-computer','cdse-sentinelhub','user-upload','demo')),
  collection TEXT NOT NULL CHECK (collection IN ('sentinel-2-l2a','sentinel-1','landsat-c2-l2','user-optical','user-sar')),
  synthetic BOOLEAN NOT NULL DEFAULT FALSE,           -- demonstration data: can never be confirmed
  aoi JSONB NOT NULL,                                 -- {bbox, polygon, areaKm2}
  before_range JSONB NOT NULL,
  after_range JSONB NOT NULL,
  before_scene JSONB,                                 -- identifiers + ORIGINAL provider metadata, as received
  after_scene JSONB,
  method TEXT CHECK (method IN ('optical_water_index_v1','sar_backscatter_change_v1')),
  parameters JSONB,
  quality JSONB,                                      -- {rating, checks[]}
  stats JSONB,
  findings JSONB NOT NULL DEFAULT '[]',
  limitations JSONB NOT NULL DEFAULT '[]',
  processing_ms INTEGER,
  overlay_bounds JSONB,
  has_images BOOLEAN NOT NULL DEFAULT FALSE,
  upload_fingerprints JSONB                           -- sha256 of user-supplied files (the files are not kept)
);

CREATE TABLE IF NOT EXISTS satellite_images (
  analysis_id UUID NOT NULL REFERENCES satellite_analyses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('before','after','change')),
  png_base64 TEXT NOT NULL,
  PRIMARY KEY (analysis_id, kind)
);

CREATE TABLE IF NOT EXISTS satellite_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES satellite_analyses(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('needs_review','confirmed_by_reviewer','not_disaster_related','inconclusive')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  acknowledged_limitations BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by UUID NOT NULL REFERENCES profiles(id),
  reviewed_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- a confirmation must carry a real note and the acknowledgement; the API checks too, this keeps direct writes honest
  CHECK (state <> 'confirmed_by_reviewer' OR (acknowledged_limitations AND note IS NOT NULL AND char_length(note) >= 10))
);

CREATE TABLE IF NOT EXISTS satellite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES satellite_analyses(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('report','hazard','zone')),
  target_id TEXT NOT NULL CHECK (char_length(target_id) BETWEEN 1 AND 120),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  linked_by UUID NOT NULL REFERENCES profiles(id),
  linked_by_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (analysis_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_satellite_analyses_created ON satellite_analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_satellite_reviews_analysis ON satellite_reviews(analysis_id, created_at);
CREATE INDEX IF NOT EXISTS idx_satellite_links_target ON satellite_links(target_type, target_id);

-- Row-level security: responders and administrators only; insert and read, never update or delete.
ALTER TABLE satellite_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE satellite_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read satellite analyses" ON satellite_analyses;
CREATE POLICY "Staff read satellite analyses" ON satellite_analyses FOR SELECT USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Staff add own satellite analyses" ON satellite_analyses;
CREATE POLICY "Staff add own satellite analyses" ON satellite_analyses FOR INSERT WITH CHECK (public.current_user_role() IN ('responder','admin') AND created_by = auth.uid());

DROP POLICY IF EXISTS "Staff read satellite images" ON satellite_images;
CREATE POLICY "Staff read satellite images" ON satellite_images FOR SELECT USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Staff add satellite images" ON satellite_images;
CREATE POLICY "Staff add satellite images" ON satellite_images FOR INSERT WITH CHECK (
  public.current_user_role() IN ('responder','admin')
  AND EXISTS (SELECT 1 FROM satellite_analyses a WHERE a.id = analysis_id AND a.created_by = auth.uid()));

DROP POLICY IF EXISTS "Staff read satellite reviews" ON satellite_reviews;
CREATE POLICY "Staff read satellite reviews" ON satellite_reviews FOR SELECT USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Staff add own satellite reviews" ON satellite_reviews;
CREATE POLICY "Staff add own satellite reviews" ON satellite_reviews FOR INSERT WITH CHECK (public.current_user_role() IN ('responder','admin') AND reviewed_by = auth.uid());

DROP POLICY IF EXISTS "Staff read satellite links" ON satellite_links;
CREATE POLICY "Staff read satellite links" ON satellite_links FOR SELECT USING (public.current_user_role() IN ('responder','admin'));
DROP POLICY IF EXISTS "Staff add own satellite links" ON satellite_links;
CREATE POLICY "Staff add own satellite links" ON satellite_links FOR INSERT WITH CHECK (public.current_user_role() IN ('responder','admin') AND linked_by = auth.uid());

-- Belt and braces: even the service role cannot edit or delete saved analyses, reviews or links.
CREATE OR REPLACE FUNCTION public.satellite_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'satellite records are append-only (% on %)', TG_OP, TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS satellite_analyses_append_only ON satellite_analyses;
CREATE TRIGGER satellite_analyses_append_only BEFORE UPDATE OR DELETE ON satellite_analyses FOR EACH ROW EXECUTE FUNCTION public.satellite_append_only();
DROP TRIGGER IF EXISTS satellite_reviews_append_only ON satellite_reviews;
CREATE TRIGGER satellite_reviews_append_only BEFORE UPDATE OR DELETE ON satellite_reviews FOR EACH ROW EXECUTE FUNCTION public.satellite_append_only();
DROP TRIGGER IF EXISTS satellite_links_append_only ON satellite_links;
CREATE TRIGGER satellite_links_append_only BEFORE UPDATE OR DELETE ON satellite_links FOR EACH ROW EXECUTE FUNCTION public.satellite_append_only();

NOTIFY pgrst, 'reload schema';
