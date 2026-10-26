// Generates supabase/seed/vyra_large_seed.sql: a very large, entirely new simulated dataset for a cloud Supabase project.
// It REPLACES the older small seed: running the file removes the old seed rows (and the old @demo.vyra accounts) first.
// Usage: npm run db:seed:generate:large        (output is deterministic; timestamps are relative to NOW() when the SQL runs)
import { writeFileSync } from 'node:fs'
const { buildLargeDataset, LARGE_SIZES } = await import('../src/lib/db/largeSeed.ts')

const OUT = new URL('../supabase/seed/vyra_large_seed.sql', import.meta.url)
const now = Date.now()
const d = buildLargeDataset(now, LARGE_SIZES, { withUsers: true })

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const lit = (v: unknown): string => {
  if (v == null) return 'NULL'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.length === 0) return "'{}'"
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return `ARRAY[${v.map(lit).join(', ')}]::TEXT[]`
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::JSONB`
  return `'${String(v).replace(/'/g, "''")}'`
}
// Timestamps become "NOW() - INTERVAL 'N seconds'" so the data is fresh whenever the seed is run.
const ts = (iso: string | null) => (iso == null ? 'NULL' : `NOW() - INTERVAL '${Math.max(0, Math.round((now - Date.parse(iso)) / 1000))} seconds'`)
const BATCH = 400
function insert(table: string, cols: string[], rows: Row[], map: (r: Row, c: string) => string = (r, c) => lit(r[c])) {
  const parts: string[] = []
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => `  (${cols.map((c) => map(r, c)).join(', ')})`).join(',\n')
    parts.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${chunk};`)
  }
  return parts.join('\n\n')
}
const timeCols = new Set(['created_at', 'updated_at', 'resolved_at', 'assigned_at', 'completed_at'])
const tsMap = (r: Row, c: string) => (timeCols.has(c) ? ts(r[c]) : lit(r[c]))

// Missions get a responder as "assigned by" (cloud seed only).
const responders = d.accounts.filter((a) => a.role !== 'citizen').map((a) => a.id)
d.dispatches.forEach((m, i) => { m.assigned_by = i % 5 === 0 ? null : responders[i % responders.length] })

const reportCols = ['id', 'reporter_id', 'client_id', 'location_lat', 'location_lng', 'location_address', 'location_source', 'location_accuracy_m', 'area', 'people_count', 'immediate_danger', 'dangers', 'danger_details', 'injury_severity', 'injury_count', 'injury_details', 'medical_need_types', 'medical_needs', 'can_evacuate', 'vulnerabilities', 'contact_info', 'status', 'verified', 'priority_score', 'resolved_at', 'created_at', 'updated_at']
const eventCols = ['report_id', 'action', 'actor', 'from_value', 'to_value', 'note', 'created_at']
const teamCols = ['id', 'team_name', 'team_leader', 'contact_number', 'base_location', 'team_size', 'capabilities', 'current_location_lat', 'current_location_lng', 'team_type', 'area', 'status', 'verified', 'created_at']
const resCols = ['id', 'resource_type', 'name', 'quantity', 'team_id', 'status', 'notes', 'created_at']
const shelterCols = ['id', 'name', 'address', 'area', 'location_lat', 'location_lng', 'capacity', 'current_occupancy', 'contact_number', 'services', 'status', 'verified', 'created_at']
const hazardCols = ['id', 'description', 'location_lat', 'location_lng', 'radius_km', 'severity', 'active', 'created_at']
const roadCols = ['id', 'description', 'reason', 'area', 'path', 'verified']
const dispCols = ['id', 'report_id', 'team_id', 'assigned_by', 'assigned_at', 'status', 'notes', 'match_score', 'distance_km', 'match_explanation', 'completed_at', 'created_at', 'updated_at']
const drCols = ['id', 'dispatch_id', 'resource_id', 'quantity']

const accountValues = d.accounts.map((a) => `      (${lit(a.id)}::UUID, ${lit(a.email)}, ${lit(a.full_name)}, ${lit(a.role)})`).join(',\n')
const n = (k: keyof typeof d) => (d[k] as unknown[]).length
const count = (a: string) => a.padStart(1)

const sql = `-- =============================================================================
-- VYRA - LARGE demo seed for a cloud Supabase project (SIMULATED DATA ONLY)
-- Vulnerability, Yielded Response & Assistance
--
-- A completely new, fictional urban-flooding dataset for Karachi. It does NOT reuse any row of the older small seed.
--   ${n('accounts')} sign-in accounts (${LARGE_SIZES.admins} administrators, ${LARGE_SIZES.responders} responders, ${LARGE_SIZES.citizens} citizens), password = the seed_password line below
--   ${n('reports')} emergency cases over the last three weeks across 10 areas, with ${n('report_events')} audit-history events
--   ${n('rescue_teams')} rescue teams, ${n('resources')} supply records, ${n('shelters')} shelters
--   ${n('route_hazards')} route hazards, ${n('blocked_roads')} blocked roads
--   ${n('dispatches')} missions (active, completed and cancelled) and ${n('dispatch_resources')} supply allocations
--
-- HOW TO RUN
--   Recommended:  npm run db:setup -- --seed        (tables + migrations + this file; handles the password for you)
--   Seed only:    npm run db:seed
--   By hand:      run the schema and migrations first (see SETUP_GUIDE.md), then paste this file into the SQL Editor.
--                 It is several megabytes, so the command above is the practical way.
--
-- SAFE TO RE-RUN: it first removes every row of the older small seeds and of this seed (matched by fixed ids, client ids and
-- the @demo.vyra / @seed.vyra email domains), then inserts everything again with fresh timestamps.
-- Reports, shelters, teams and accounts that real people created are untouched.
--
-- SECURITY: every account below gets the password on the "seed_password" line. Change it BEFORE running on a shared project.
-- Locations are approximate points around each operational area, not surveyed addresses. All names and numbers are invented.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 1. Remove the previous seed rows (old small seed, old 80-case seed, and this seed)
-- -----------------------------------------------------------------------------
DELETE FROM dispatch_resources WHERE id::TEXT ~ '^(70000000|a7000000)-';
DELETE FROM dispatches WHERE id::TEXT ~ '^(60000000|a6000000)-';
DELETE FROM report_events WHERE report_id IN (SELECT id FROM emergency_reports WHERE client_id ~ '^(demo-seed|seed-large)-' OR id::TEXT ~ '^(00000000-0000-4000-8000|a0000000)-');
DELETE FROM emergency_reports WHERE client_id ~ '^(demo-seed|seed-large)-' OR id::TEXT ~ '^(00000000-0000-4000-8000|a0000000)-';
DELETE FROM resources WHERE id::TEXT ~ '^(40000000|a4000000)-';
DELETE FROM rescue_teams WHERE id::TEXT ~ '^(20000000|a2000000)-' OR team_name IN ('Boat Team Alpha', 'Boat Team Bravo', 'Boat Team Charlie', 'Boat Team Delta', 'Medical Unit 3', 'Medical Unit 5', 'Medical Unit 8', 'Search & Rescue Bravo', 'Search & Rescue Echo', 'Search & Rescue Foxtrot', 'Fire Response Kilo', 'Evacuation Bus Crew 2', 'Evacuation Truck Crew 4', 'Logistics Truck 7', 'Logistics Truck 9', 'Community Volunteers Orangi');
DELETE FROM shelters WHERE id::TEXT ~ '^(30000000|a3000000)-' OR name IN ('Govt. Boys School Shelter (Lyari)', 'Community Hall Gulshan', 'Malir Relief Camp', 'Korangi Sports Complex', 'Landhi Girls College Shelter', 'Keamari Port Trust Hall', 'Orangi Community Centre', 'North Nazimabad Girls School', 'Saddar Church Hall', 'Clifton Youth Centre', 'Rumoured shelter at mosque');
DELETE FROM route_hazards WHERE id::TEXT ~ '^(50000000|a5000000)-';
DELETE FROM blocked_roads WHERE id::TEXT ~ '^(10000000|a1000000)-' OR description IN ('Lyari Expressway underpass flooded', 'Korangi Road submerged near Qayyumabad', 'Debris on Malir River bridge approach', 'Landhi 89 stop road under 1 m of water', 'Orangi nullah bridge closed, structure cracked', 'Fallen trees on Sharae Faisal service lane', 'Keamari Port Road waterlogged', 'Gulshan Block 7 underpass flooded', 'Possible block on University Road');

-- Old and new seed accounts. An account that other records still point to (for example a route decision it made) is kept.
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id FROM auth.users WHERE email ~ '@(demo|seed)\\.vyra$' LOOP
    BEGIN
      UPDATE public.dispatches SET assigned_by = NULL WHERE assigned_by = u.id;
      DELETE FROM public.profiles WHERE id = u.id;
      DELETE FROM auth.users WHERE id = u.id;   -- identities go with it
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'Kept account % because other records still reference it', u.id;
    END;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Accounts: auth users (email + password sign-in) and their profiles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  seed_password TEXT := 'VYRA-demo-1';   -- <<< CHANGE THIS before running on a shared project
  pwhash TEXT;
  c RECORD;
BEGIN
  pwhash := crypt(seed_password, gen_salt('bf'));   -- hashed once and shared, so ${n('accounts')} accounts load in seconds

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT '00000000-0000-0000-0000-000000000000', t.id, 'authenticated', 'authenticated', t.email, pwhash, NOW(),
         '{"provider":"email","providers":["email"]}'::JSONB, jsonb_build_object('full_name', t.full_name, 'email_verified', true), NOW(), NOW()
  FROM (VALUES
${accountValues}
  ) AS t(id, email, full_name, role)
  ON CONFLICT (id) DO NOTHING;

  -- GoTrue fails to sign in a user whose token columns are NULL; set whichever exist to ''.
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name IN ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                          'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
  LOOP
    EXECUTE format('UPDATE auth.users SET %I = COALESCE(%I, '''') WHERE email LIKE ''%%@seed.vyra''', c.column_name, c.column_name);
  END LOOP;

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), u.id, u.id::TEXT,
         jsonb_build_object('sub', u.id::TEXT, 'email', u.email, 'email_verified', true, 'phone_verified', false),
         'email', NOW(), NOW(), NOW()
  FROM auth.users u WHERE u.email LIKE '%@seed.vyra'
  AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id);

  -- The profile row may already exist (created by the sign-up trigger as a citizen); set the intended role.
  -- This runs as the database owner, which the role guard from migration 011 trusts.
  INSERT INTO public.profiles (id, email, full_name, role)
  SELECT t.id, t.email, t.full_name, t.role::user_role
  FROM (VALUES
${accountValues}
  ) AS t(id, email, full_name, role)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Emergency cases (${n('reports')}) and their audit history (${n('report_events')} events)
-- -----------------------------------------------------------------------------
${insert('emergency_reports', reportCols, d.reports, tsMap)}

${insert('report_events', eventCols, d.report_events, tsMap)}

-- -----------------------------------------------------------------------------
-- 4. Rescue teams (${n('rescue_teams')}), supplies (${n('resources')}), shelters (${n('shelters')})
-- -----------------------------------------------------------------------------
${insert('rescue_teams', teamCols, d.rescue_teams, tsMap)}

${insert('resources', resCols, d.resources, tsMap)}

${insert('shelters', shelterCols, d.shelters, tsMap)}

-- -----------------------------------------------------------------------------
-- 5. Route hazards (${n('route_hazards')}) and blocked roads (${n('blocked_roads')})
-- -----------------------------------------------------------------------------
${insert('route_hazards', hazardCols, d.route_hazards, tsMap)}

${insert('blocked_roads', roadCols, d.blocked_roads, tsMap)}

-- -----------------------------------------------------------------------------
-- 6. Missions (${n('dispatches')}) and their supply allocations (${n('dispatch_resources')})
-- -----------------------------------------------------------------------------
${insert('dispatches', dispCols, d.dispatches, tsMap)}

${insert('dispatch_resources', drCols, d.dispatch_resources, tsMap)}

-- -----------------------------------------------------------------------------
-- 7. Check: every line below should match the counts in the header
-- -----------------------------------------------------------------------------
ANALYZE emergency_reports; ANALYZE report_events; ANALYZE dispatches;

SELECT 'profiles (seed accounts)' AS item, COUNT(*) AS rows FROM profiles WHERE email LIKE '%@seed.vyra'
UNION ALL SELECT 'auth users (seed accounts)', COUNT(*) FROM auth.users WHERE email LIKE '%@seed.vyra'
UNION ALL SELECT 'emergency_reports', COUNT(*) FROM emergency_reports WHERE client_id LIKE 'seed-large-%'
UNION ALL SELECT 'report_events', COUNT(*) FROM report_events WHERE actor IN ('seed', 'Dispatcher (seed)')
UNION ALL SELECT 'rescue_teams', COUNT(*) FROM rescue_teams WHERE id::TEXT LIKE 'a2000000-%'
UNION ALL SELECT 'resources', COUNT(*) FROM resources WHERE id::TEXT LIKE 'a4000000-%'
UNION ALL SELECT 'shelters', COUNT(*) FROM shelters WHERE id::TEXT LIKE 'a3000000-%'
UNION ALL SELECT 'route_hazards', COUNT(*) FROM route_hazards WHERE id::TEXT LIKE 'a5000000-%'
UNION ALL SELECT 'blocked_roads', COUNT(*) FROM blocked_roads WHERE id::TEXT LIKE 'a1000000-%'
UNION ALL SELECT 'dispatches', COUNT(*) FROM dispatches WHERE id::TEXT LIKE 'a6000000-%'
UNION ALL SELECT 'dispatch_resources', COUNT(*) FROM dispatch_resources WHERE id::TEXT LIKE 'a7000000-%';

NOTIFY pgrst, 'reload schema';
`

writeFileSync(OUT, sql)
console.log(`wrote ${OUT.pathname} (${(sql.length / 1e6).toFixed(1)} MB)`)
for (const [k, v] of Object.entries(d)) console.log(`  ${k.padEnd(20)} ${(v as unknown[]).length}`)
