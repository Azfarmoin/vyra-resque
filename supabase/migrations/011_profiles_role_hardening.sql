-- VYRA 011: close the role-escalation hole in public.profiles.  RUN THIS BEFORE ANY PUBLIC DEPLOYMENT.
-- Safe to run more than once.
--
-- What was wrong (vyra_complete_schema.sql section 7 and migration 002):
--   * "Users can update their own profile"  FOR UPDATE USING (true)        -> anyone holding the public (anon) key could
--     run  PATCH /rest/v1/profiles?id=eq.<anyone>  {"role":"admin"}  and become an administrator.
--   * "Users can insert their own profile"  FOR INSERT WITH CHECK (true)   -> anyone could create a profile with role 'admin'.
--   * The sign-up page sent the role chosen in the browser straight into that insert.
--   * "Public profiles are viewable by everyone" exposed every account's email address and role to anonymous callers.
--
-- What this migration does:
--   1. Replaces all profiles policies:
--        SELECT  own row, or any row for responders/admins
--        INSERT  own row as 'citizen' only (admins may insert any role)
--        UPDATE  own row but the role can never change; admins may update any row
--   2. Adds a trigger as a second line of defence: only admins or trusted server roles can set or change a role or email,
--      even if a policy is later edited by mistake.
--   3. Creates the profile row in the database when an auth user is created (always 'citizen'). The browser no longer
--      writes profiles. A person may REQUEST responder access (profiles.requested_role); an administrator approves it.
--
-- AFTER RUNNING: review who is privileged. Anyone could have promoted themselves before this fix:
--     select id, email, role, created_at from public.profiles where role <> 'citizen' order by created_at;

-- ---------------------------------------------------------------------------------------------------------------
-- 0. Helpers and the request column
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role::TEXT FROM public.profiles WHERE id = auth.uid() $$;

-- A request is only a flag an administrator reads. It grants nothing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS requested_role TEXT CHECK (requested_role IS NULL OR requested_role = 'responder');

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row Level Security policies for profiles
-- ---------------------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
  END LOOP;
END $$;

-- current_user_role() is SECURITY DEFINER, so these policies do not recurse into profiles.
CREATE POLICY "profiles: read own, staff read all" ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.current_user_role() IN ('responder', 'admin'));

CREATE POLICY "profiles: insert own as citizen, admin any" ON public.profiles FOR INSERT
  WITH CHECK ((id = auth.uid() AND role = 'citizen') OR public.current_user_role() = 'admin');

CREATE POLICY "profiles: update own without changing role, admin any" ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.current_user_role() = 'admin')
  WITH CHECK ((id = auth.uid() AND role::TEXT = public.current_user_role()) OR public.current_user_role() = 'admin');

-- No DELETE policy: nobody deletes profiles through the API (auth.users cascades are done by the service role).

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Trigger: second line of defence
--    SECURITY INVOKER on purpose: current_user is the role PostgREST switched to (anon / authenticated / service_role).
--    Only those two API roles are restricted; service_role, postgres and the SQL editor are trusted.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;                                   -- trusted server-side caller
  END IF;
  IF coalesce(public.current_user_role(), '') = 'admin' THEN
    RETURN NEW;                                   -- an administrator managing accounts
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'citizen' THEN
      RAISE EXCEPTION 'Only an administrator can create a % profile.', NEW.role USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only an administrator can change a role.' USING ERRCODE = '42501';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Email and id cannot be changed here.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_role ON public.profiles;
CREATE TRIGGER guard_profile_role
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_role();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Create the profile when the auth user is created. The role is NEVER read from user metadata.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, requested_role)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    'citizen',
    CASE WHEN NEW.raw_user_meta_data ->> 'requested_role' = 'responder' THEN 'responder' ELSE NULL END
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
