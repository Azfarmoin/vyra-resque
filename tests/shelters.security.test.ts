// Security regression tests: role escalation, demo sign-in in production, public data exposure, and the migrations' guards.
// NOTE: the SQL checks here are STRUCTURAL (they read the migration text). They prove the guards are present, not that Postgres
// enforces them; `npm run test:shelters-sql` executes the migrations in PGlite for that (needs `npm install`).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { demoAuthAllowed } from '../src/lib/demoGuard'
import { recommendShelters } from '../src/lib/shelters/engine'
import { demoShelterExtras } from '../src/lib/shelters/demoData'
import { normaliseShelter } from '../src/lib/shelters/facilities'
import { SHELTER_DEFS } from '../src/lib/db/demoOpsSeed'
import { NOW } from './fixtures/shelters'

const root = new URL('../', import.meta.url).pathname
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })

test('demo sign-in is refused in production unless explicitly allowed (fail closed)', () => {
  assert.equal(demoAuthAllowed({ NODE_ENV: 'production' }), false)
  assert.equal(demoAuthAllowed({ NODE_ENV: 'production', VYRA_ALLOW_DEMO_IN_PRODUCTION: 'false' }), false)
  assert.equal(demoAuthAllowed({ NODE_ENV: 'production', VYRA_ALLOW_DEMO_IN_PRODUCTION: 'yes' }), false) // only the exact string "true"
  assert.equal(demoAuthAllowed({ NODE_ENV: 'production', VYRA_ALLOW_DEMO_IN_PRODUCTION: 'true' }), true)
  assert.equal(demoAuthAllowed({ NODE_ENV: 'development' }), true)
  assert.equal(demoAuthAllowed({}), true)
})

test('every server place that trusts a demo identity header checks the production guard first', () => {
  const files = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f))
  const offenders: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (/headers\.get\('x-demo-(user|admin)'\)|get\('x-demo-/.test(src) || /startsWith\('demo:'\)/.test(src)) {
      if (!src.includes('demoAuthAllowed')) offenders.push(f.replace(root, ''))
    }
  }
  assert.deepEqual(offenders, [])
})

test('no browser code can choose an effective role: only the admin route writes profiles, and sign-up only sends a responder REQUEST', () => {
  const writers: string[] = []
  for (const f of walk(join(root, 'src')).filter((x) => /\.(ts|tsx)$/.test(x))) {
    const src = readFileSync(f, 'utf8')
    if (/from\('profiles'\)\s*\.\s*(insert|update|upsert)/.test(src.replace(/\n\s*/g, ''))) writers.push(f.replace(root, ''))
  }
  assert.deepEqual(writers.sort(), ['src/app/api/admin/users/route.ts'])
  const reg = read('src/app/auth/register/page.tsx')
  // The database trigger creates the profile as a citizen (migration 011); the browser never writes the profiles table or a role.
  assert.ok(/requested_role/.test(reg))
})

test('the old unauthenticated shelter write path is gone', () => {
  const route = read('src/app/api/shelters/route.ts')
  assert.ok(!/serverDb/.test(route))
  assert.ok(/respond\(/.test(route) && /createShelter/.test(route))
})

// ---------------------------------------------------------------------------------------------- migration 011 (structural)
test('011 + 018: profiles can no longer be written freely, roles can only be changed by administrators, sign-up is citizen-only', () => {
  const sql = read('supabase/migrations/011_profiles_role_hardening.sql')
  const code = sql.replace(/--.*$/gm, '') // ignore comments: the header quotes the old vulnerable policies on purpose
  assert.ok(!/WITH CHECK \(true\)/i.test(code) && !/USING \(true\)/i.test(code))
  assert.match(sql, /profiles: insert own as citizen, admin any[\s\S]*id = auth\.uid\(\) AND role = 'citizen'/)
  assert.match(sql, /RAISE EXCEPTION 'Only an administrator can change a role\.'/)
  assert.match(sql, /BEFORE INSERT OR UPDATE ON public\.profiles/)
  assert.match(sql, /handle_new_user[\s\S]*'citizen'/)
  assert.match(read('supabase/migrations/018_profiles_self_demotion_guard.sql'), /cannot remove your own administrator role/)
  assert.ok(!/FOR DELETE/i.test(code), 'no delete policy on profiles')
  assert.match(sql, /SECURITY DEFINER SET search_path = public/)
})

// ---------------------------------------------------------------------------------------------- migration 012 (structural)
test('017: every reservation function locks the shelter row and checks the role; ledgers are not writable through the API', () => {
  const sql = read('supabase/migrations/017_shelter_assistant.sql')
  const code = sql.replace(/--.*$/gm, '')
  for (const fn of ['shelter_reserve', 'shelter_confirm_arrival', 'shelter_record_departure', 'shelter_cancel_reservation', 'shelter_extend_hold', 'shelter_set_occupancy', 'shelter_create_exception', 'shelter_update_registry', 'shelter_reconcile']) {
    const m = new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?END \\$\\$;`).exec(code)
    assert.ok(m, `${fn} exists`)
    assert.match(m![0], /FOR UPDATE/, `${fn} takes a row lock`)
    assert.match(m![0], /shelter_require\((TRUE|FALSE)\)/, `${fn} checks the caller's role`)
    assert.match(m![0], /SECURITY DEFINER SET search_path = public/, `${fn} pins search_path`)
  }
  assert.match(code, /pg_advisory_xact_lock/)
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS shelter_reservations_active_group_uq[\s\S]*WHERE status IN \('reserved', 'arrived'\)/)
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS shelter_reservations_idem_uq/)
  assert.match(code, /status <> 'arrived' OR \(confirmed_arrival_at IS NOT NULL AND confirmed_by IS NOT NULL/)
  for (const t of ['shelter_reservations', 'shelter_exceptions', 'shelter_audit']) {
    assert.match(code, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`))
    assert.ok(!new RegExp(`CREATE POLICY \\w+ ON public\\.${t} FOR (INSERT|UPDATE|DELETE|ALL)`).test(code), `${t} has no write policy`)
  }
  assert.match(code, /shelter_audit_immutable/)
  assert.match(code, /REVOKE ALL ON FUNCTION public\.%s FROM PUBLIC, anon/)
  assert.match(code, /CREATE POLICY shelters_admin_update[\s\S]*current_user_role\(\) = 'admin'/)
  assert.match(code, /CREATE POLICY shelters_read[\s\S]*verification_status = 'verified' OR/)
})

// ---------------------------------------------------------------------------------------------- the demo seed through the real engine
test('the demo shelters behave as designed through the engine: closed/full/unverified never recommended as available, accessibility is honoured', async () => {
  const rows = SHELTER_DEFS.map((s, i) => normaliseShelter({ ...s, ...demoShelterExtras(i, NOW.getTime()) } as never))
  const origin: [number, number] = [24.86, 67.0]
  const plain = await recommendShelters({ origin, needs: { partySize: 5 }, now: NOW }, { shelters: rows, exceptions: [], hazards: [], zones: [], routeAssess: null })
  const byName = (n: string) => [...plain.recommended, ...plain.excluded].find((a) => a.name.includes(n))!
  for (const a of plain.recommended) assert.ok(!['closed', 'full'].includes(rows.find((r) => r.id === a.shelterId)!.status), `${a.name} must not be recommended`)
  assert.ok(plain.excluded.length >= 3)
  const unverified = rows.find((r) => r.verification_status === 'unverified')!
  assert.ok(![...plain.recommended].some((a) => a.shelterId === unverified.id && a.tier === 'recommended'))
  assert.ok(plain.recommended.length > 0)
  void byName

  const wc = await recommendShelters({ origin, needs: { partySize: 5, wheelchairUsers: 2 }, now: NOW }, { shelters: rows, exceptions: [], hazards: [], zones: [], routeAssess: null })
  for (const a of wc.recommended) { const s = rows.find((r) => r.id === a.shelterId)!; assert.equal(s.wheelchair_access, 'full'); assert.equal(s.verification_status, 'verified') }
  const o2 = await recommendShelters({ origin, needs: { partySize: 3, oxygenUsers: 1 }, now: NOW }, { shelters: rows, exceptions: [], hazards: [], zones: [], routeAssess: null })
  assert.ok(o2.recommended.length >= 1)
  for (const a of o2.recommended) assert.ok(rows.find((r) => r.id === a.shelterId)!.facilities.oxygen_support?.documented_at)
  const impossible = await recommendShelters({ origin, needs: { partySize: 5000 }, now: NOW }, { shelters: rows, exceptions: [], hazards: [], zones: [], routeAssess: null })
  assert.equal(impossible.recommended.length, 0)
  assert.equal(impossible.humanReview.required, true)
})

// ---------------------------------------------------------------------------------------------- every mutating route is gated
test('every mutating API route has an authentication check (or is on the short, explained public allowlist)', () => {
  const AUTH = /staffGate|requireResponder|requireAdmin|resolveCaller|supportCaller|zoneCaller|callerFrom|requireStaff|respond\(|CRON_SECRET|getCaller|readCaller|identify\(|guard\(request|checkGatewayKey|verifyTwilioSignature/
  // Public by design: citizens subscribe to push alerts; the scheduler authenticates with CRON_SECRET; flood and satellite routes use guard() (responder sign-in); the radio/SMS gateways authenticate with GATEWAY_API_KEY or a signed Twilio request; demo sign-in is the demo itself
  // (disabled in production by demoAuthAllowed). Anything else must be gated. Routes that call identify() resolve the caller and enforce the
  // role inside their service layer (zones editing, support administration); support submission itself is open and rate limited on purpose.
  const PUBLIC = new Set(['alerts/push/route.ts', 'demo/auth/route.ts'])
  const api = join(root, 'src/app/api')
  const open: string[] = []
  for (const f of walk(api).filter((x) => x.endsWith('/route.ts'))) {
    const src = readFileSync(f, 'utf8')
    if (!/export (async )?function (POST|PATCH|PUT|DELETE)|export const (POST|PATCH|PUT|DELETE)\b/.test(src)) continue
    const rel = f.replace(api + '/', '')
    if (!AUTH.test(src) && !PUBLIC.has(rel)) open.push(rel)
  }
  assert.deepEqual(open, [])
})

test('the staff gate keeps local demo and tests working but is enforced in production and in real Supabase mode', () => {
  const src = read('src/lib/staffGate.ts')
  assert.match(src, /isDemoMode\(\) && process\.env\.NODE_ENV !== 'production'/)
  assert.match(src, /requireResponder\(request\)/)
  for (const f of ['dispatches/route.ts', 'dispatches/[id]/route.ts', 'reports/[id]/route.ts', 'reports/[id]/triage-override/route.ts', 'reports/[id]/verify/route.ts', 'resources/route.ts', 'resources/[id]/route.ts', 'teams/route.ts', 'teams/[id]/route.ts']) {
    const route = read(`src/app/api/${f}`)
    const mutators = (route.match(/export async function (POST|PATCH|PUT|DELETE)/g) ?? []).length
    assert.equal((route.match(/await staffGate\(request\)/g) ?? []).length, mutators, `${f}: every mutating handler is gated`)
  }
})
