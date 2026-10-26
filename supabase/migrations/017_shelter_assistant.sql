-- 012: Intelligent Shelter Placement Assistant. Extends the EXISTING `shelters` table (no second registry). Safe to re-run.
-- Run after 002 and 011 (needs public.current_user_role()).
--
-- Concurrency model: every reservation function takes the shelter row lock (SELECT ... FOR UPDATE) before it reads capacity, and an
-- advisory lock on the group key first, so two dispatchers cannot over-book a shelter or book one group at two shelters. Two unique
-- partial indexes back this up at the table level.
--
-- Permissions: new tables have RLS on and NO write policies. Every change goes through the SECURITY DEFINER functions below, which
-- check the caller's role themselves. Staff = responder or admin.

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Registry columns
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.shelters
  ADD COLUMN IF NOT EXISTS reserved_capacity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS authorized_overflow INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_full BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS location_source TEXT,
  ADD COLUMN IF NOT EXISTS opening_hours JSONB,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS verification_status TEXT,
  ADD COLUMN IF NOT EXISTS responsible_org TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS occupancy_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS occupancy_basis TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS wheelchair_access TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS facilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS infrastructure_dependencies TEXT[] NOT NULL DEFAULT '{}';

-- Existing rows: derive the new status from the old boolean. Nothing becomes verified that was not already.
UPDATE public.shelters SET verification_status = CASE WHEN verified THEN 'verified' ELSE 'unverified' END WHERE verification_status IS NULL;
ALTER TABLE public.shelters ALTER COLUMN verification_status SET DEFAULT 'unverified';
ALTER TABLE public.shelters ALTER COLUMN verification_status SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE public.shelters ADD CONSTRAINT shelters_verification_chk CHECK (verification_status IN ('verified', 'unverified', 'needs_review', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shelters ADD CONSTRAINT shelters_occupancy_basis_chk CHECK (occupancy_basis IN ('counted', 'reported', 'estimated', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shelters ADD CONSTRAINT shelters_wheelchair_chk CHECK (wheelchair_access IN ('full', 'partial', 'none', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shelters ADD CONSTRAINT shelters_nonneg_chk CHECK (reserved_capacity >= 0 AND authorized_overflow >= 0 AND coalesce(current_occupancy, 0) >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.shelters ADD CONSTRAINT shelters_coords_chk CHECK ((location_lat IS NULL OR location_lat BETWEEN -90 AND 90) AND (location_lng IS NULL OR location_lng BETWEEN -180 AND 180)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Keep the legacy boolean in step with the new status (one source of truth: verification_status).
CREATE OR REPLACE FUNCTION public.shelters_sync_verified() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Older code (and the demo seed) sets only the boolean: honour it instead of overwriting it with the column default.
    IF NEW.verified AND NEW.verification_status = 'unverified' THEN NEW.verification_status := 'verified'; END IF;
  ELSIF NEW.verified IS DISTINCT FROM OLD.verified AND NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    NEW.verification_status := CASE WHEN NEW.verified THEN 'verified' ELSE 'unverified' END;
  END IF;
  NEW.verified := (NEW.verification_status = 'verified');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS shelters_sync_verified_trg ON public.shelters;
CREATE TRIGGER shelters_sync_verified_trg BEFORE INSERT OR UPDATE ON public.shelters FOR EACH ROW EXECUTE FUNCTION public.shelters_sync_verified();

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Reservation ledger, exceptions, audit
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shelter_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shelter_id UUID NOT NULL REFERENCES public.shelters(id) ON DELETE RESTRICT,
  group_key TEXT NOT NULL,
  group_label TEXT NOT NULL CHECK (char_length(group_label) BETWEEN 2 AND 60),   -- a label, never a person's name or medical detail
  incident_id UUID REFERENCES public.emergency_reports(id) ON DELETE SET NULL,
  dispatch_id UUID REFERENCES public.dispatches(id) ON DELETE SET NULL,
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 5000),
  needs JSONB NOT NULL DEFAULT '{}'::jsonb,                                      -- counts only
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'arrived', 'departed', 'cancelled', 'expired')),
  expected_arrival_at TIMESTAMPTZ,
  hold_expires_at TIMESTAMPTZ NOT NULL,
  confirmed_arrival_at TIMESTAMPTZ,
  confirmed_by UUID,
  arrived_count INTEGER NOT NULL DEFAULT 0 CHECK (arrived_count >= 0),
  departed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  exception_id UUID,
  idempotency_key TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'arrived' OR (confirmed_arrival_at IS NOT NULL AND confirmed_by IS NOT NULL AND arrived_count BETWEEN 1 AND party_size))   -- no arrival without a recorded confirmation
);
CREATE UNIQUE INDEX IF NOT EXISTS shelter_reservations_active_group_uq ON public.shelter_reservations (group_key) WHERE status IN ('reserved', 'arrived');
CREATE UNIQUE INDEX IF NOT EXISTS shelter_reservations_idem_uq ON public.shelter_reservations (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS shelter_reservations_shelter_idx ON public.shelter_reservations (shelter_id, status);
CREATE INDEX IF NOT EXISTS shelter_reservations_dispatch_idx ON public.shelter_reservations (dispatch_id) WHERE dispatch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.shelter_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shelter_id UUID NOT NULL REFERENCES public.shelters(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('over_capacity', 'closed_use')),
  extra_capacity INTEGER NOT NULL DEFAULT 0 CHECK (extra_capacity >= 0 AND (kind = 'over_capacity' OR extra_capacity = 0)),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 300),
  authorized_by UUID,
  authorized_by_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '72 hours')
);
CREATE INDEX IF NOT EXISTS shelter_exceptions_shelter_idx ON public.shelter_exceptions (shelter_id);

CREATE TABLE IF NOT EXISTS public.shelter_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shelter_id UUID,
  reservation_id UUID,
  action TEXT NOT NULL,
  actor_id UUID,
  actor_role TEXT NOT NULL DEFAULT 'system',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS shelter_audit_shelter_idx ON public.shelter_audit (shelter_id, created_at DESC);

-- Audit rows are append-only, even for the service role.
CREATE OR REPLACE FUNCTION public.shelter_audit_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'shelter_audit is append-only.' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS shelter_audit_immutable_trg ON public.shelter_audit;
CREATE TRIGGER shelter_audit_immutable_trg BEFORE UPDATE OR DELETE ON public.shelter_audit FOR EACH ROW EXECUTE FUNCTION public.shelter_audit_immutable();

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.shelter_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelter_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelter_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelters ENABLE ROW LEVEL SECURITY;  -- already on in the base schema; stated here so this migration does not depend on that
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('shelter_reservations', 'shelter_exceptions', 'shelter_audit', 'shelters') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
-- Reads: staff only. There are deliberately NO insert/update/delete policies on these three tables.
CREATE POLICY shelter_reservations_read ON public.shelter_reservations FOR SELECT USING (public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY shelter_exceptions_read ON public.shelter_exceptions FOR SELECT USING (public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY shelter_audit_read ON public.shelter_audit FOR SELECT USING (public.current_user_role() = 'admin');
REVOKE ALL ON public.shelter_reservations, public.shelter_exceptions, public.shelter_audit FROM anon;

-- Shelters: anyone may read VERIFIED records (the public map); staff read everything; only administrators write directly.
-- Responders change capacity data through the functions below, which are audited and lock the row.
CREATE POLICY shelters_read ON public.shelters FOR SELECT USING (verification_status = 'verified' OR public.current_user_role() IN ('responder', 'admin'));
CREATE POLICY shelters_admin_insert ON public.shelters FOR INSERT WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY shelters_admin_update ON public.shelters FOR UPDATE USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY shelters_admin_delete ON public.shelters FOR DELETE USING (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shelter_actor_role() RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT CASE WHEN coalesce(auth.role(), '') = 'service_role' THEN 'admin' ELSE public.current_user_role() END $$;

CREATE OR REPLACE FUNCTION public.shelter_require(p_admin BOOLEAN) RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE r TEXT := public.shelter_actor_role();
BEGIN
  IF r IS NULL OR r NOT IN ('responder', 'admin') OR (p_admin AND r <> 'admin') THEN
    RAISE EXCEPTION 'forbidden|% role required.', CASE WHEN p_admin THEN 'Administrator' ELSE 'Responder or administrator' END USING ERRCODE = '42501';
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.shelter_log(p_shelter UUID, p_res UUID, p_action TEXT, p_detail JSONB) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ INSERT INTO public.shelter_audit (shelter_id, reservation_id, action, actor_id, actor_role, detail) VALUES (p_shelter, p_res, p_action, auth.uid(), coalesce(public.shelter_actor_role(), 'system'), coalesce(p_detail, '{}'::jsonb)) $$;

-- A capability is DOCUMENTED when recorded as 'yes' AND someone recorded when. Legacy `services` entries never count.
CREATE OR REPLACE FUNCTION public.shelter_doc(s public.shelters, k TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE
AS $$ SELECT coalesce(s.facilities -> k ->> 'value', '') = 'yes' AND coalesce(s.facilities -> k ->> 'documented_at', '') <> '' AND s.verification_status <> 'rejected' $$;

-- Mirrors requirementsFor() in src/lib/shelters/engine.ts. Returns the labels of unmet requirements.
CREATE OR REPLACE FUNCTION public.shelter_unmet(s public.shelters, n JSONB) RETURNS TEXT[] LANGUAGE plpgsql STABLE
AS $$
DECLARE
  out TEXT[] := '{}';
  wc BOOLEAN := (s.wheelchair_access = 'full' AND s.verification_status = 'verified');
BEGIN
  IF coalesce((n ->> 'wheelchairUsers')::int, 0) > 0 AND NOT wc THEN out := array_append(out, 'Wheelchair access'); END IF;
  IF coalesce((n ->> 'mobilityAssistance')::int, 0) > 0 AND NOT (public.shelter_doc(s, 'mobility_assistance') OR public.shelter_doc(s, 'step_free_entry')) THEN out := array_append(out, 'Mobility assistance'); END IF;
  IF coalesce((n ->> 'oxygenUsers')::int, 0) > 0 AND NOT (public.shelter_doc(s, 'oxygen_support') AND (public.shelter_doc(s, 'electricity') OR public.shelter_doc(s, 'backup_power'))) THEN out := array_append(out, 'Oxygen support with power'); END IF;
  IF coalesce((n ->> 'essentialMedication')::int, 0) > 0 AND NOT public.shelter_doc(s, 'medical_support') THEN out := array_append(out, 'Essential medication (medical support)'); END IF;
  IF coalesce((n ->> 'infants')::int, 0) > 0 AND NOT (public.shelter_doc(s, 'family_accommodation') AND public.shelter_doc(s, 'drinking_water') AND public.shelter_doc(s, 'sanitation')) THEN out := array_append(out, 'Infants (family space, water, sanitation)'); END IF;
  IF coalesce((n ->> 'elderly')::int, 0) > 0 AND NOT (public.shelter_doc(s, 'step_free_entry') OR wc) THEN out := array_append(out, 'Older adults (step-free access)'); END IF;
  IF coalesce((n ->> 'pregnant')::int, 0) > 0 AND NOT (public.shelter_doc(s, 'maternal_support') OR public.shelter_doc(s, 'medical_support')) THEN out := array_append(out, 'Pregnancy-related needs'); END IF;
  IF coalesce((n ->> 'keepFamilyTogether')::boolean, FALSE) AND NOT public.shelter_doc(s, 'family_accommodation') THEN out := array_append(out, 'Keep family together'); END IF;
  RETURN out;
END $$;

-- Recompute derived columns from the ledger. Caller holds the shelter row lock.
CREATE OR REPLACE FUNCTION public.shelter_recompute(p_id UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.shelters s SET
    reserved_capacity = coalesce((SELECT sum(party_size) FROM public.shelter_reservations r WHERE r.shelter_id = p_id AND r.status = 'reserved'), 0),
    authorized_overflow = coalesce((SELECT sum(extra_capacity) FROM public.shelter_exceptions e WHERE e.shelter_id = p_id AND e.kind = 'over_capacity' AND e.revoked_at IS NULL AND e.expires_at > now()), 0),
    updated_at = now()
  WHERE s.id = p_id;
  -- 'full' set BY THE SYSTEM follows the numbers both ways; a status a person set never flips back on its own.
  UPDATE public.shelters s SET status = 'full', auto_full = TRUE
    WHERE s.id = p_id AND s.status = 'open' AND s.capacity IS NOT NULL AND coalesce(s.current_occupancy, 0) >= s.capacity + s.authorized_overflow;
  UPDATE public.shelters s SET status = 'open', auto_full = FALSE
    WHERE s.id = p_id AND s.status = 'full' AND s.auto_full AND s.capacity IS NOT NULL AND coalesce(s.current_occupancy, 0) < s.capacity + s.authorized_overflow;
END $$;

CREATE OR REPLACE FUNCTION public.shelter_expire_locked(p_id UUID) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n INTEGER;
BEGIN
  WITH x AS (
    UPDATE public.shelter_reservations SET status = 'expired', cancelled_at = now(), cancel_reason = 'Hold expired without a confirmed arrival.', updated_at = now()
    WHERE shelter_id = p_id AND status = 'reserved' AND hold_expires_at <= now() RETURNING id, party_size)
  SELECT count(*) INTO n FROM x;
  IF n > 0 THEN PERFORM public.shelter_log(p_id, NULL, 'reservation_expired', jsonb_build_object('count', n)); END IF;
  PERFORM public.shelter_recompute(p_id);
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reservation functions (all take the row lock before reading capacity)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shelter_reserve(
  p_shelter UUID, p_group_label TEXT, p_incident UUID, p_dispatch UUID, p_party INTEGER, p_needs JSONB,
  p_expected TIMESTAMPTZ, p_hold_minutes INTEGER, p_idem TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.shelters%ROWTYPE;
  prior public.shelter_reservations%ROWTYPE;
  v_key TEXT;
  v_closed_ex UUID; v_over_ex UUID; v_overflow INTEGER;
  v_avail INTEGER; v_unmet TEXT[]; v_hold_from TIMESTAMPTZ; rec public.shelter_reservations%ROWTYPE;
BEGIN
  PERFORM public.shelter_require(FALSE);
  IF p_party IS NULL OR p_party < 1 OR p_party > 5000 THEN RAISE EXCEPTION 'invalid_party|Party size must be 1-5000.' USING ERRCODE = '22023'; END IF;
  IF p_idem IS NULL OR char_length(p_idem) < 8 THEN RAISE EXCEPTION 'invalid_request|An idempotency key is required.' USING ERRCODE = '22023'; END IF;
  v_key := (CASE WHEN p_incident IS NOT NULL THEN 'incident:' || p_incident::text ELSE 'adhoc' END) || ':' || left(trim(BOTH '-' FROM regexp_replace(lower(p_group_label), '[^a-z0-9]+', '-', 'g')), 40);

  -- Same group, simultaneous requests for different shelters: serialise on the group first (always group -> shelter).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT * INTO prior FROM public.shelter_reservations WHERE idempotency_key = p_idem;
  IF FOUND THEN
    IF prior.shelter_id <> p_shelter OR prior.party_size <> p_party OR prior.group_key <> v_key THEN
      RAISE EXCEPTION 'idempotency_conflict|This idempotency key was already used for a different reservation.' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object('reservation', to_jsonb(prior), 'replayed', TRUE);
  END IF;

  SELECT * INTO s FROM public.shelters WHERE id = p_shelter FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shelter_not_found|Shelter not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.shelter_expire_locked(s.id);
  SELECT * INTO s FROM public.shelters WHERE id = p_shelter;

  IF EXISTS (SELECT 1 FROM public.shelter_reservations WHERE group_key = v_key AND status IN ('reserved', 'arrived')) THEN
    RAISE EXCEPTION 'double_booking|This group already has an active reservation. Cancel it or record the departure first.' USING ERRCODE = 'P0001';
  END IF;
  IF s.verification_status = 'rejected' THEN RAISE EXCEPTION 'shelter_rejected|This shelter record was rejected and cannot be used.' USING ERRCODE = 'P0001'; END IF;
  IF p_dispatch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dispatches WHERE id = p_dispatch) THEN RAISE EXCEPTION 'dispatch_not_found|Mission not found.' USING ERRCODE = 'P0002'; END IF;
  IF p_incident IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.emergency_reports WHERE id = p_incident) THEN RAISE EXCEPTION 'incident_not_found|Incident not found.' USING ERRCODE = 'P0002'; END IF;

  SELECT id INTO v_closed_ex FROM public.shelter_exceptions WHERE shelter_id = s.id AND kind = 'closed_use' AND revoked_at IS NULL AND expires_at > now() ORDER BY expires_at DESC LIMIT 1;
  SELECT id INTO v_over_ex FROM public.shelter_exceptions WHERE shelter_id = s.id AND kind = 'over_capacity' AND revoked_at IS NULL AND expires_at > now() ORDER BY expires_at DESC LIMIT 1;
  v_overflow := s.authorized_overflow;
  IF s.status = 'closed' AND v_closed_ex IS NULL THEN RAISE EXCEPTION 'shelter_closed|The shelter is closed and no authorized exception is recorded.' USING ERRCODE = 'P0001'; END IF;
  IF s.capacity IS NULL THEN RAISE EXCEPTION 'capacity_unknown|Maximum capacity is not recorded, so capacity cannot be reserved.' USING ERRCODE = 'P0001'; END IF;
  IF s.status = 'full' AND v_over_ex IS NULL THEN RAISE EXCEPTION 'shelter_full|The shelter is marked full and no authorized exception is recorded.' USING ERRCODE = 'P0001'; END IF;

  v_unmet := public.shelter_unmet(s, p_needs);
  IF array_length(v_unmet, 1) > 0 THEN
    RAISE EXCEPTION 'requirements_unmet|The shelter does not document: %. Request human review.', array_to_string(v_unmet, '; ') USING ERRCODE = 'P0001';
  END IF;

  v_avail := greatest(0, s.capacity + v_overflow - coalesce(s.current_occupancy, 0) - s.reserved_capacity);
  IF p_party > v_avail THEN
    RAISE EXCEPTION 'insufficient_capacity|Only % places are free; the group needs %.', v_avail, p_party USING ERRCODE = 'P0001';
  END IF;

  v_hold_from := CASE WHEN p_expected IS NOT NULL AND p_expected > now() THEN p_expected ELSE now() END;
  INSERT INTO public.shelter_reservations (shelter_id, group_key, group_label, incident_id, dispatch_id, party_size, needs, expected_arrival_at, hold_expires_at, exception_id, idempotency_key, created_by)
  VALUES (s.id, v_key, p_group_label, p_incident, p_dispatch, p_party, coalesce(p_needs, '{}'::jsonb) - 'partySize', p_expected,
          v_hold_from + make_interval(mins => greatest(15, least(1440, coalesce(p_hold_minutes, 90)))),
          CASE WHEN s.status = 'closed' THEN v_closed_ex WHEN s.status = 'full' THEN v_over_ex ELSE NULL END, p_idem, auth.uid())
  RETURNING * INTO rec;

  PERFORM public.shelter_recompute(s.id);
  PERFORM public.shelter_log(s.id, rec.id, 'reservation_created', jsonb_build_object('party_size', p_party, 'group_key', v_key, 'exception_id', rec.exception_id));
  RETURN jsonb_build_object('reservation', to_jsonb(rec), 'replayed', FALSE);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_confirm_arrival(p_id UUID, p_count INTEGER) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.shelter_reservations%ROWTYPE; s_id UUID; n INTEGER;
BEGIN
  PERFORM public.shelter_require(FALSE);
  SELECT shelter_id INTO s_id FROM public.shelter_reservations WHERE id = p_id;
  IF s_id IS NULL THEN RAISE EXCEPTION 'reservation_not_found|Reservation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = s_id FOR UPDATE;
  PERFORM public.shelter_expire_locked(s_id);
  SELECT * INTO r FROM public.shelter_reservations WHERE id = p_id FOR UPDATE;
  IF r.status = 'arrived' THEN RAISE EXCEPTION 'already_arrived|Arrival was already confirmed for this reservation.' USING ERRCODE = 'P0001'; END IF;
  IF r.status = 'expired' THEN RAISE EXCEPTION 'hold_expired|The hold expired and its places were released. Make a new reservation if the shelter still has room.' USING ERRCODE = 'P0001'; END IF;
  IF r.status <> 'reserved' THEN RAISE EXCEPTION 'invalid_state|A % reservation cannot be marked as arrived.', r.status USING ERRCODE = 'P0001'; END IF;
  n := coalesce(p_count, r.party_size);
  IF n < 1 OR n > r.party_size THEN RAISE EXCEPTION 'arrived_exceeds_reserved|% people arrived but % were reserved. Reserve the extra places first.', n, r.party_size USING ERRCODE = '22023'; END IF;
  UPDATE public.shelter_reservations SET status = 'arrived', arrived_count = n, confirmed_arrival_at = now(), confirmed_by = auth.uid(), updated_at = now() WHERE id = p_id RETURNING * INTO r;
  UPDATE public.shelters SET current_occupancy = coalesce(current_occupancy, 0) + n WHERE id = s_id;
  PERFORM public.shelter_recompute(s_id);
  PERFORM public.shelter_log(s_id, p_id, 'arrival_confirmed', jsonb_build_object('arrived', n, 'reserved', r.party_size));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_record_departure(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.shelter_reservations%ROWTYPE; s_id UUID;
BEGIN
  PERFORM public.shelter_require(FALSE);
  SELECT shelter_id INTO s_id FROM public.shelter_reservations WHERE id = p_id;
  IF s_id IS NULL THEN RAISE EXCEPTION 'reservation_not_found|Reservation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = s_id FOR UPDATE;
  PERFORM public.shelter_expire_locked(s_id);
  SELECT * INTO r FROM public.shelter_reservations WHERE id = p_id FOR UPDATE;
  IF r.status <> 'arrived' THEN
    RAISE EXCEPTION 'invalid_state|%', CASE WHEN r.status = 'reserved' THEN 'This group has not been confirmed as arrived, so there is no departure to record. Cancel the reservation instead.' ELSE format('A %s reservation cannot be marked as departed.', r.status) END USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.shelters SET current_occupancy = greatest(0, coalesce(current_occupancy, 0) - r.arrived_count) WHERE id = s_id;
  UPDATE public.shelter_reservations SET status = 'departed', departed_at = now(), updated_at = now() WHERE id = p_id RETURNING * INTO r;
  PERFORM public.shelter_recompute(s_id);
  PERFORM public.shelter_log(s_id, p_id, 'departure_recorded', jsonb_build_object('departed', r.arrived_count));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_cancel_reservation(p_id UUID, p_reason TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.shelter_reservations%ROWTYPE; s_id UUID;
BEGIN
  PERFORM public.shelter_require(FALSE);
  IF p_reason IS NULL OR char_length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'invalid_request|A reason is required.' USING ERRCODE = '22023'; END IF;
  SELECT shelter_id INTO s_id FROM public.shelter_reservations WHERE id = p_id;
  IF s_id IS NULL THEN RAISE EXCEPTION 'reservation_not_found|Reservation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = s_id FOR UPDATE;
  PERFORM public.shelter_expire_locked(s_id);
  SELECT * INTO r FROM public.shelter_reservations WHERE id = p_id FOR UPDATE;
  IF r.status = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled|This reservation is already cancelled.' USING ERRCODE = 'P0001'; END IF;
  IF r.status = 'arrived' THEN RAISE EXCEPTION 'invalid_state|People are recorded as inside. Record their departure instead of cancelling.' USING ERRCODE = 'P0001'; END IF;
  IF r.status <> 'reserved' THEN RAISE EXCEPTION 'invalid_state|A % reservation cannot be cancelled.', r.status USING ERRCODE = 'P0001'; END IF;
  UPDATE public.shelter_reservations SET status = 'cancelled', cancelled_at = now(), cancel_reason = left(trim(p_reason), 200), updated_at = now() WHERE id = p_id RETURNING * INTO r;
  PERFORM public.shelter_recompute(s_id);
  PERFORM public.shelter_log(s_id, p_id, 'reservation_cancelled', jsonb_build_object('reason', left(trim(p_reason), 200)));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_extend_hold(p_id UUID, p_minutes INTEGER) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.shelter_reservations%ROWTYPE; s_id UUID; nxt TIMESTAMPTZ;
BEGIN
  PERFORM public.shelter_require(FALSE);
  IF p_minutes IS NULL OR p_minutes < 15 OR p_minutes > 360 THEN RAISE EXCEPTION 'invalid_request|Extend by 15-360 minutes.' USING ERRCODE = '22023'; END IF;
  SELECT shelter_id INTO s_id FROM public.shelter_reservations WHERE id = p_id;
  IF s_id IS NULL THEN RAISE EXCEPTION 'reservation_not_found|Reservation not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = s_id FOR UPDATE;
  PERFORM public.shelter_expire_locked(s_id);
  SELECT * INTO r FROM public.shelter_reservations WHERE id = p_id FOR UPDATE;
  IF r.status <> 'reserved' THEN RAISE EXCEPTION '%|%', CASE WHEN r.status = 'expired' THEN 'hold_expired' ELSE 'invalid_state' END, format('A %s reservation has no hold to extend.', r.status) USING ERRCODE = 'P0001'; END IF;
  nxt := least(r.created_at + INTERVAL '24 hours', r.hold_expires_at + make_interval(mins => p_minutes));
  IF nxt <= r.hold_expires_at THEN RAISE EXCEPTION 'hold_limit|A hold cannot be extended beyond 24 hours from creation.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.shelter_reservations SET hold_expires_at = nxt, updated_at = now() WHERE id = p_id RETURNING * INTO r;
  PERFORM public.shelter_log(s_id, p_id, 'hold_extended', jsonb_build_object('minutes', p_minutes));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_set_occupancy(p_id UUID, p_count INTEGER, p_basis TEXT) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.shelters%ROWTYPE; tracked INTEGER; warn JSONB := '[]'::jsonb;
BEGIN
  PERFORM public.shelter_require(FALSE);
  IF p_count IS NULL OR p_count < 0 OR p_count > 200000 THEN RAISE EXCEPTION 'invalid_request|Occupancy must be 0-200000.' USING ERRCODE = '22023'; END IF;
  IF p_basis NOT IN ('counted', 'reported', 'estimated') THEN RAISE EXCEPTION 'invalid_request|Basis must be counted, reported or estimated.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.shelters WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shelter_not_found|Shelter not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.shelter_expire_locked(p_id);
  SELECT coalesce(sum(arrived_count), 0) INTO tracked FROM public.shelter_reservations WHERE shelter_id = p_id AND status = 'arrived';
  IF p_count < tracked THEN warn := warn || jsonb_build_object('code', 'below_tracked_arrivals', 'message', format('The count (%s) is below the %s people recorded as arrived through reservations.', p_count, tracked)); END IF;
  UPDATE public.shelters SET current_occupancy = p_count, occupancy_basis = p_basis, occupancy_updated_at = now() WHERE id = p_id;
  PERFORM public.shelter_recompute(p_id);
  PERFORM public.shelter_log(p_id, NULL, 'occupancy_set', jsonb_build_object('from', s.current_occupancy, 'to', p_count, 'basis', p_basis));
  RETURN jsonb_build_object('shelter', (SELECT to_jsonb(x) FROM public.shelters x WHERE x.id = p_id), 'warnings', warn);
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Exceptions (administrators only), registry update, reconciliation
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shelter_create_exception(p_shelter UUID, p_kind TEXT, p_extra INTEGER, p_reason TEXT, p_expires TIMESTAMPTZ, p_actor_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE e public.shelter_exceptions%ROWTYPE;
BEGIN
  PERFORM public.shelter_require(TRUE);
  IF p_expires IS NULL OR p_expires <= now() THEN RAISE EXCEPTION 'invalid_expiry|The exception must expire in the future.' USING ERRCODE = '22023'; END IF;
  IF p_expires > now() + INTERVAL '72 hours' THEN RAISE EXCEPTION 'invalid_expiry|An exception can last at most 72 hours. Renew it if it is still needed.' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = p_shelter FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shelter_not_found|Shelter not found.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.shelter_exceptions (shelter_id, kind, extra_capacity, reason, authorized_by, authorized_by_name, expires_at)
  VALUES (p_shelter, p_kind, CASE WHEN p_kind = 'over_capacity' THEN coalesce(p_extra, 0) ELSE 0 END, p_reason, auth.uid(), coalesce(nullif(p_actor_name, ''), 'administrator'), p_expires) RETURNING * INTO e;
  PERFORM public.shelter_recompute(p_shelter);
  PERFORM public.shelter_log(p_shelter, NULL, 'exception_created', jsonb_build_object('kind', e.kind, 'extra', e.extra_capacity, 'expires_at', e.expires_at, 'reason', e.reason));
  RETURN to_jsonb(e);
END $$;

CREATE OR REPLACE FUNCTION public.shelter_revoke_exception(p_id UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE e public.shelter_exceptions%ROWTYPE;
BEGIN
  PERFORM public.shelter_require(TRUE);
  SELECT * INTO e FROM public.shelter_exceptions WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exception_not_found|Exception not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM 1 FROM public.shelters WHERE id = e.shelter_id FOR UPDATE;
  UPDATE public.shelter_exceptions SET revoked_at = now() WHERE id = p_id RETURNING * INTO e;
  PERFORM public.shelter_recompute(e.shelter_id);
  PERFORM public.shelter_log(e.shelter_id, NULL, 'exception_revoked', jsonb_build_object('exception_id', p_id));
  RETURN to_jsonb(e);
END $$;

-- Admin registry update. `p_patch` keys mirror RegistryPatch in src/lib/shelters/validate.ts (validated by the API first).
CREATE OR REPLACE FUNCTION public.shelter_update_registry(p_id UUID, p_patch JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.shelters%ROWTYPE; cancelled JSONB := '[]'::jsonb; warn JSONB := '[]'::jsonb; fac JSONB; k TEXT; v JSONB; floor_n INTEGER; inside INTEGER; moved BOOLEAN := FALSE; c public.shelter_reservations%ROWTYPE;
BEGIN
  PERFORM public.shelter_require(TRUE);
  SELECT * INTO s FROM public.shelters WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'shelter_not_found|Shelter not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.shelter_expire_locked(p_id);
  SELECT * INTO s FROM public.shelters WHERE id = p_id;

  IF p_patch ? 'capacity' THEN
    floor_n := coalesce(s.current_occupancy, 0) + s.reserved_capacity;
    IF (p_patch ->> 'capacity')::int + s.authorized_overflow < floor_n THEN
      RAISE EXCEPTION 'capacity_below_commitments|Capacity cannot be set below the % people already inside or held.', floor_n USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_patch ? 'facilities' THEN
    fac := s.facilities;
    FOR k, v IN SELECT * FROM jsonb_each(p_patch -> 'facilities') LOOP
      fac := jsonb_set(fac, ARRAY[k], jsonb_build_object('value', v ->> 'value',
        'documented_at', CASE WHEN v ->> 'value' = 'yes' AND coalesce((v ->> 'documented')::boolean, FALSE) THEN to_jsonb(now()) ELSE 'null'::jsonb END,
        'note', coalesce(v -> 'note', 'null'::jsonb)), TRUE);
    END LOOP;
  ELSE fac := s.facilities; END IF;

  moved := (p_patch ? 'location_lat' AND p_patch ? 'location_lng') AND ((p_patch ->> 'location_lat')::numeric IS DISTINCT FROM s.location_lat OR (p_patch ->> 'location_lng')::numeric IS DISTINCT FROM s.location_lng);

  UPDATE public.shelters SET
    name = coalesce(p_patch ->> 'name', name),
    address = CASE WHEN p_patch ? 'address' THEN p_patch ->> 'address' ELSE address END,
    area = CASE WHEN p_patch ? 'area' THEN p_patch ->> 'area' ELSE area END,
    contact_number = CASE WHEN p_patch ? 'contact_number' THEN p_patch ->> 'contact_number' ELSE contact_number END,
    responsible_org = CASE WHEN p_patch ? 'responsible_org' THEN p_patch ->> 'responsible_org' ELSE responsible_org END,
    data_source = CASE WHEN p_patch ? 'data_source' THEN p_patch ->> 'data_source' ELSE data_source END,
    location_source = CASE WHEN p_patch ? 'location_source' THEN p_patch ->> 'location_source' ELSE location_source END,
    opening_hours = CASE WHEN p_patch ? 'opening_hours' THEN p_patch -> 'opening_hours' ELSE opening_hours END,
    wheelchair_access = coalesce(p_patch ->> 'wheelchair_access', wheelchair_access),
    infrastructure_dependencies = CASE WHEN p_patch ? 'infrastructure_dependencies' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch -> 'infrastructure_dependencies')) ELSE infrastructure_dependencies END,
    capacity = coalesce((p_patch ->> 'capacity')::int, capacity),
    facilities = fac,
    location_lat = CASE WHEN moved THEN (p_patch ->> 'location_lat')::numeric ELSE location_lat END,
    location_lng = CASE WHEN moved THEN (p_patch ->> 'location_lng')::numeric ELSE location_lng END,
    location_verified = CASE WHEN moved THEN FALSE WHEN p_patch ? 'location_verified' THEN (p_patch ->> 'location_verified')::boolean ELSE location_verified END,
    location_verified_at = CASE WHEN moved THEN NULL WHEN p_patch ? 'location_verified' THEN (CASE WHEN (p_patch ->> 'location_verified')::boolean THEN now() ELSE NULL END) ELSE location_verified_at END,
    verification_status = coalesce(p_patch ->> 'verification_status', verification_status),
    last_verified_at = CASE WHEN p_patch ->> 'verification_status' = 'verified' THEN now() ELSE last_verified_at END,
    verified_by = CASE WHEN p_patch ->> 'verification_status' = 'verified' THEN auth.uid() ELSE verified_by END,
    updated_at = now()
  WHERE id = p_id;

  IF p_patch ? 'status' AND p_patch ->> 'status' <> s.status::text THEN
    UPDATE public.shelters SET status = (p_patch ->> 'status')::public.shelter_status, auto_full = FALSE WHERE id = p_id;
    IF p_patch ->> 'status' = 'closed' THEN
      FOR c IN SELECT * FROM public.shelter_reservations WHERE shelter_id = p_id AND status = 'reserved' LOOP
        UPDATE public.shelter_reservations SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Shelter closed by an administrator.', updated_at = now() WHERE id = c.id;
        cancelled := cancelled || to_jsonb((SELECT r FROM public.shelter_reservations r WHERE r.id = c.id));
        PERFORM public.shelter_log(p_id, c.id, 'reservation_cancelled', jsonb_build_object('reason', 'shelter_closed'));
      END LOOP;
      SELECT count(*) INTO inside FROM public.shelter_reservations WHERE shelter_id = p_id AND status = 'arrived';
      IF inside > 0 THEN warn := warn || jsonb_build_object('code', 'people_inside', 'message', format('%s tracked group(s) are still recorded as inside this shelter.', inside)); END IF;
      IF jsonb_array_length(cancelled) > 0 THEN warn := warn || jsonb_build_object('code', 'reservations_cancelled', 'message', format('%s reservation(s) were cancelled because the shelter closed. Re-route those groups.', jsonb_array_length(cancelled))); END IF;
    END IF;
    PERFORM public.shelter_log(p_id, NULL, 'status_changed', jsonb_build_object('from', s.status::text, 'to', p_patch ->> 'status'));
  END IF;

  PERFORM public.shelter_recompute(p_id);
  PERFORM public.shelter_log(p_id, NULL, 'registry_updated', jsonb_build_object('fields', (SELECT coalesce(jsonb_agg(key), '[]'::jsonb) FROM jsonb_object_keys(p_patch) AS key)));
  RETURN jsonb_build_object('shelter', (SELECT to_jsonb(x) FROM public.shelters x WHERE x.id = p_id), 'cancelledReservations', cancelled, 'warnings', warn);
END $$;

-- Reconciliation: recompute everything derivable from the ledger; repair held places; REPORT (never rewrite) occupancy problems,
-- because the headcount includes walk-ins that only a person can count.
CREATE OR REPLACE FUNCTION public.shelter_reconcile(p_id UUID DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s public.shelters%ROWTYPE; out JSONB := '[]'::jsonb; true_res INTEGER; tracked INTEGER; stored_res INTEGER;
BEGIN
  PERFORM public.shelter_require(TRUE);
  FOR s IN SELECT * FROM public.shelters WHERE p_id IS NULL OR id = p_id ORDER BY id LOOP
    PERFORM 1 FROM public.shelters WHERE id = s.id FOR UPDATE;
    stored_res := s.reserved_capacity;
    PERFORM public.shelter_expire_locked(s.id);
    SELECT coalesce(sum(party_size), 0) INTO true_res FROM public.shelter_reservations WHERE shelter_id = s.id AND status = 'reserved';
    SELECT coalesce(sum(arrived_count), 0) INTO tracked FROM public.shelter_reservations WHERE shelter_id = s.id AND status = 'arrived';
    SELECT * INTO s FROM public.shelters WHERE id = s.id;
    IF stored_res <> true_res THEN out := out || jsonb_build_object('shelterId', s.id, 'name', s.name, 'check', 'reserved_capacity', 'stored', stored_res, 'computed', true_res, 'fixed', TRUE, 'note', 'Held places did not match the active reservations; corrected.'); END IF;
    IF coalesce(s.current_occupancy, 0) < tracked THEN out := out || jsonb_build_object('shelterId', s.id, 'name', s.name, 'check', 'occupancy_below_tracked', 'stored', coalesce(s.current_occupancy, 0), 'computed', tracked, 'fixed', FALSE, 'note', 'Fewer people are recorded inside than reservations say arrived. A person must recount; occupancy was not changed.'); END IF;
    IF s.capacity IS NOT NULL AND coalesce(s.current_occupancy, 0) + true_res > s.capacity + s.authorized_overflow THEN out := out || jsonb_build_object('shelterId', s.id, 'name', s.name, 'check', 'over_allocated', 'stored', coalesce(s.current_occupancy, 0) + true_res, 'computed', s.capacity + s.authorized_overflow, 'fixed', FALSE, 'note', 'More people are recorded or held than the permitted capacity. A person must decide which groups to move.'); END IF;
    IF s.status = 'closed' AND true_res > 0 THEN out := out || jsonb_build_object('shelterId', s.id, 'name', s.name, 'check', 'reservation_at_closed_shelter', 'stored', true_res, 'computed', 0, 'fixed', FALSE, 'note', 'Active holds exist at a closed shelter. Re-route those groups.'); END IF;
    PERFORM public.shelter_log(s.id, NULL, 'reconciled', '{}'::jsonb);
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.shelter_expire_all() RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE s_id UUID; n INTEGER := 0;
BEGIN
  PERFORM public.shelter_require(FALSE);
  FOR s_id IN SELECT DISTINCT shelter_id FROM public.shelter_reservations WHERE status = 'reserved' AND hold_expires_at <= now() LOOP
    PERFORM 1 FROM public.shelters WHERE id = s_id FOR UPDATE;
    n := n + public.shelter_expire_locked(s_id);
  END LOOP;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Function privileges: signed-in users only; each function then checks the role itself. Never anonymous.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'shelter_reserve(uuid,text,uuid,uuid,integer,jsonb,timestamptz,integer,text)', 'shelter_confirm_arrival(uuid,integer)', 'shelter_record_departure(uuid)',
    'shelter_cancel_reservation(uuid,text)', 'shelter_extend_hold(uuid,integer)', 'shelter_set_occupancy(uuid,integer,text)',
    'shelter_create_exception(uuid,text,integer,text,timestamptz,text)', 'shelter_revoke_exception(uuid)', 'shelter_update_registry(uuid,jsonb)',
    'shelter_reconcile(uuid)', 'shelter_expire_all()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;
