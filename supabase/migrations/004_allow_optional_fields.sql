-- VYRA: make optional fields optional again. Safe to re-run.
--
-- The live database requires reporter_id (NOT NULL), unlike supabase/schema.sql.
-- That blocks every anonymous emergency report ("null value in column reporter_id
<<<<<<< HEAD
-- ... violates not-null constraint") and also made the demo seed fail.
-- People in an emergency must be able to ask for help without logging in, so these
-- columns are optional by design. run this, then re-run seed/vyra_full_seed.sql.
=======
-- ... violates not-null constraint") and also made 003_demo_seed.sql fail.
-- People in an emergency must be able to ask for help without logging in, so these
-- columns are optional by design. Run this, then re-run 003_demo_seed.sql.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND is_nullable = 'NO'
      AND (table_name, column_name) IN (
        ('emergency_reports', 'reporter_id'),
        ('emergency_reports', 'location_address'),
        ('emergency_reports', 'people_count'),
        ('emergency_reports', 'injury_details'),
        ('emergency_reports', 'medical_needs'),
        ('emergency_reports', 'contact_info'),
        ('emergency_reports', 'priority_explanation'),
        ('shelters', 'address'),
        ('shelters', 'capacity'),
        ('shelters', 'contact_number'),
        ('rescue_teams', 'team_leader'),
        ('rescue_teams', 'contact_number')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', col.table_name, col.column_name);
    RAISE NOTICE 'Made %.% optional', col.table_name, col.column_name;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
