-- VYRA: administrator-managed Hazards & Precautions content (optional).
-- The app ships with reviewed guides built in and works without this table. Run it only if administrators should be able
-- to edit, review-stamp, publish and retire guides at /admin/safety. Run after 010_disaster_zones.sql. Safe to re-run.
--   * everyone may READ published guides; only administrators write (Row Level Security + trigger)
--   * publishing requires a reviewer and a review date (database constraint)
--   * every save is copied to an append-only revision history by a trigger
--   * the app also checks every guide with the content lint before it accepts a save, and refuses to show a published guide that fails it

CREATE TABLE IF NOT EXISTS public.safety_content (
  hazard_id         TEXT PRIMARY KEY CHECK (hazard_id IN ('flood','urban-flood','earthquake','fire','collapse','storm','landslide','heat','electrical','road','chemical','tsunami')),
  content           JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object' AND content->>'id' = hazard_id),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  revision          INTEGER NOT NULL DEFAULT 1,
  reviewed_by       TEXT,
  reviewed_on       DATE,
  change_reason     TEXT,
  updated_by        UUID,
  updated_by_label  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at      TIMESTAMPTZ,
  CONSTRAINT published_needs_review CHECK (status <> 'published' OR (char_length(coalesce(reviewed_by, '')) >= 3 AND reviewed_on IS NOT NULL)),
  CONSTRAINT reason_required CHECK (char_length(btrim(coalesce(change_reason, ''))) >= 5)
);

CREATE TABLE IF NOT EXISTS public.safety_content_revisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_id     TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  status        TEXT NOT NULL,
  content       JSONB NOT NULL,
  reviewed_by   TEXT,
  reviewed_on   DATE,
  change_reason TEXT,
  actor         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_rev_hazard ON public.safety_content_revisions (hazard_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.safety_content_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND coalesce(public.current_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION 'Only an administrator can change safety content' USING ERRCODE = '42501';
  END IF;
  IF v_uid IS NOT NULL THEN
    NEW.updated_by := v_uid;
    NEW.updated_by_label := (SELECT email FROM public.profiles WHERE id = v_uid);
  END IF;
  NEW.updated_at := NOW();
  IF TG_OP = 'UPDATE' THEN
    NEW.revision := OLD.revision + 1;
    NEW.created_at := OLD.created_at;
    NEW.published_at := CASE WHEN NEW.status = 'published' THEN NOW() ELSE OLD.published_at END;
  ELSE
    NEW.revision := 1;
    NEW.published_at := CASE WHEN NEW.status = 'published' THEN NOW() ELSE NULL END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS safety_content_guard ON public.safety_content;
CREATE TRIGGER safety_content_guard BEFORE INSERT OR UPDATE ON public.safety_content FOR EACH ROW EXECUTE FUNCTION public.safety_content_guard();

CREATE OR REPLACE FUNCTION public.safety_content_history()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.safety_content_revisions (hazard_id, revision, status, content, reviewed_by, reviewed_on, change_reason, actor)
  VALUES (NEW.hazard_id, NEW.revision, NEW.status, NEW.content, NEW.reviewed_by, NEW.reviewed_on, NEW.change_reason, NEW.updated_by_label);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS safety_content_history ON public.safety_content;
CREATE TRIGGER safety_content_history AFTER INSERT OR UPDATE ON public.safety_content FOR EACH ROW EXECUTE FUNCTION public.safety_content_history();

ALTER TABLE public.safety_content           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_content_revisions ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('safety_content', 'safety_content_revisions') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
CREATE POLICY "Public can read published guides" ON public.safety_content FOR SELECT USING (status = 'published');
CREATE POLICY "Admins can read all guides"       ON public.safety_content FOR SELECT USING (public.current_user_role() = 'admin');
CREATE POLICY "Admins can add guides"            ON public.safety_content FOR INSERT WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admins can update guides"         ON public.safety_content FOR UPDATE USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admins can read revision history" ON public.safety_content_revisions FOR SELECT USING (public.current_user_role() = 'admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.safety_content_revisions FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON public.safety_content FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
