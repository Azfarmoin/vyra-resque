-- VYRA: allow triage scores above 100. Safe to re-run.
--
-- The live database has a CHECK constraint (emergency_reports_priority_score_check)
-- from the Stage 3 engine, which capped scores at 100. The Stage 6 engine adds up
-- explained points (e.g. 106, 137), so the most urgent cases go over 100. Capping
-- would make the worst cases tie, so only require the score to be non-negative.
<<<<<<< HEAD
-- run this, then re-run seed/vyra_full_seed.sql.
=======
-- Run this, then re-run 003_demo_seed.sql.
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

ALTER TABLE emergency_reports DROP CONSTRAINT IF EXISTS emergency_reports_priority_score_check;
ALTER TABLE emergency_reports ADD CONSTRAINT emergency_reports_priority_score_check CHECK (priority_score >= 0);

NOTIFY pgrst, 'reload schema';
