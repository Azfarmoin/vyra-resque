-- VYRA 018: one extra guard on profiles.role, added with the shelter assistant. Safe to run more than once.
-- Run after 011_profiles_role_hardening.sql (it replaces that migration's trigger function; the trigger itself is unchanged).
--
-- 011 already stops everyone but administrators from changing a role, and already creates profiles as 'citizen' on sign-up.
-- This adds two rules that came from the shelter-assistant security review:
--   1. An administrator cannot remove their OWN administrator role through the API (prevents locking everyone out;
--      ask another administrator). Trusted server roles (service_role, postgres, SQL editor) are not restricted.
--   2. When an administrator changes a role, the person's pending responder request is closed (requested_role = NULL).

CREATE OR REPLACE FUNCTION public.guard_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;                                   -- trusted server-side caller
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role
     AND OLD.role::TEXT = 'admin' AND NEW.role::TEXT <> 'admin'
     AND auth.uid() IS NOT NULL AND NEW.id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot remove your own administrator role. Ask another administrator.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(public.current_user_role(), '') = 'admin' THEN
    IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.requested_role := NULL;                 -- a decision was made; the request is closed
    END IF;
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

NOTIFY pgrst, 'reload schema';
