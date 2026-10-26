// Role permissions at the handler level: every exported handler is called as anonymous, citizen, responder and admin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as H from '../src/lib/shelters/handlers'
import { createMemoryShelterService, emptyShelterTables } from '../src/lib/shelters/service'
import type { Actor } from '../src/lib/shelters/types'
import { NOW, ORIGIN, documented, shelter } from './fixtures/shelters'

const ROLES: Record<string, Actor | null> = {
  anonymous: null,
  citizen: { id: 'c1', name: 'Bilal', role: 'citizen' },
  responder: { id: 'r1', name: 'Hamza', role: 'responder' },
  admin: { id: 'a1', name: 'Amina', role: 'admin' },
}
const ID = '11111111-1111-4111-8111-111111111111'
let k = 0
function fresh() {
  const a = shelter({ name: 'Alpha', wheelchair_access: 'full', facilities: { drinking_water: documented(), sanitation: documented() } })
  const b = shelter({ name: 'Unverified', verification_status: 'unverified', verified: false })
  const tables = emptyShelterTables([{ ...a }, { ...b }])
  const service = createMemoryShelterService(tables, { now: () => NOW })
  const deps: H.HandlerDeps = { service, loadRisk: async () => ({ hazards: [], zones: [], notices: [] }), routeAssessor: () => null, loadDemand: async () => [], now: () => NOW }
  return { tables, service, deps, a, b }
}

type Case = { name: string; minRole: 'public' | 'responder' | 'admin'; call: (c: Actor | null, f: ReturnType<typeof fresh>) => Promise<H.Result> }
const cases: Case[] = [
  { name: 'listShelters', minRole: 'public', call: (c, f) => H.listShelters(c, f.deps) },
  { name: 'getShelter', minRole: 'responder', call: (c, f) => H.getShelter(c, f.a.id, f.deps) },
  { name: 'createShelter', minRole: 'admin', call: (c, f) => H.createShelter(c, { name: 'New', location_lat: 24.9, location_lng: 67.1, capacity: 20 }, f.deps) },
  { name: 'patchShelter (occupancy)', minRole: 'responder', call: (c, f) => H.patchShelter(c, f.a.id, { occupancy: { count: 5, basis: 'counted' } }, f.deps) },
  { name: 'patchShelter (registry)', minRole: 'admin', call: (c, f) => H.patchShelter(c, f.a.id, { name: 'Renamed' }, f.deps) },
  { name: 'recommend', minRole: 'responder', call: (c, f) => H.recommend(c, { origin: { lat: ORIGIN[0], lng: ORIGIN[1] }, needs: { partySize: 4 } }, f.deps) },
  { name: 'listReservations', minRole: 'responder', call: (c, f) => H.listReservations(c, {}, f.deps) },
  { name: 'reserve', minRole: 'responder', call: (c, f) => H.reserve(c, { shelterId: f.a.id, groupLabel: 'Group', needs: { partySize: 3 }, idempotencyKey: `perm-key-${++k}` }, f.deps) },
  { name: 'reservationAction', minRole: 'responder', call: (c, f) => H.reservationAction(c, ID, { action: 'cancel', reason: 'testing' }, f.deps) },
  { name: 'dashboard', minRole: 'responder', call: (c, f) => H.dashboard(c, f.deps) },
  { name: 'coverage', minRole: 'responder', call: (c, f) => H.coverage(c, {}, f.deps) },
  { name: 'evaluateHypotheticals', minRole: 'responder', call: (c, f) => H.evaluateHypotheticals(c, { candidates: [{ name: 'X', lat: 24.9, lng: 67.1, capacity: 50 }] }, f.deps) },
  { name: 'createException', minRole: 'admin', call: (c, f) => H.createException(c, { shelterId: f.a.id, kind: 'closed_use', reason: 'Opened by district officer', expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() }, f.deps) },
  { name: 'revokeException', minRole: 'admin', call: (c, f) => H.revokeException(c, ID, f.deps) },
  { name: 'listExceptions', minRole: 'responder', call: (c, f) => H.listExceptions(c, f.deps) },
  { name: 'reconcile', minRole: 'admin', call: (c, f) => H.reconcile(c, null, f.deps) },
  { name: 'audit', minRole: 'admin', call: (c, f) => H.audit(c, {}, f.deps) },
]
const rank = { anonymous: 0, citizen: 0, responder: 1, admin: 2 } as const
const need = { public: 0, responder: 1, admin: 2 } as const

for (const c of cases) {
  test(`role matrix: ${c.name} (needs ${c.minRole})`, async () => {
    for (const [role, actor] of Object.entries(ROLES)) {
      const r = await c.call(actor, fresh())
      const allowed = c.minRole === 'public' || rank[role as keyof typeof rank] >= need[c.minRole]
      if (allowed) assert.ok(r.status < 400 || ![401, 403].includes(r.status), `${role} should be allowed on ${c.name}, got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)
      else assert.equal(r.status, role === 'anonymous' ? 401 : 403, `${role} must be refused on ${c.name}, got ${r.status}`)
    }
  })
}

test('every exported handler is covered by the role matrix (a new handler cannot ship without a permission test)', () => {
  const exported = Object.keys(H).filter((n) => !['gate', 'staffView', 'siteBlockersFrom', 'INTEGRATIONS'].includes(n))
  const covered = new Set(cases.map((c) => c.name.split(' ')[0]))
  assert.deepEqual(exported.filter((n) => !covered.has(n)), [])
})

test('refused callers cause no change: a citizen cannot reserve, edit, close, or authorize anything', async () => {
  const f = fresh()
  const before = JSON.stringify(f.tables)
  const citizen = ROLES.citizen
  await H.reserve(citizen, { shelterId: f.a.id, groupLabel: 'Group', needs: { partySize: 3 }, idempotencyKey: 'citizen-key-1' }, f.deps)
  await H.patchShelter(citizen, f.a.id, { status: 'closed' }, f.deps)
  await H.patchShelter(citizen, f.a.id, { occupancy: { count: 0, basis: 'counted' } }, f.deps)
  await H.createException(citizen, { shelterId: f.a.id, kind: 'closed_use', reason: 'I would like this open', expiresAt: new Date(NOW.getTime() + 3_600_000).toISOString() }, f.deps)
  assert.equal(JSON.stringify(f.tables), before)
})

test('privilege escalation through the API shape: a responder cannot change registry fields via the occupancy route, nor smuggle server-owned fields', async () => {
  const f = fresh()
  const resp = ROLES.responder
  const mixed = await H.patchShelter(resp, f.a.id, { occupancy: { count: 1, basis: 'counted' }, status: 'closed' }, f.deps)
  assert.equal(mixed.status, 400)
  const reg = await H.patchShelter(resp, f.a.id, { name: 'Hacked' }, f.deps)
  assert.equal(reg.status, 403)
  const adm = ROLES.admin
  for (const bad of [{ reserved_capacity: 0 }, { authorized_overflow: 500 }, { verified: true }, { id: ID }, { role: 'admin' }]) {
    assert.equal((await H.patchShelter(adm, f.a.id, bad, f.deps)).status, 400, JSON.stringify(bad))
  }
  assert.equal((await H.reservationAction(resp, ID, { action: 'confirm_arrival', status: 'arrived' }, f.deps)).status, 400)
})

test('the public list shows verified shelters only, with public fields only (no counts, facilities, reservations or audit data)', async () => {
  const f = fresh()
  for (const who of [null, ROLES.citizen]) {
    const r = await H.listShelters(who, f.deps)
    const body = r.body as { shelters: Record<string, unknown>[]; view: string }
    assert.equal(body.view, 'public')
    assert.deepEqual(body.shelters.map((s) => s.name), ['Alpha'])
    const keys = Object.keys(body.shelters[0])
    for (const banned of ['current_occupancy', 'capacity', 'facilities', 'reserved_capacity', 'responsible_org', 'verified_by', 'availability', 'dataQuality', 'opening_hours']) assert.ok(!keys.includes(banned), banned)
  }
  const staff = (await H.listShelters(ROLES.responder, f.deps)).body as { shelters: { name: string; availability: unknown; dataQuality: unknown }[]; view: string }
  assert.equal(staff.view, 'staff')
  assert.equal(staff.shelters.length, 2)
  assert.ok(staff.shelters[0].availability && staff.shelters[0].dataQuality)
})

test('end to end through handlers: recommend -> reserve -> arrive -> depart, with an unmet wheelchair need refused at reservation', async () => {
  const f = fresh()
  const resp = ROLES.responder
  const rec = (await H.recommend(resp, { origin: { lat: ORIGIN[0], lng: ORIGIN[1] }, needs: { partySize: 6, wheelchairUsers: 1 } }, f.deps)).body as { recommended: { name: string; tier: string }[]; excluded: { name: string }[]; integrations: { floodSimulation: string }; disclaimer: string }
  assert.deepEqual(rec.recommended.map((r) => r.name), ['Alpha'])
  assert.deepEqual(rec.excluded.map((r) => r.name), ['Unverified'])
  assert.match(rec.integrations.floodSimulation, /NOT AVAILABLE/)
  assert.match(rec.disclaimer, /Decision support only/)
  const bad = await H.reserve(resp, { shelterId: f.b.id, groupLabel: 'Wheelchair family', needs: { partySize: 6, wheelchairUsers: 1 }, idempotencyKey: 'e2e-key-bad' }, f.deps)
  assert.equal(bad.status, 409)
  assert.equal((bad.body as { code: string }).code, 'requirements_unmet')
  const made = await H.reserve(resp, { shelterId: f.a.id, groupLabel: 'Wheelchair family', needs: { partySize: 6, wheelchairUsers: 1 }, idempotencyKey: 'e2e-key-ok-1' }, f.deps)
  assert.equal(made.status, 201)
  const id = (made.body as { reservation: { id: string } }).reservation.id
  assert.equal((await H.reserve(resp, { shelterId: f.a.id, groupLabel: 'Wheelchair family', needs: { partySize: 6 }, idempotencyKey: 'e2e-key-ok-2' }, f.deps)).status, 409)
  assert.equal((await H.reservationAction(resp, id, { action: 'depart' }, f.deps)).status, 409)
  assert.equal((await H.reservationAction(resp, id, { action: 'confirm_arrival', arrivedCount: 6 }, f.deps)).status, 200)
  assert.equal((await H.reservationAction(resp, id, { action: 'depart' }, f.deps)).status, 200)
})
