-- VYRA: in-app support requests ("Contact us"). Safe to re-run.
--
-- Run AFTER supabase/vyra_complete_schema.sql (it needs public.profiles, public.current_user_role()
-- and update_updated_at_column()). Nothing here sends email: requests are rows in this table, shown to
-- administrators on /admin/support, and the person who sent one gets a reference ID on screen.
--
-- How access works
--   * Nobody inserts into support_requests directly. Every submission goes through
--     public.submit_support_request(), which validates, de-duplicates, rate-limits and then inserts.
--     This also lets people without an account ask for help (they cannot read the request back later,
--     which is why they are shown the reference ID).
--   * A signed-in person can read only their own requests (user_id = auth.uid()).
--   * Administrators can read every request and change only its status and category.
--   * Nobody can delete requests, and nobody can edit what was written.

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,                       -- shown to the sender, e.g. SUP-7K3M9QX2
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- NULL = sent without signing in
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  email            TEXT CHECK (email IS NULL OR (char_length(email) <= 200 AND email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  subject          TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 150),
  category         TEXT NOT NULL CHECK (category IN ('technical', 'report_problem', 'account', 'privacy', 'general')),
  message          TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 4000),
  report_reference TEXT CHECK (report_reference IS NULL OR report_reference ~ '^[A-Za-z0-9][A-Za-z0-9-]{4,39}$'),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  sender_key       TEXT NOT NULL,                              -- 'user:<uuid>' or 'anon:<hash of network address>'
  content_hash     TEXT NOT NULL,                              -- identical resubmissions are detected with this
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One row per accepted submission, used only for rate limiting. Nobody can read or write it from the API.
CREATE TABLE IF NOT EXISTS public.support_rate_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rate_key   TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_support_requests_status_created ON public.support_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_category       ON public.support_requests (category);
CREATE INDEX IF NOT EXISTS idx_support_requests_user_created   ON public.support_requests (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_requests_dedupe         ON public.support_requests (sender_key, content_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_rate_events_key_time    ON public.support_rate_events (rate_key, created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Triggers: keep updated_at fresh; staff may only change status and category
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_support_requests_updated_at ON public.support_requests;
CREATE TRIGGER update_support_requests_updated_at BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.support_requests_guard()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.reference, NEW.user_id, NEW.name, NEW.email, NEW.subject, NEW.message, NEW.report_reference, NEW.sender_key, NEW.content_hash, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.reference, OLD.user_id, OLD.name, OLD.email, OLD.subject, OLD.message, OLD.report_reference, OLD.sender_key, OLD.content_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'Only the status and category of a support request can be changed.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS support_requests_guard ON public.support_requests;
CREATE TRIGGER support_requests_guard BEFORE UPDATE ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION public.support_requests_guard();

-- -----------------------------------------------------------------------------
-- 4. Who counts as support staff: administrators. (To include responders, add 'responder' to the list.)
--    current_user_role() reads profiles without triggering RLS recursion; it is defined in the schema file.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_support_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(public.current_user_role() IN ('admin'), FALSE) $$;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security and privileges
-- -----------------------------------------------------------------------------
ALTER TABLE public.support_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_rate_events ENABLE ROW LEVEL SECURITY; -- no policies: the API cannot touch it

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_requests' LOOP
    EXECUTE format('DROP POLICY %I ON public.support_requests', p.policyname);
  END LOOP;
END $$;

-- No INSERT or DELETE policy on purpose: inserts go through submit_support_request(), nothing is deleted.
CREATE POLICY "Senders read their own support requests" ON public.support_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_support_staff());
CREATE POLICY "Staff update support requests" ON public.support_requests
  FOR UPDATE TO authenticated USING (public.is_support_staff()) WITH CHECK (public.is_support_staff());

-- Belt and braces: even if a policy were wrong, these privileges are already narrow.
REVOKE ALL ON public.support_requests    FROM anon, authenticated;
REVOKE ALL ON public.support_rate_events FROM anon, authenticated;
GRANT SELECT ON public.support_requests TO authenticated;
GRANT UPDATE (status, category) ON public.support_requests TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. The only way to create a request
--    Returns { "reference": "SUP-XXXXXXXX", "duplicate": false }.
--    Errors: PT429 rate_limited (HTTP 429), 23514 check violation (a field is invalid).
--    p_client_key is a hash of the sender's network address supplied by the API route. A caller using
--    the publishable key directly could vary it, so the function ALSO enforces a per-account limit
--    (auth.uid() cannot be forged) and a global cap on anonymous submissions.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_support_request(
  p_name TEXT, p_email TEXT, p_subject TEXT, p_category TEXT, p_message TEXT,
  p_report_reference TEXT DEFAULT NULL, p_client_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_sender  TEXT;
  v_hash    TEXT;
  v_ref     TEXT;
  v_alpha   CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_found   TEXT;
  v_tries   INT := 0;
  c_hour_limit   CONSTANT INT := 5;    -- per sender per hour
  c_anon_cap     CONSTANT INT := 100;  -- all anonymous senders together, per hour
  c_min_gap      CONSTANT INTERVAL := INTERVAL '10 seconds';
  c_dedupe_window CONSTANT INTERVAL := INTERVAL '10 minutes';
BEGIN
  v_sender := CASE WHEN v_uid IS NOT NULL THEN 'user:' || v_uid::TEXT
                   ELSE 'anon:' || COALESCE(NULLIF(btrim(p_client_key), ''), 'unknown') END;
  v_hash := md5(lower(btrim(COALESCE(p_category, '')) || '|' || btrim(COALESCE(p_subject, '')) || '|' || btrim(COALESCE(p_message, ''))));

  -- Same message again from the same sender: return the first reference instead of saving a copy.
  SELECT reference INTO v_found FROM support_requests
   WHERE sender_key = v_sender AND content_hash = v_hash AND created_at > NOW() - c_dedupe_window
   ORDER BY created_at DESC LIMIT 1;
  IF v_found IS NOT NULL THEN
    RETURN jsonb_build_object('reference', v_found, 'duplicate', TRUE);
  END IF;

  -- Rate limits.
  DELETE FROM support_rate_events WHERE created_at < NOW() - INTERVAL '1 day';
  IF EXISTS (SELECT 1 FROM support_rate_events WHERE rate_key = v_sender AND created_at > NOW() - c_min_gap)
     OR (SELECT COUNT(*) FROM support_rate_events WHERE rate_key = v_sender AND created_at > NOW() - INTERVAL '1 hour') >= c_hour_limit THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'PT429', HINT = 'Too many support requests. Try again later.';
  END IF;
  IF v_uid IS NULL AND (SELECT COUNT(*) FROM support_rate_events WHERE rate_key = 'anon:*' AND created_at > NOW() - INTERVAL '1 hour') >= c_anon_cap THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'PT429', HINT = 'Support is receiving a lot of requests. Try again later.';
  END IF;

  -- Insert with a fresh readable reference (retry on the rare collision). Field rules are the CHECK constraints.
  LOOP
    v_ref := 'SUP-' || (SELECT string_agg(substr(v_alpha, 1 + floor(random() * 32)::INT, 1), '') FROM generate_series(1, 8));
    BEGIN
      INSERT INTO support_requests (reference, user_id, name, email, subject, category, message, report_reference, sender_key, content_hash)
      VALUES (v_ref, v_uid, btrim(p_name), NULLIF(lower(btrim(COALESCE(p_email, ''))), ''), btrim(p_subject), p_category, btrim(p_message),
              NULLIF(upper(btrim(COALESCE(p_report_reference, ''))), ''), v_sender, v_hash);
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_tries := v_tries + 1;
      IF v_tries >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO support_rate_events (rate_key) VALUES (v_sender);
  IF v_uid IS NULL THEN INSERT INTO support_rate_events (rate_key) VALUES ('anon:*'); END IF;

  RETURN jsonb_build_object('reference', v_ref, 'duplicate', FALSE);
END $$;

REVOKE ALL ON FUNCTION public.submit_support_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_support_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
