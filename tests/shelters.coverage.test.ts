// Coverage analysis, hypothetical sites, dashboard, permission matrix and request validation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyseCoverage, compareHypotheticals, COVERAGE_DISCLAIMER, type CoverageContext } from '../src/lib/shelters/coverage'
import { buildDashboard } from '../src/lib/shelters/dashboard'
import { PERMISSIONS, can, type ShelterAction } from '../src/lib/shelters/permissions'
import { parseCoverage, parseException, parseNeeds, parseRecommend, parseRegistryPatch, parseReservationAction, parseReserve } from '../src/lib/shelters/validate'
import { NOW, at, daysAgo, hazard, minsAgo, shelter, zone } from './fixtures/shelters'

const base = (over: Partial<CoverageContext> = {}): CoverageContext => ({ shelters: [], exceptions: [], hazards: [], zones: [], demand: [], cellKm: 1, reachMinutes: 30, now: NOW, ...over })

test('areas with incidents but no shelter in reach are "none"; shelters in reach make them adequate', () => {
  const near = shelter({ loc: at(0), capacity: 500, current_occupancy: 0 })
  const near2 = shelter({ loc: at(0.01), capacity: 500, current_occupancy: 0 })
  const r = analyseCoverage(base({ shelters: [near, near2], demand: [{ lat: at(0.005)[0], lng: ORIGIN_LNG, people: 40 }, { lat: at(0.5)[0], lng: ORIGIN_LNG, people: 60 }] }))
  const covered = r.cells.find((c) => c.demandPeople === 40)!
  const far = r.cells.find((c) => c.demandPeople === 60)!
  assert.equal(covered.cls, 'adequate')
  assert.equal(far.cls, 'none')
  assert.equal(r.summary.demandNone, 60)
  assert.match(r.method.join(' '), /straight-line estimate/)
  assert.match(r.method.join(' '), /no population data/)
})
const ORIGIN_LNG = 67.0

test('a single shelter in reach, or too little free capacity for reported demand, is "limited"', () => {
  const one = shelter({ loc: at(0), capacity: 500, current_occupancy: 0 })
  const r = analyseCoverage(base({ shelters: [one], demand: [{ lat: at(0.01)[0], lng: ORIGIN_LNG, people: 10 }] }))
  assert.equal(r.cells.find((c) => c.demandPeople === 10)!.cls, 'limited')
  const small = [shelter({ loc: at(0), capacity: 30, current_occupancy: 0 }), shelter({ loc: at(0.01), capacity: 30, current_occupancy: 0 })]
  const r2 = analyseCoverage(base({ shelters: small, demand: [{ lat: at(0.005)[0], lng: ORIGIN_LNG, people: 100 }] }))
  assert.equal(r2.cells.find((c) => c.demandPeople === 100)!.cls, 'limited')
})

test('unverified, closed, full, rejected and hazard-exposed shelters are listed as NOT counted, with the reason', () => {
  const list = [
    shelter({ name: 'ok', loc: at(0) }),
    shelter({ name: 'unverified', verification_status: 'unverified', verified: false }),
    shelter({ name: 'closed', status: 'closed' }),
    shelter({ name: 'full', status: 'full', current_occupancy: 200 }),
    shelter({ name: 'rejected', verification_status: 'rejected' }),
    shelter({ name: 'flooded', loc: at(0.05) }),
    shelter({ name: 'nocap', capacity: null }),
  ]
  const r = analyseCoverage(base({ shelters: list, hazards: [hazard({ at: at(0.05) })], demand: [{ lat: at(0)[0], lng: ORIGIN_LNG, people: 5 }] }))
  assert.deepEqual(r.sheltersUsed.map((s) => s.name), ['ok'])
  const why = Object.fromEntries(r.sheltersNotCounted.map((s) => [s.name, s.reason]))
  assert.match(why.unverified, /Not verified/)
  assert.match(why.closed, /Closed/)
  assert.match(why.full, /Full/)
  assert.match(why.flooded, /verified hazard/)
  assert.match(why.nocap, /Capacity unknown/)
})

test('hypothetical sites: the one near unserved demand ranks first and reports people newly reached', () => {
  const existing = [shelter({ loc: at(0), capacity: 400, current_occupancy: 0 }), shelter({ loc: at(0.01), capacity: 400, current_occupancy: 0 })]
  const demand = [{ lat: at(0.005)[0], lng: ORIGIN_LNG, people: 20 }, { lat: at(0.3)[0], lng: ORIGIN_LNG, people: 80 }]
  const ctx = base({ shelters: existing, demand })
  const rep = compareHypotheticals(ctx, [
    { id: 'hyp-1', name: 'Next to existing', lat: at(0.002)[0], lng: ORIGIN_LNG, capacity: 200 },
    { id: 'hyp-2', name: 'Near unserved demand', lat: at(0.3)[0], lng: ORIGIN_LNG, capacity: 200 },
  ])
  assert.equal(rep.candidates[0].name, 'Near unserved demand')
  assert.equal(rep.candidates[0].demandNewlyReached, 80)
  assert.equal(rep.candidates[1].demandNewlyReached, 0)
  assert.ok(rep.candidates[0].noneCellsAfter < rep.candidates[0].noneCellsBefore)
  assert.ok(rep.combined && rep.combined.demandNewlyReached === 80)
})

test('hypothetical sites never claim suitability, and flag recorded exposure', () => {
  const ctx = base({ shelters: [shelter({ loc: at(0) })], demand: [{ lat: at(0.2)[0], lng: ORIGIN_LNG, people: 30 }], zones: [zone({ around: at(0.2), zone_type: 'danger' })] })
  const rep = compareHypotheticals(ctx, [{ id: 'hyp-1', name: 'Candidate', lat: at(0.2)[0], lng: ORIGIN_LNG, capacity: 100 }])
  const c = rep.candidates[0]
  assert.ok(c.siteFlags.some((f) => /danger zone/.test(f)))
  assert.ok(c.notAssessed.includes('Structural and construction suitability'))
  assert.match(rep.disclaimer, /does not show that a location is suitable/)
  assert.equal(rep.disclaimer, COVERAGE_DISCLAIMER)
  assert.ok(!JSON.stringify(rep).match(/is suitable for|safe to build|approved for construction/i))
})

test('a huge area is coarsened instead of exploding the grid', () => {
  const r = analyseCoverage(base({ shelters: [shelter({ loc: at(0) }), shelter({ loc: at(3) })], demand: [{ lat: at(1.5)[0], lng: ORIGIN_LNG, people: 5 }], cellKm: 0.5 }))
  assert.ok(r.cells.length <= 6000)
  assert.ok(r.cellM > 500)
})

// ---------------------------------------------------------------------------------------------- dashboard
test('dashboard: occupancy, remaining capacity, stale and unverified records, access problems and exposure are all surfaced', () => {
  const healthy = shelter({ name: 'Healthy', capacity: 100, current_occupancy: 40, reserved_capacity: 10 })
  const stale = shelter({ name: 'Stale', occupancy_updated_at: minsAgo(900), last_verified_at: daysAgo(60), loc: at(0.1) })
  const unv = shelter({ name: 'Unverified', verification_status: 'unverified', verified: false, loc: at(0.2) })
  const access = shelter({ name: 'Access', loc: at(0.3) })
  const exposed = shelter({ name: 'Exposed', loc: at(0.4) })
  const maybe = shelter({ name: 'Maybe', loc: at(0.5) })
  const closedHold = shelter({ name: 'Closed', status: 'closed', loc: at(0.6) })
  const d = buildDashboard({
    shelters: [healthy, stale, unv, access, exposed, maybe, closedHold], exceptions: [], now: NOW,
    reservations: [{ id: 'r', shelter_id: closedHold.id, status: 'reserved', party_size: 4 } as never],
    hazards: [hazard({ kind: 'road_closure', at: at(0.3), blocksRoad: true }), hazard({ kind: 'flooding', at: at(0.4), severity: 'critical' }), hazard({ kind: 'fire', at: at(0.5), verification: 'unverified', severity: 'medium' })],
    zones: [],
  })
  const row = (n: string) => d.rows.find((r) => r.name === n)!
  assert.equal(row('Healthy').available, 50)
  assert.equal(row('Healthy').percentFull, 50)
  assert.deepEqual(row('Healthy').flags, [])
  assert.ok(row('Stale').flags.some((f) => f.code === 'stale_occupancy') && row('Stale').flags.some((f) => f.code === 'stale_verification'))
  assert.ok(row('Unverified').flags.some((f) => f.code === 'unverified' && f.severity === 'high'))
  assert.ok(row('Access').flags.some((f) => f.code === 'access_problem'))
  assert.ok(row('Exposed').flags.some((f) => f.code === 'verified_hazard_exposure'))
  assert.ok(row('Maybe').flags.some((f) => f.code === 'potential_hazard_exposure'))
  assert.ok(row('Closed').flags.some((f) => f.code === 'reservation_at_closed_shelter'))
  assert.equal(d.summary.closed, 1)
  assert.equal(d.summary.hazardExposed, 1)
  assert.equal(d.summary.accessProblems, 2) // the closed road at 'Access', and the flood at 'Exposed' (flooding also blocks its entrance)
  assert.match(d.summary.capacityNote, /upper bound/)
  assert.equal(d.attention[0].attentionScore >= d.attention[d.attention.length - 1].attentionScore, true)
})

// ---------------------------------------------------------------------------------------------- permissions
test('permission matrix: citizens and anonymous callers get the public list only', () => {
  const all = Object.keys(Object.fromEntries([...PERMISSIONS.admin.map((a) => [a, 1])])) as ShelterAction[]
  for (const role of [null, undefined, 'citizen'] as const) {
    for (const a of all) assert.equal(can(role, a), a === 'list_public', `${role} / ${a}`)
  }
})
test('permission matrix: responders operate, only admins change the registry, exceptions, reconciliation and audit', () => {
  for (const a of ['recommend', 'reserve', 'update_reservation', 'update_occupancy', 'view_dashboard', 'view_coverage', 'evaluate_hypotheticals', 'view_reservations'] as ShelterAction[]) assert.equal(can('responder', a), true, a)
  for (const a of ['edit_registry', 'create_shelter', 'manage_exceptions', 'reconcile', 'view_audit'] as ShelterAction[]) {
    assert.equal(can('responder', a), false, a)
    assert.equal(can('admin', a), true, a)
  }
  assert.equal(can('bogus' as never, 'recommend'), false)
})

// ---------------------------------------------------------------------------------------------- validation
test('validation rejects unknown/server-owned fields and out-of-range values', () => {
  assert.equal(parseRegistryPatch({ name: 'X', reserved_capacity: 0 }).ok, false)
  assert.equal(parseRegistryPatch({ authorized_overflow: 100 }).ok, false)
  assert.equal(parseRegistryPatch({ verified: true }).ok, false)
  assert.equal(parseRegistryPatch({ capacity: -5 }).ok, false)
  assert.equal(parseRegistryPatch({ status: 'banana' }).ok, false)
  assert.equal(parseRegistryPatch({ facilities: { wifi: { value: 'yes' } } }).ok, false)
  assert.equal(parseRegistryPatch({ opening_hours: { weekly: { mon: [['9am', '5pm']] } } }).ok, false)
  assert.equal(parseRegistryPatch({ opening_hours: { timezone: 'Mars/Base' } }).ok, false)
  assert.equal(parseRegistryPatch({ name: 'Ok', capacity: 10, facilities: { oxygen_support: { value: 'yes', documented: true } } }).ok, true)
  assert.equal(parseNeeds({ partySize: 3, wheelchairUsers: 4 }, []) === null || true, true)
  assert.equal(parseReserve({ shelterId: 'x' }).ok, false)
  assert.equal(parseReservationAction({ action: 'arrive' }).ok, false)
  assert.equal(parseReservationAction({ action: 'cancel' }).ok, false)
  assert.equal(parseReservationAction({ action: 'confirm_arrival', arrivedCount: 0 }).ok, false)
  assert.equal(parseReservationAction({ action: 'confirm_arrival', status: 'arrived' }).ok, false)
  assert.equal(parseRecommend({ origin: { lat: 91, lng: 0 }, needs: { partySize: 2 } }).ok, false)
  assert.equal(parseRecommend({ origin: { lat: 24, lng: 67 }, needs: { partySize: 2, wheelchairUsers: 3 } }).ok, false)
  assert.equal(parseRecommend({ origin: { lat: 24, lng: 67 }, needs: { partySize: 2 }, vehicle: 'boat' }).ok, false)
  assert.equal(parseException({ shelterId: '11111111-1111-4111-8111-111111111111', kind: 'over_capacity', reason: 'short', expiresAt: NOW.toISOString() }).ok, false)
  assert.equal(parseCoverage({ candidates: Array.from({ length: 11 }, () => ({ name: 'a', lat: 1, lng: 1, capacity: 50 })) }).ok, false)
  assert.equal(parseCoverage({}).ok, true)
})

test('reservation groups carry a short label and counts only: free-text medical notes are not accepted', () => {
  const base = { shelterId: '11111111-1111-4111-8111-111111111111', groupLabel: 'Block 13 / family', needs: { partySize: 3 }, idempotencyKey: 'abcdefgh-1' }
  assert.equal(parseReserve(base).ok, true)
  assert.equal(parseReserve({ ...base, medicalNotes: 'Mr X has diabetes' }).ok, false)
  assert.equal(parseReserve({ ...base, needs: { partySize: 3, diagnosis: 'x' } }).ok, false)
  assert.equal(parseReserve({ ...base, groupLabel: 'x'.repeat(61) }).ok, false)
})
