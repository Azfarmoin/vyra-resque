-- 013: AI analysis of report photos.
-- One row per photo in report_attachments (migration 009). The photo files stay in the PRIVATE
-- 'report-attachments' bucket; nothing about storage changes: the bucket is still private with an
-- insert-only policy, and files are read only through the server (service-role key) or short-lived
-- signed URLs minted by the server after an authorization check.
--
-- Unlike report_attachments (metadata only, readable), analysis rows describe what a photo shows, so
-- they are NOT publicly readable: staff may read them through RLS, and the API server (service-role
-- key, which bypasses RLS) reads/writes them for the person who took the photo.

CREATE TABLE IF NOT EXISTS public.attachment_analyses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attachment_id   UUID NOT NULL UNIQUE REFERENCES public.report_attachments(id) ON DELETE CASCADE,
  report_id       UUID NOT NULL REFERENCES public.emergency_reports(id) ON DELETE CASCADE,
  uploader_id     UUID,                                   -- reports.reporter_id at analysis time (NULL for anonymous)
  analysis_status TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending', 'processing', 'completed', 'failed')),
  result          JSONB,                                  -- validated structured result (see src/lib/photoAnalysis/schema.ts)
  consent_at      TIMESTAMPTZ,                            -- when the reporter agreed to AI processing of this photo
  model_provider  TEXT,
  model_version   TEXT,
  analyzed_at     TIMESTAMPTZ,
  failure_reason  TEXT,
  review_status   TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'confirmed', 'rejected', 'needs_more_info')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  user_action     TEXT NOT NULL DEFAULT 'none' CHECK (user_action IN ('none', 'used', 'edited', 'ignored')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachment_analyses_report ON public.attachment_analyses(report_id);

ALTER TABLE public.attachment_analyses ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p RECORD; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attachment_analyses' LOOP
    EXECUTE format('DROP POLICY %I ON public.attachment_analyses', p.policyname);
  END LOOP;
END $$;

-- Staff (responders and admins) can read and record their review. Citizens and anonymous visitors get
-- nothing directly: they see their own analysis only through the API, which checks ownership first.
CREATE POLICY "Staff can read photo analyses" ON public.attachment_analyses FOR SELECT
  USING (public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY "Staff can review photo analyses" ON public.attachment_analyses FOR UPDATE
  USING (public.current_user_role() IN ('responder', 'admin'))
  WITH CHECK (public.current_user_role() IN ('responder', 'admin'));
-- No INSERT/DELETE policy: only the server (service-role key) creates rows.

DROP TRIGGER IF EXISTS trg_attachment_analyses_updated ON public.attachment_analyses;
CREATE TRIGGER trg_attachment_analyses_updated BEFORE UPDATE ON public.attachment_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
