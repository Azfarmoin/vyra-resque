// Recommendation engine: rankings, route failures, hazard exposure, accessibility constraints, full/closed shelters, data quality.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recommendShelters, type EngineContext, type RouteAssessment, type RouteAssessor } from '../src/lib/shelters/engine'
import type { ShelterException } from '../src/lib/shelters/types'
import { NOW, ORIGIN, at, daysAgo, documented, hazard, hoursAhead, minsAgo, shelter, zone } from './fixtures/shelters'

const ok = (mins: number, status: 'no_hazards_found' | 'hazard_reported' | 'known_blockage' | 'limited_information' = 'no_hazards_found'): RouteAssessment =>
  ({ state: 'ok', distanceM: mins * 600, durationS: mins * 60, status, closures: status === 'known_blockage' ? 1 : 0, activeFindings: status === 'hazard_reported' ? 2 : 0, notes: [], provider: 'osrm' })
// A fake road engine: minutes = straight line / 600 m per minute, unless overridden per destination latitude.
const roadBy = (over: Record<string, RouteAssessment> = {}): RouteAssessor => async (_o, d) => over[d[0].toFixed(4)] ?? ok(Math.round((Math.abs(d[0] - ORIGIN[0]) * 111_000) / 600) + 5)
const ctx = (shelters: ReturnType<typeof shelter>[], extra: Partial<EngineContext> = {}): EngineContext => ({ shelters, exceptions: [], hazards: [], zones: [], routeAssess: roadBy(), ...extra })
const run = (c: EngineContext, needs = { partySize: 10 }, extra: object = {}) => recommendShelters({ origin: ORIGIN, needs, now: NOW, ...extra }, c)
const exception = (shelterId: string, over: Partial<ShelterException> = {}): ShelterException => ({
  id: 'ex-' + shelterId.slice(-4), shelter_id: shelterId, kind: 'over_capacity', extra_capacity: 30, reason: 'Authorized overflow into the gymnasium', authorized_by: 'admin-1', authorized_by_name: 'Amina', expires_at: hoursAhead(6), revoked_at: null, created_at: minsAgo(10), ...over,
})

test('ranking uses overall fit, not distance: a farther verified shelter outranks a closer unverified one', async () => {
  const near = shelter({ name: 'Near but unverified', loc: at(0.01), verification_status: 'unverified', verified: false, last_verified_at: null, occupancy_basis: 'estimated' })
  const far = shelter({ name: 'Far and verified', loc: at(0.08) })
  const r = await run(ctx([near, far]))
  assert.equal(r.recommended[0].name, 'Far and verified')
  assert.equal(r.recommended[0].tier, 'recommended')
  const nearA = r.recommended.find((a) => a.name === 'Near but unverified')!
  assert.equal(nearA.tier, 'review_required')
  assert.match(r.closest!.outcome, /closer does not mean better/i)
  assert.ok(nearA.reasons.some((x) => x.code === 'unverified'))
})

test('the closest shelter is excluded when a verified high-severity flood is at its site', async () => {
  const closest = shelter({ name: 'Closest, flooded', loc: at(0.01) })
  const other = shelter({ name: 'Dry', loc: at(0.06) })
  const r = await run(ctx([closest, other], { hazards: [hazard({ at: at(0.01), kind: 'flooding', severity: 'critical' })] }))
  assert.equal(r.recommended[0].name, 'Dry')
  const ex = r.excluded.find((a) => a.name === 'Closest, flooded')!
  assert.ok(ex.reasons.some((x) => x.code === 'verified_hazard_exposure' && x.severity === 'block'))
  assert.match(r.closest!.outcome, /^Excluded/)
})

test('unverified or low-severity nearby hazards FLAG a shelter for review instead of silently passing it', async () => {
  const s = shelter({ name: 'Near an unverified flood report', loc: at(0.04) })
  const r = await run(ctx([s], { hazards: [hazard({ at: at(0.0425), verification: 'unverified', severity: 'medium' })] }))
  const a = r.recommended[0]
  assert.equal(a.tier, 'review_required')
  assert.ok(a.reasons.some((x) => x.code === 'potential_hazard_exposure' && /UNVERIFIED/.test(x.message)))
  assert.equal(r.humanReview.required, true)
})

test('verified danger zone excludes; unverified zone flags; AI-suggested zone is information only', async () => {
  const inDanger = shelter({ name: 'In danger zone', loc: at(0.02) })
  const inUnverified = shelter({ name: 'In unverified zone', loc: at(0.05) })
  const inAi = shelter({ name: 'In AI zone', loc: at(0.07) })
  const r = await run(ctx([inDanger, inUnverified, inAi], { zones: [
    zone({ around: at(0.02), zone_type: 'danger', verification_status: 'official' }),
    zone({ around: at(0.05), zone_type: 'elevated', verification_status: 'unverified', source_type: 'citizen_report' }),
    zone({ around: at(0.07), zone_type: 'danger', verification_status: 'ai_suggested', source_type: 'ai_suggestion' }),
  ] }))
  assert.equal(r.excluded.map((a) => a.name).join(), 'In danger zone')
  assert.equal(r.recommended.find((a) => a.name === 'In unverified zone')!.tier, 'review_required')
  const ai = r.recommended.find((a) => a.name === 'In AI zone')!
  assert.equal(ai.tier, 'recommended')
  assert.ok(ai.reasons.some((x) => x.code === 'ai_suggested_zone' && x.severity === 'info'))
})

test('expired, cancelled and deactivated zones are ignored', async () => {
  const s = shelter({ loc: at(0.02) })
  const r = await run(ctx([s], { zones: [zone({ around: at(0.02), valid_until: minsAgo(5) }), zone({ around: at(0.02), lifecycle: 'cancelled' })] }))
  assert.equal(r.recommended[0].tier, 'recommended')
})

test('flood scenario: flags exposed shelters, and excludes them when the planner asks', async () => {
  const s = shelter({ loc: at(0.03) })
  const poly = zone({ around: at(0.03) }).geometry
  const flagged = await run(ctx([s]), { partySize: 10 }, { floodScenario: { name: '1-in-50 scenario', polygons: [poly] } })
  assert.equal(flagged.recommended[0].tier, 'review_required')
  assert.ok(flagged.recommended[0].reasons.some((x) => x.code === 'scenario_exposure' && /projection, not an observation/.test(x.message)))
  const excluded = await run(ctx([s]), { partySize: 10 }, { floodScenario: { name: 'S', polygons: [poly], excludeExposed: true } })
  assert.equal(excluded.recommended.length, 0)
  assert.equal(excluded.humanReview.required, true)
})

test('full and closed shelters are never recommended; a stored "full" status beats favourable numbers', async () => {
  const full = shelter({ name: 'Full', status: 'full', current_occupancy: 200 })
  const fullFlag = shelter({ name: 'Marked full, numbers say room', status: 'full', current_occupancy: 40 })
  const closed = shelter({ name: 'Closed', status: 'closed' })
  const open = shelter({ name: 'Open', loc: at(0.09) })
  const r = await run(ctx([full, fullFlag, closed, open]))
  assert.deepEqual(r.recommended.map((a) => a.name), ['Open'])
  assert.equal(r.excluded.length, 3)
  assert.ok(r.excluded.find((a) => a.name === 'Marked full, numbers say room')!.reasons.some((x) => x.code === 'full'))
  assert.ok(r.excluded.find((a) => a.name === 'Closed')!.reasons.some((x) => x.code === 'closed'))
})

test('an authorized exception admits a full or closed shelter, labelled, and only for review', async () => {
  const full = shelter({ name: 'Full with exception', status: 'full', current_occupancy: 200 })
  const closed = shelter({ name: 'Closed with exception', status: 'closed' })
  const r = await run(ctx([full, closed], { exceptions: [exception(full.id), exception(closed.id, { kind: 'closed_use', extra_capacity: 0 })] }))
  assert.equal(r.recommended.length, 2)
  for (const a of r.recommended) {
    assert.equal(a.tier, 'review_required')
    assert.ok(a.exceptionApplied)
    assert.ok(a.reasons.some((x) => x.code === 'authorized_exception' && /authorized by Amina/.test(x.message)))
  }
  assert.equal(r.humanReview.required, true)
})

test('expired or revoked exceptions do not count', async () => {
  const full = shelter({ status: 'full', current_occupancy: 200 })
  const closed = shelter({ status: 'closed' })
  const r = await run(ctx([full, closed], { exceptions: [exception(full.id, { expires_at: minsAgo(1) }), exception(closed.id, { kind: 'closed_use', revoked_at: minsAgo(2) })] }))
  assert.equal(r.recommended.length, 0)
  assert.equal(r.excluded.length, 2)
})

test('insufficient capacity excludes; capacity held by reservations counts against it', async () => {
  const small = shelter({ name: 'Small', capacity: 60, current_occupancy: 30, reserved_capacity: 25 })
  const r = await run(ctx([small]), { partySize: 10 })
  assert.equal(r.recommended.length, 0)
  assert.match(r.excluded[0].reasons.find((x) => x.code === 'insufficient_capacity')!.message, /Only 5 places are free/)
})

test('stale or estimated occupancy is labelled and only 75% of free places are relied on', async () => {
  const stale = shelter({ name: 'Stale count', capacity: 100, current_occupancy: 80, occupancy_updated_at: minsAgo(600) })
  const r = await run(ctx([stale]), { partySize: 18 })
  const a = r.recommended[0]
  assert.equal(a.tier, 'review_required')
  assert.equal(a.availability.available, 20)
  assert.equal(a.availability.usable, 15)
  assert.ok(a.reasons.some((x) => x.code === 'capacity_uncertain'))
  assert.ok(a.reasons.some((x) => x.code === 'occupancy_stale' && /STALE/.test(x.message)))
  const est = await run(ctx([shelter({ occupancy_basis: 'estimated' })]))
  assert.ok(est.recommended[0].reasons.some((x) => x.code === 'occupancy_estimated' && /ESTIMATED/.test(x.message)))
  assert.equal(est.recommended[0].tier, 'review_required')
})

test('unknown capacity, rejected records and missing coordinates are excluded', async () => {
  const r = await run(ctx([
    shelter({ name: 'No capacity', capacity: null }),
    shelter({ name: 'Rejected', verification_status: 'rejected', verified: false }),
    shelter({ name: 'No pin', location_lat: null, location_lng: null }),
  ]))
  assert.equal(r.recommended.length, 0)
  assert.deepEqual(r.excluded.map((a) => a.name).sort(), ['No capacity', 'No pin', 'Rejected'])
})

// ---------------------------------------------------------------------------------------------- accessibility
test('wheelchair users: only FULL access on a VERIFIED record qualifies; partial, none, unknown and unverified each fail with a specific reason', async () => {
  const full = shelter({ name: 'Full access', wheelchair_access: 'full', loc: at(0.05) })
  const partial = shelter({ name: 'Partial', wheelchair_access: 'partial' })
  const none = shelter({ name: 'None', wheelchair_access: 'none' })
  const unknown = shelter({ name: 'Unknown' })
  const fullUnverified = shelter({ name: 'Full but unverified', wheelchair_access: 'full', verification_status: 'unverified', verified: false })
  const r = await run(ctx([full, partial, none, unknown, fullUnverified]), { partySize: 10, wheelchairUsers: 2 } as never)
  assert.deepEqual(r.recommended.map((a) => a.name), ['Full access'])
  const why = (n: string) => r.excluded.find((a) => a.name === n)!.reasons.find((x) => x.code === 'unmet_wheelchair')!.message
  assert.match(why('Partial'), /PARTIAL/)
  assert.match(why('None'), /no wheelchair access/)
  assert.match(why('Unknown'), /not documented/)
  assert.match(why('Full but unverified'), /not verified/)
})

test('oxygen needs require oxygen support AND a documented power source', async () => {
  const both = shelter({ name: 'O2 + backup', facilities: { oxygen_support: documented(), backup_power: documented() } })
  const noPower = shelter({ name: 'O2 only', facilities: { oxygen_support: documented() } })
  const undocumented = shelter({ name: 'O2 claimed only', facilities: { oxygen_support: { value: 'yes', documented_at: null }, backup_power: documented() } })
  const r = await run(ctx([both, noPower, undocumented]), { partySize: 4, oxygenUsers: 1 } as never)
  assert.deepEqual(r.recommended.map((a) => a.name), ['O2 + backup'])
  assert.match(r.excluded.find((a) => a.name === 'O2 claimed only')!.reasons.find((x) => x.code === 'unmet_oxygen')!.message, /listed but not documented/)
})

test('legacy "services" entries are claims, not documentation: they never satisfy a required capability', async () => {
  const legacy = shelter({ name: 'Legacy medical', services: ['medical', 'food'], facilities: {} })
  const r = await run(ctx([legacy]), { partySize: 5, essentialMedication: 2 } as never)
  assert.equal(r.recommended.length, 0)
  assert.match(r.excluded[0].requirements.find((x) => x.id === 'medication')!.detail, /listed but not documented/)
})

test('infants, elderly, pregnancy, mobility assistance and keeping families together each have documented requirements', async () => {
  const everything = shelter({ name: 'Everything', loc: at(0.05), facilities: { family_accommodation: documented(), drinking_water: documented(), sanitation: documented(), step_free_entry: documented(), maternal_support: documented(), mobility_assistance: documented() } })
  const missing = shelter({ name: 'Missing', facilities: { drinking_water: documented(), sanitation: documented() } })
  const needs = { partySize: 12, infants: 2, elderly: 3, pregnant: 1, mobilityAssistance: 2, keepFamilyTogether: true }
  const r = await run(ctx([everything, missing]), needs as never)
  assert.deepEqual(r.recommended.map((a) => a.name), ['Everything'])
  const reasons = r.excluded[0].reasons.filter((x) => x.code.startsWith('unmet_')).map((x) => x.code).sort()
  assert.deepEqual(reasons, ['unmet_elderly', 'unmet_family', 'unmet_infants', 'unmet_mobility', 'unmet_pregnancy'])
})

test('when no shelter qualifies the engine explains the unmet requirements and asks for human review', async () => {
  const r = await run(ctx([shelter({ name: 'A' }), shelter({ name: 'B', wheelchair_access: 'partial' }), shelter({ name: 'Full', status: 'full', current_occupancy: 200 })]), { partySize: 8, wheelchairUsers: 1 } as never)
  assert.equal(r.recommended.length, 0)
  assert.equal(r.humanReview.required, true)
  assert.match(r.humanReview.reasons[0], /person must decide/)
  const req = r.humanReview.unmetRequirements.find((u) => /Wheelchair/.test(u.requirement))!
  assert.ok(req.failedAt >= 2)
  assert.ok(req.examples.length > 0)
})

// ---------------------------------------------------------------------------------------------- routing
test('route to the shelter crosses a known closure -> excluded; no road route -> excluded', async () => {
  const blocked = shelter({ name: 'Blocked route', loc: at(0.02) })
  const unreachable = shelter({ name: 'No road', loc: at(0.03) })
  const fine = shelter({ name: 'Fine', loc: at(0.05) })
  const assess = roadBy({ [blocked.location_lat!.toFixed(4)]: ok(10, 'known_blockage'), [unreachable.location_lat!.toFixed(4)]: { state: 'no_route' } })
  const r = await run(ctx([blocked, unreachable, fine], { routeAssess: assess }))
  assert.deepEqual(r.recommended.map((a) => a.name), ['Fine'])
  assert.ok(r.excluded.find((a) => a.name === 'Blocked route')!.reasons.some((x) => x.code === 'route_blocked'))
  assert.ok(r.excluded.find((a) => a.name === 'No road')!.reasons.some((x) => x.code === 'route_no_road'))
})

test('routing engine failure never blocks the answer: straight-line estimate, clearly labelled, review required', async () => {
  const s = shelter({ loc: at(0.03) })
  const r = await run(ctx([s], { routeAssess: async () => { throw new Error('connect ECONNREFUSED') } }))
  const a = r.recommended[0]
  assert.equal(a.tier, 'review_required')
  assert.equal(a.travel.basis, 'estimate')
  assert.match(a.travel.note, /Straight-line estimate/)
  assert.ok(a.reasons.some((x) => x.code === 'route_unavailable' && /ESTIMATE/.test(x.message)))
  assert.ok(r.notices.some((n) => /ESTIMATES/.test(n)))
  const unavailable = await run(ctx([s], { routeAssess: async () => ({ state: 'unavailable', reason: 'timed out' }) }))
  assert.equal(unavailable.recommended[0].travel.basis, 'estimate')
})

test('no routing provider configured: estimates and a notice, never a made-up road time', async () => {
  const r = await run(ctx([shelter()], { routeAssess: null }))
  assert.equal(r.recommended[0].travel.basis, 'estimate')
  assert.equal(r.recommended[0].tier, 'review_required')
  assert.ok(r.notices.some((n) => /No routing provider/.test(n)))
})

test('hazards reported along the route lower the route score and flag review; "no hazards found" is never called safe', async () => {
  const hz = shelter({ name: 'Hazard on route', loc: at(0.04) })
  const clear = shelter({ name: 'Clear in data', loc: at(0.04, 0.01) })
  const r = await run(ctx([hz, clear], { routeAssess: async (_o, d) => (d[1] === hz.location_lng ? ok(20, 'hazard_reported') : ok(20)) }))
  assert.equal(r.recommended[0].name, 'Clear in data')
  assert.equal(r.recommended[1].tier, 'review_required')
  const clearA = r.recommended[0]
  assert.ok(clearA.reasons.some((x) => x.code === 'route_clear_in_data' && /not a guarantee/.test(x.message)))
  assert.ok(!JSON.stringify(r).match(/\bis safe\b|guaranteed safe/i))
})

test('only the nearest eligible shelters are routed; the rest are estimated and flagged', async () => {
  const many = Array.from({ length: 6 }, (_, i) => shelter({ name: `S${i}`, loc: at(0.01 * (i + 1)) }))
  let calls = 0
  const r = await recommendShelters({ origin: ORIGIN, needs: { partySize: 5 }, now: NOW, maxRouted: 3 }, ctx(many, { routeAssess: async () => { calls++; return ok(15) } }))
  assert.equal(calls, 3)
  assert.equal(r.recommended.filter((a) => a.reasons.some((x) => x.code === 'route_not_checked')).length, 3)
  assert.ok(r.notices.some((n) => /nearest eligible shelters only/.test(n)))
})

// ---------------------------------------------------------------------------------------------- explainability & other
test('every assessment carries a score breakdown that sums to the score, and every exclusion has a reason', async () => {
  const r = await run(ctx([shelter({ name: 'A' }), shelter({ name: 'B', loc: at(0.07) }), shelter({ status: 'closed', name: 'C' })]))
  for (const a of r.recommended) {
    assert.equal(Math.round(a.scoreBreakdown.reduce((n, b) => n + b.points, 0)), a.score)
    assert.ok(a.scoreBreakdown.every((b) => b.points >= 0 && b.points <= b.max))
    assert.ok(a.score! <= 100)
  }
  for (const a of r.excluded) assert.ok(a.reasons.some((x) => x.severity === 'block') && a.summary.startsWith('Excluded:'))
})

test('stale verification and outside-hours are flagged; dependency risk is flagged without a documented backup', async () => {
  const stale = shelter({ name: 'Stale verification', last_verified_at: daysAgo(90) })
  const hours = shelter({ name: 'Closed hours', opening_hours: { weekly: { sun: [['00:00', '01:00']], mon: [['00:00', '01:00']], tue: [['00:00', '01:00']], wed: [['00:00', '01:00']], thu: [['00:00', '01:00']], fri: [['00:00', '01:00']], sat: [['00:00', '01:00']] } } })
  const dep = shelter({ name: 'Grid dependent', infrastructure_dependencies: ['grid_power'] })
  const withBackup = shelter({ name: 'Grid with backup', infrastructure_dependencies: ['grid_power'], facilities: { backup_power: documented(), drinking_water: documented(), sanitation: documented() } })
  const r = await run(ctx([stale, hours, dep, withBackup], { hazards: [hazard({ kind: 'electrical', description: 'Substation fire', at: at(0.04), verification: 'confirmed', severity: 'high' })] }))
  const byName = (n: string) => r.recommended.find((a) => a.name === n)!
  assert.ok(byName('Stale verification').reasons.some((x) => x.code === 'verification_stale'))
  assert.ok(byName('Closed hours').reasons.some((x) => x.code === 'outside_hours'))
  assert.ok(byName('Grid dependent').reasons.some((x) => x.code === 'dependency_at_risk'))
  assert.ok(!byName('Grid with backup').reasons.some((x) => x.code === 'dependency_at_risk'))
})

test('access problems near the entrance are flagged (confirmed closures and unverified reports are worded differently)', async () => {
  const s = shelter({ loc: at(0.04) })
  const r = await run(ctx([s], { hazards: [hazard({ kind: 'road_closure', description: 'Bridge closed', at: at(0.0415), severity: 'high', blocksRoad: true }), hazard({ kind: 'debris', description: 'Debris', at: at(0.0405), verification: 'unverified', severity: 'low' })] }))
  const msgs = r.recommended[0].reasons.filter((x) => x.code === 'access_problem').map((x) => x.message)
  assert.equal(msgs.length, 2)
  assert.ok(msgs.some((m) => /^Confirmed/.test(m)) && msgs.some((m) => /^UNVERIFIED/.test(m)))
})

test('resolved and expired hazards are ignored', async () => {
  const s = shelter({ loc: at(0.04) })
  const r = await run(ctx([s], { hazards: [hazard({ verification: 'resolved' }), hazard({ verification: 'expired' })] }))
  assert.equal(r.recommended[0].tier, 'recommended')
})

test('results are deterministic and the echoed needs hold counts only', async () => {
  const list = [shelter({ name: 'A', loc: at(0.03) }), shelter({ name: 'B', loc: at(0.03, 0.01) })]
  const a = await run(ctx(list), { partySize: 6, elderly: 1 } as never)
  const b = await run(ctx([...list].reverse()), { partySize: 6, elderly: 1 } as never)
  assert.deepEqual(a.recommended.map((x) => x.shelterId), b.recommended.map((x) => x.shelterId))
  assert.deepEqual(Object.keys(a.needs).sort(), ['elderly', 'partySize'])
})
