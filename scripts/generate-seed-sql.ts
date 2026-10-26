<<<<<<< HEAD
// Writes supabase/seed/vyra_full_seed.sql from the same simulated data demo mode uses, so a cloud
// Supabase project can be filled with the complete VYRA scenario: sign-in accounts (including an
// administrator), emergency cases and their history, rescue teams, supplies, shelters, route
// hazards, blocked roads and missions.
//
// Usage:  npx tsx scripts/generate-seed-sql.ts        (or: npm run db:seed:generate)
// Edit the data in src/lib/db/demoSeed.ts / demoOpsSeed.ts / demoAccounts.ts, then regenerate.
import { mkdirSync, writeFileSync } from 'node:fs'
import { demoReports, demoRoadBlocks } from '../src/lib/db/demoSeed'
import { buildOps, SHELTER_DEFS, TEAM_DEFS } from '../src/lib/db/demoOpsSeed'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/lib/demoAccounts'
import { triageReport } from '../src/lib/triage'

type Row = Record<string, unknown>

=======
// Writes supabase/migrations/003_demo_seed.sql from the same simulated data the demo mode uses.
// Usage: npx tsx scripts/generate-seed-sql.ts
import { writeFileSync } from 'node:fs'
import { demoReports, demoShelters, demoTeams, demoRoadBlocks } from '../src/lib/db/demoSeed'
import { triageReport } from '../src/lib/triage'

>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
const lit = (v: unknown): string => {
  if (v == null) return 'NULL'
  if (Array.isArray(v) && v.length === 0) return "'{}'"
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return `ARRAY[${v.map(lit).join(', ')}]::TEXT[]`
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::JSONB`
  return `'${String(v).replace(/'/g, "''")}'`
}
<<<<<<< HEAD

const now = Date.now()
// Timestamps are written relative to NOW() so the data always looks fresh when the seed is run.
const ago = (iso: string | null | undefined) =>
  iso == null ? 'NULL' : `NOW() - INTERVAL '${Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))} minutes'`

const values = (rows: string[]) => rows.map((r) => `  ${r}`).join(',\n')
const startsWith = (col: string, ids: string[]) => ids.map((p) => `${col}::TEXT LIKE '${p}%'`).join(' OR ')

// ---- data ------------------------------------------------------------------------------------
const reports = demoReports(now)
const ops = buildOps(reports, now)

const reportCols = [
  'id', 'client_id', 'location_lat', 'location_lng', 'location_address', 'location_source', 'location_accuracy_m', 'area',
  'people_count', 'immediate_danger', 'dangers', 'danger_details', 'injury_severity', 'injury_count', 'injury_details',
  'medical_need_types', 'medical_needs', 'can_evacuate', 'vulnerabilities', 'contact_info', 'status', 'verified', 'priority_score',
=======
const ago = (iso: string | null, now: number) =>
  iso == null ? 'NULL' : `NOW() - INTERVAL '${Math.round((now - new Date(iso).getTime()) / 60000)} minutes'`

const now = Date.now()
const reports = demoReports(now)
const cols = [
  'client_id', 'location_lat', 'location_lng', 'location_address', 'location_source', 'location_accuracy_m', 'area',
  'people_count', 'immediate_danger', 'dangers', 'danger_details', 'injury_severity', 'injury_count', 'injury_details',
  'medical_need_types', 'medical_needs', 'can_evacuate', 'vulnerabilities', 'contact_info', 'status', 'verified',
  'priority_score',
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
] as const

const reportRows = reports.map((r) => {
  const t = triageReport(r, { now: new Date(now) })
<<<<<<< HEAD
  const vals = reportCols.map((c) => (c === 'priority_score' ? String(t.score) : lit((r as Row)[c])))
  return `(${vals.join(', ')}, ${ago(r.resolved_at)}, ${ago(r.created_at)}, ${ago(r.created_at)})`
})

// Audit history, mirroring what the in-memory demo store records for each case.
const eventRows: string[] = []
for (const r of reports) {
  const at = (min: number) => `${ago(r.created_at)} + INTERVAL '${min} minutes'`
  eventRows.push(`(${lit(r.id)}, 'created', 'seed', NULL, NULL, 'Simulated demo report', ${ago(r.created_at)})`)
  if (r.verified) eventRows.push(`(${lit(r.id)}, 'verify', 'Dispatcher (demo)', 'false', 'true', NULL, ${at(4)})`)
  if (r.status !== 'pending') {
    const when = r.resolved_at && r.status === 'resolved' ? ago(r.resolved_at) : at(8)
    eventRows.push(`(${lit(r.id)}, 'status', 'Dispatcher (demo)', 'pending', ${lit(r.status)}, NULL, ${when})`)
  }
}

const teamRows = TEAM_DEFS.map((t, i) => {
  const created = ops.rescue_teams[i].created_at as string
  return `(${[t.id, t.team_name, t.team_leader, t.contact_number, t.base_location, t.team_size, t.capabilities, t.lat, t.lng, t.team_type, t.area, t.map_status].map(lit).join(', ')}, TRUE, ${ago(created)})`
})

const resourceRows = (ops.resources as Row[]).map(
  (x) => `(${[x.id, x.resource_type, x.name, x.quantity, x.team_id, x.status, x.notes].map(lit).join(', ')}, ${ago(x.created_at as string)})`,
)

const shelterRows = SHELTER_DEFS.map((s) => {
  const created = (ops.shelters as Row[]).find((x) => x.id === s.id)!.created_at as string
  return `(${[s.id, s.name, s.address, s.area, s.location_lat, s.location_lng, s.capacity, s.current_occupancy, s.contact_number || null, s.services, s.status, s.verified].map(lit).join(', ')}, ${ago(created)})`
})

const hazardRows = (ops.route_hazards as Row[]).map(
  (h) => `(${[h.id, h.description, h.location_lat, h.location_lng, h.radius_km, h.severity, h.active].map(lit).join(', ')}, ${ago(h.created_at as string)})`,
)

const roadRows = demoRoadBlocks.map((b) => `(${[b.id, b.description, b.reason, b.area, b.path, b.verified].map(lit).join(', ')})`)

const dispatchRows = (ops.dispatches as Row[]).map(
  (d) =>
    `(${[d.id, d.report_id, d.team_id].map(lit).join(', ')}, NULL, ${ago(d.assigned_at as string)}, ${lit(d.status)}, ${lit(d.notes)}, ${lit(d.match_score)}, ${lit(d.distance_km)}, ${lit(d.match_explanation)}, ${ago(d.completed_at as string | null)}, ${ago(d.created_at as string)}, ${ago(d.updated_at as string)})`,
)

const dispatchResourceRows = (ops.dispatch_resources as Row[]).map((x) => `(${[x.id, x.dispatch_id, x.resource_id, x.quantity].map(lit).join(', ')})`)

const accountRows = DEMO_ACCOUNTS.map((a) => `(${lit(a.id)}::UUID, ${lit(a.email)}, ${lit(a.full_name)}, ${lit(a.role)})`)

const live = (ops.dispatches as Row[]).filter((d) => d.status !== 'completed').length
const done = (ops.dispatches as Row[]).length - live
const roles = (r: string) => DEMO_ACCOUNTS.filter((a) => a.role === r).length

// ---- SQL -------------------------------------------------------------------------------------
const sql = `-- =============================================================================
-- VYRA - full demo seed for a cloud Supabase project (SIMULATED DATA ONLY)
-- Vulnerability, Yielded Response & Assistance
--
-- Fictional urban-flooding scenario in Karachi. Contents:
--   ${DEMO_ACCOUNTS.length} sign-in accounts (${roles('admin')} administrator, ${roles('responder')} responders, ${roles('citizen')} citizens) - auth users + profiles
--   ${reports.length} emergency cases across 10 areas, with ${eventRows.length} audit-history events
--   ${TEAM_DEFS.length} rescue teams, ${ops.resources.length} supply records, ${SHELTER_DEFS.length} shelters
--   ${ops.route_hazards.length} route hazards, ${demoRoadBlocks.length} blocked roads
--   ${ops.dispatches.length} missions (${live} live, ${done} completed) and ${ops.dispatch_resources.length} supply allocations
--
-- HOW TO RUN
--   1. Run supabase/vyra_complete_schema.sql, then supabase/migrations/001_stage7_8_dispatch_offline.sql.
--   2. Paste this whole file into Supabase > SQL Editor > New query and press Run.
--      (Or from your terminal: npm run db:setup -- --seed)
--
-- SAFE TO RE-RUN: it removes the previous seed rows first (matched by their fixed ids / names) and
-- inserts them again with fresh timestamps. Reports and accounts created by real users are untouched.
--
-- SECURITY: every account below gets the password set on the "seed_password" line. Change it
-- BEFORE running if this project will be reachable by anyone else, and delete the accounts you
-- do not need afterwards. Do not leave a public admin with a published password on a live site.
--
-- Generated by scripts/generate-seed-sql.ts - edit src/lib/db/demoSeed.ts, demoOpsSeed.ts or
-- demoAccounts.ts instead of this file, then run: npm run db:seed:generate
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- 1. Accounts: auth users (email + password sign-in) and their profiles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  seed_password TEXT := ${lit(DEMO_PASSWORD)};   -- <<< CHANGE THIS before running on a shared project
  a RECORD;
  c RECORD;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
${accountRows.map((r) => `      ${r}`).join(',\n')}
    ) AS t(id, email, full_name, role)
  LOOP
    -- Re-running replaces the account (and resets its password).
    UPDATE public.dispatches SET assigned_by = NULL WHERE assigned_by = a.id;
    DELETE FROM public.profiles WHERE id = a.id OR email = a.email;
    DELETE FROM auth.users WHERE id = a.id OR email = a.email;   -- identities go with it

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', a.id, 'authenticated', 'authenticated', a.email,
      crypt(seed_password, gen_salt('bf')), NOW(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      jsonb_build_object('full_name', a.full_name, 'email_verified', true),
      NOW(), NOW()
    );

    -- GoTrue fails to sign in a user whose token columns are NULL; set whichever exist to ''.
    FOR c IN
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name IN ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                            'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
    LOOP
      EXECUTE format('UPDATE auth.users SET %I = COALESCE(%I, '''') WHERE id = $1', c.column_name, c.column_name) USING a.id;
    END LOOP;

    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), a.id, a.id::TEXT,
      jsonb_build_object('sub', a.id::TEXT, 'email', a.email, 'email_verified', true, 'phone_verified', false),
      'email', NOW(), NOW(), NOW()
    );

    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (a.id, a.email, a.full_name, a.role::user_role);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Remove the previous seed rows (this file is safe to re-run)
-- -----------------------------------------------------------------------------
DELETE FROM dispatches WHERE ${startsWith('id', ['60000000-'])};
DELETE FROM emergency_reports WHERE client_id LIKE 'demo-seed-%' OR ${startsWith('id', ['00000000-0000-4000-8000-'])};
DELETE FROM resources WHERE ${startsWith('id', ['40000000-'])};
DELETE FROM rescue_teams WHERE ${startsWith('id', ['20000000-'])} OR team_name IN (${TEAM_DEFS.map((t) => lit(t.team_name)).join(', ')});
DELETE FROM shelters WHERE ${startsWith('id', ['30000000-'])} OR name IN (${SHELTER_DEFS.map((s) => lit(s.name)).join(', ')});
DELETE FROM route_hazards WHERE ${startsWith('id', ['50000000-'])};
DELETE FROM blocked_roads WHERE ${startsWith('id', ['10000000-'])} OR description IN (${demoRoadBlocks.map((b) => lit(b.description)).join(', ')});


-- -----------------------------------------------------------------------------
-- 3. Emergency cases (${reports.length}) and their audit history (${eventRows.length} events)
-- -----------------------------------------------------------------------------
INSERT INTO emergency_reports (${reportCols.join(', ')}, resolved_at, created_at, updated_at) VALUES
${values(reportRows)};

INSERT INTO report_events (report_id, action, actor, from_value, to_value, note, created_at) VALUES
${values(eventRows)};


-- -----------------------------------------------------------------------------
-- 4. Response operation: teams, supplies, shelters, hazards, roads
-- -----------------------------------------------------------------------------
INSERT INTO rescue_teams (id, team_name, team_leader, contact_number, base_location, team_size, capabilities, current_location_lat, current_location_lng, team_type, area, status, verified, created_at) VALUES
${values(teamRows)};

INSERT INTO resources (id, resource_type, name, quantity, team_id, status, notes, created_at) VALUES
${values(resourceRows)};

INSERT INTO shelters (id, name, address, area, location_lat, location_lng, capacity, current_occupancy, contact_number, services, status, verified, created_at) VALUES
${values(shelterRows)};

INSERT INTO route_hazards (id, description, location_lat, location_lng, radius_km, severity, active, created_at) VALUES
${values(hazardRows)};

INSERT INTO blocked_roads (id, description, reason, area, path, verified) VALUES
${values(roadRows)};


-- -----------------------------------------------------------------------------
-- 5. Missions (${ops.dispatches.length}) and the supplies each one holds (${ops.dispatch_resources.length})
-- -----------------------------------------------------------------------------
INSERT INTO dispatches (id, report_id, team_id, assigned_by, assigned_at, status, notes, match_score, distance_km, match_explanation, completed_at, created_at, updated_at) VALUES
${values(dispatchRows)};

INSERT INTO dispatch_resources (id, dispatch_id, resource_id, quantity) VALUES
${values(dispatchResourceRows)};


-- -----------------------------------------------------------------------------
-- 6. Check: this should list the counts above
-- -----------------------------------------------------------------------------
SELECT 'profiles (demo accounts)' AS item, COUNT(*) AS rows FROM profiles WHERE email LIKE '%@demo.vyra'
UNION ALL SELECT 'auth users (demo accounts)', COUNT(*) FROM auth.users WHERE email LIKE '%@demo.vyra'
UNION ALL SELECT 'emergency_reports', COUNT(*) FROM emergency_reports WHERE client_id LIKE 'demo-seed-%'
UNION ALL SELECT 'report_events', COUNT(*) FROM report_events WHERE actor IN ('seed', 'Dispatcher (demo)')
UNION ALL SELECT 'rescue_teams', COUNT(*) FROM rescue_teams WHERE ${startsWith('id', ['20000000-'])}
UNION ALL SELECT 'resources', COUNT(*) FROM resources WHERE ${startsWith('id', ['40000000-'])}
UNION ALL SELECT 'shelters', COUNT(*) FROM shelters WHERE ${startsWith('id', ['30000000-'])}
UNION ALL SELECT 'route_hazards', COUNT(*) FROM route_hazards WHERE ${startsWith('id', ['50000000-'])}
UNION ALL SELECT 'blocked_roads', COUNT(*) FROM blocked_roads WHERE ${startsWith('id', ['10000000-'])}
UNION ALL SELECT 'dispatches', COUNT(*) FROM dispatches WHERE ${startsWith('id', ['60000000-'])}
UNION ALL SELECT 'dispatch_resources', COUNT(*) FROM dispatch_resources WHERE ${startsWith('id', ['70000000-'])};

NOTIFY pgrst, 'reload schema';
`

mkdirSync(new URL('../supabase/seed/', import.meta.url), { recursive: true })
writeFileSync(new URL('../supabase/seed/vyra_full_seed.sql', import.meta.url), sql)
console.log(
  `wrote supabase/seed/vyra_full_seed.sql  (${(sql.length / 1024).toFixed(0)} KB): ` +
    `${DEMO_ACCOUNTS.length} accounts, ${reports.length} cases, ${eventRows.length} events, ${TEAM_DEFS.length} teams, ` +
    `${ops.resources.length} supplies, ${SHELTER_DEFS.length} shelters, ${ops.route_hazards.length} hazards, ${demoRoadBlocks.length} roads, ` +
    `${ops.dispatches.length} missions, ${ops.dispatch_resources.length} allocations`,
)
=======
  const values = cols.map((c) => (c === 'priority_score' ? String(t.score) : lit(r[c])))
  return `  (${values.join(', ')}, ${ago(r.resolved_at, now)}, ${ago(r.created_at, now)}, ${ago(r.created_at, now)})`
})

const sql = `-- SIMULATED DEMO DATA ONLY (urban flooding in Karachi). Fictional names and numbers.
-- Run after 002_stage4_6.sql. Re-running replaces the previous demo rows only.
-- Generated by scripts/generate-seed-sql.ts - edit src/lib/db/demoSeed.ts instead.

DELETE FROM emergency_reports WHERE client_id LIKE 'demo-seed-%';
DELETE FROM shelters WHERE name IN (${demoShelters.map((s) => lit(s.name)).join(', ')});
DELETE FROM rescue_teams WHERE team_name IN (${demoTeams.map((t) => lit(t.team_name)).join(', ')});
DELETE FROM blocked_roads WHERE description IN (${demoRoadBlocks.map((b) => lit(b.description)).join(', ')});

INSERT INTO emergency_reports (${cols.join(', ')}, resolved_at, created_at, updated_at) VALUES
${reportRows.join(',\n')};

INSERT INTO report_events (report_id, action, actor, note, created_at)
SELECT id, 'created', 'seed', 'Simulated demo report', created_at FROM emergency_reports WHERE client_id LIKE 'demo-seed-%';

INSERT INTO shelters (name, location_lat, location_lng, area, capacity, current_occupancy, services, status, verified) VALUES
${demoShelters.map((s) => `  (${[s.name, s.location_lat, s.location_lng, s.area, s.capacity, s.current_occupancy, s.services].map(lit).join(', ')}, ${lit(s.status)}, ${s.verified})`).join(',\n')};

INSERT INTO rescue_teams (team_name, team_type, capabilities, current_location_lat, current_location_lng, area, status, verified) VALUES
${demoTeams.map((t) => `  (${[t.team_name, t.team_type, t.capabilities, t.current_location_lat, t.current_location_lng, t.area].map(lit).join(', ')}, ${lit(t.status)}, ${t.verified})`).join(',\n')};

INSERT INTO blocked_roads (description, reason, area, path, verified) VALUES
${demoRoadBlocks.map((b) => `  (${[b.description, b.reason, b.area, b.path, b.verified].map(lit).join(', ')})`).join(',\n')};
`

writeFileSync(new URL('../supabase/migrations/003_demo_seed.sql', import.meta.url), sql)
console.log('wrote supabase/migrations/003_demo_seed.sql')
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
