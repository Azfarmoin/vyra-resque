// Reservations: simultaneous bookings, double-booking, cancellations, arrivals/departures, expiry, reconciliation, exceptions, audit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemoryShelterService, emptyShelterTables, type ShelterTables } from '../src/lib/shelters/service'
import { ShelterError, type Actor } from '../src/lib/shelters/types'
import { NOW, documented, hoursAhead, shelter } from './fixtures/shelters'

const resp: Actor = { id: 'r1', name: 'Hamza', role: 'responder' }
const admin: Actor = { id: 'a1', name: 'Amina', role: 'admin' }
let clock = NOW.getTime()
const setup = (shelters: ReturnType<typeof shelter>[], opts: Parameters<typeof createMemoryShelterService>[1] = {}) => {
  clock = NOW.getTime()
  const tables: ShelterTables = emptyShelterTables(shelters.map((s) => ({ ...s })))
  const svc = createMemoryShelterService(tables, { now: () => new Date(clock), ...opts })
  return { tables, svc }
}
const advance = (min: number) => { clock += min * 60_000 }
let k = 0
const body = (shelterId: string, label: string, party: number, over: object = {}) => ({
  shelterId, groupLabel: label, incidentId: null, dispatchId: null, needs: { partySize: party }, expectedArrivalAt: null, holdMinutes: 60, idempotencyKey: `key-${++k}-${label}`, ...over,
})
const code = async (p: Promise<unknown>) => { try { await p; return 'no error' } catch (e) { return e instanceof ShelterError ? `${e.status}:${e.code}` : `other:${(e as Error).message}` } }

test('simultaneous reservations never over-allocate: 12 racing groups of 10 into 35 places -> exactly 3 succeed', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 65 })
  const { svc, tables } = setup([s])
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => code(svc.reserve(body(s.id, `group ${i}`, 10) as never, resp))))
  assert.equal(results.filter((r) => r === 'no error').length, 3)
  assert.equal(results.filter((r) => r === '409:insufficient_capacity').length, 9)
  assert.equal(tables.shelters[0].reserved_capacity, 30)
  assert.ok(tables.shelters[0].current_occupancy + tables.shelters[0].reserved_capacity <= tables.shelters[0].capacity)
})

test('simultaneous reservations of the SAME group at different shelters -> exactly one wins (no double-booking)', async () => {
  const a = shelter({ name: 'A' }), b = shelter({ name: 'B' }), c = shelter({ name: 'C' })
  const { svc, tables } = setup([a, b, c])
  const incident = '11111111-1111-4111-8111-111111111111'
  const results = await Promise.all([a, b, c, a, b].map((s) => code(svc.reserve(body(s.id, 'Block 13 family', 8, { incidentId: incident })as never, resp))))
  assert.equal(results.filter((r) => r === 'no error').length, 1)
  assert.equal(results.filter((r) => r === '409:double_booking').length, 4)
  assert.equal(tables.shelter_reservations.filter((r) => r.status === 'reserved').length, 1)
})

test('retrying with the same idempotency key returns the same reservation, even when sent simultaneously', async () => {
  const s = shelter()
  const { svc, tables } = setup([s])
  const req = body(s.id, 'Retry group', 6)
  const out = await Promise.all(Array.from({ length: 5 }, () => svc.reserve(req as never, resp)))
  assert.equal(new Set(out.map((o) => o.reservation.id)).size, 1)
  assert.equal(out.filter((o) => o.replayed).length, 4)
  assert.equal(tables.shelters[0].reserved_capacity, 6)
  assert.equal(await code(svc.reserve({ ...req, needs: { partySize: 7 } } as never, resp)), '422:idempotency_conflict')
})

test('a reservation holds capacity but is NOT an arrival: occupancy is unchanged until arrival is confirmed', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 40 })
  const { svc, tables } = setup([s])
  const { reservation } = await svc.reserve(body(s.id, 'Group A', 15) as never, resp)
  assert.equal(reservation.status, 'reserved')
  assert.equal(tables.shelters[0].current_occupancy, 40)
  assert.equal(tables.shelters[0].reserved_capacity, 15)
  assert.equal(reservation.confirmed_arrival_at, null)
  advance(30)
  assert.equal((await svc.listReservations())[0].status, 'reserved') // time passing alone never marks an arrival
  const arrived = await svc.confirmArrival(reservation.id, { arrivedCount: null }, resp)
  assert.equal(arrived.status, 'arrived')
  assert.equal(arrived.confirmed_by, 'r1')
  assert.equal(tables.shelters[0].current_occupancy, 55)
  assert.equal(tables.shelters[0].reserved_capacity, 0)
})

test('partial arrival releases the rest; more arrivals than reserved is refused; double confirmation is refused', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 0 })
  const { svc, tables } = setup([s])
  const r1 = (await svc.reserve(body(s.id, 'G1', 10) as never, resp)).reservation
  assert.equal(await code(svc.confirmArrival(r1.id, { arrivedCount: 11 }, resp)), '422:arrived_exceeds_reserved')
  await svc.confirmArrival(r1.id, { arrivedCount: 7 }, resp)
  assert.equal(tables.shelters[0].current_occupancy, 7)
  assert.equal(tables.shelters[0].reserved_capacity, 0)
  assert.equal(await code(svc.confirmArrival(r1.id, { arrivedCount: null }, resp)), '409:already_arrived')
})

test('holds expire without confirmation: capacity is released and a late arrival cannot be recorded', async () => {
  const s = shelter({ capacity: 50, current_occupancy: 0 })
  const { svc, tables } = setup([s])
  const r = (await svc.reserve(body(s.id, 'Late', 40, { holdMinutes: 30 }) as never, resp)).reservation
  assert.equal(await code(svc.reserve(body(s.id, 'Blocked', 20) as never, resp)), '409:insufficient_capacity')
  advance(31)
  assert.equal((await svc.reserve(body(s.id, 'After expiry', 20) as never, resp)).reservation.status, 'reserved')
  assert.equal(tables.shelter_reservations.find((x) => x.id === r.id)!.status, 'expired')
  assert.equal(await code(svc.confirmArrival(r.id, { arrivedCount: null }, resp)), '409:hold_expired')
  assert.equal(tables.shelters[0].current_occupancy, 0)
})

test('hold from an expected arrival time starts counting at that time; extending is capped at 24 h', async () => {
  const s = shelter()
  const { svc } = setup([s])
  const r = (await svc.reserve(body(s.id, 'Later', 5, { expectedArrivalAt: hoursAhead(2), holdMinutes: 30 }) as never, resp)).reservation
  assert.equal(Date.parse(r.hold_expires_at), NOW.getTime() + 2.5 * 3_600_000)
  await assert.rejects(svc.extendHold(r.id, 360, resp).then(() => svc.extendHold(r.id, 360, resp)).then(() => svc.extendHold(r.id, 360, resp)).then(() => svc.extendHold(r.id, 360, resp)).then(() => svc.extendHold(r.id, 360, resp)), (e: ShelterError) => e.code === 'hold_limit')
})

test('cancellation releases capacity; cancelling twice, or after arrival, is refused', async () => {
  const s = shelter({ capacity: 30, current_occupancy: 0 })
  const { svc, tables } = setup([s])
  const a = (await svc.reserve(body(s.id, 'A', 30) as never, resp)).reservation
  assert.equal(await code(svc.reserve(body(s.id, 'B', 1) as never, resp)), '409:insufficient_capacity')
  await svc.cancel(a.id, 'Family found other transport', resp)
  assert.equal(tables.shelters[0].reserved_capacity, 0)
  assert.equal((await svc.reserve(body(s.id, 'B', 30) as never, resp)).reservation.status, 'reserved')
  assert.equal(await code(svc.cancel(a.id, 'again', resp)), '409:already_cancelled')
  const b = tables.shelter_reservations.find((r) => r.group_label === 'B')!
  await svc.confirmArrival(b.id, { arrivedCount: null }, resp)
  assert.equal(await code(svc.cancel(b.id, 'too late', resp)), '409:invalid_state')
})

test('a cancelled group may be booked again, but an active group cannot be booked twice', async () => {
  const s = shelter()
  const { svc } = setup([s])
  const a = (await svc.reserve(body(s.id, 'Same group', 5) as never, resp)).reservation
  assert.equal(await code(svc.reserve(body(s.id, 'Same group', 5) as never, resp)), '409:double_booking')
  await svc.cancel(a.id, 'changed plan', resp)
  assert.equal(await code(svc.reserve(body(s.id, 'Same group', 5) as never, resp)), 'no error')
})

test('departure removes the group from occupancy; departure without confirmed arrival is refused', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 20 })
  const { svc, tables } = setup([s])
  const r = (await svc.reserve(body(s.id, 'D', 12) as never, resp)).reservation
  assert.equal(await code(svc.recordDeparture(r.id, resp)), '409:invalid_state')
  await svc.confirmArrival(r.id, { arrivedCount: null }, resp)
  assert.equal(tables.shelters[0].current_occupancy, 32)
  const d = await svc.recordDeparture(r.id, resp)
  assert.equal(d.status, 'departed')
  assert.ok(d.departed_at)
  assert.equal(tables.shelters[0].current_occupancy, 20)
  assert.equal(await code(svc.recordDeparture(r.id, resp)), '409:invalid_state')
})

test('system-set "full" reopens when people leave; a status a person set to full does not', async () => {
  const auto = shelter({ capacity: 10, current_occupancy: 0 })
  const manual = shelter({ capacity: 10, current_occupancy: 0 })
  const { svc, tables } = setup([auto, manual])
  const r = (await svc.reserve(body(auto.id, 'Fill', 10) as never, resp)).reservation
  await svc.confirmArrival(r.id, { arrivedCount: null }, resp)
  assert.equal(tables.shelters[0].status, 'full')
  await svc.recordDeparture(r.id, resp)
  assert.equal(tables.shelters[0].status, 'open')
  await svc.updateRegistry(manual.id, { status: 'full' }, admin)
  await svc.setOccupancy(manual.id, { count: 2, basis: 'counted' }, resp)
  assert.equal(tables.shelters[1].status, 'full')
})

test('closed and full shelters cannot be reserved without an authorized exception; exceptions are admin-only, time-limited and expire', async () => {
  const closed = shelter({ status: 'closed' }), full = shelter({ status: 'full', capacity: 20, current_occupancy: 20 })
  const { svc } = setup([closed, full])
  assert.equal(await code(svc.reserve(body(closed.id, 'C', 3) as never, resp)), '409:shelter_closed')
  assert.equal(await code(svc.reserve(body(full.id, 'F', 3) as never, resp)), '409:shelter_full')
  assert.equal(await code(svc.createException({ shelterId: closed.id, kind: 'closed_use', extraCapacity: 0, reason: 'Opened by district officer', expiresAt: hoursAhead(4) }, resp)), '403:forbidden')
  assert.equal(await code(svc.createException({ shelterId: closed.id, kind: 'closed_use', extraCapacity: 0, reason: 'Opened by district officer', expiresAt: hoursAhead(100) }, admin)), '422:invalid_expiry')
  assert.equal(await code(svc.createException({ shelterId: closed.id, kind: 'closed_use', extraCapacity: 0, reason: 'Opened by district officer', expiresAt: hoursAhead(-1) }, admin)), '422:invalid_expiry')
  await svc.createException({ shelterId: closed.id, kind: 'closed_use', extraCapacity: 0, reason: 'Opened by district officer', expiresAt: hoursAhead(4) }, admin)
  const ex = await svc.createException({ shelterId: full.id, kind: 'over_capacity', extraCapacity: 5, reason: 'Gym floor opened for overflow', expiresAt: hoursAhead(2) }, admin)
  assert.equal((await svc.reserve(body(closed.id, 'C', 3) as never, resp)).reservation.exception_id !== null, true)
  assert.equal(await code(svc.reserve(body(full.id, 'F', 6) as never, resp)), '409:insufficient_capacity') // only 5 extra were authorized
  assert.equal(await code(svc.reserve(body(full.id, 'F', 5) as never, resp)), 'no error')
  await svc.revokeException(ex.id, admin)
  assert.equal(await code(svc.reserve(body(full.id, 'F2', 1) as never, resp)), '409:shelter_full')
  advance(5 * 60)
  assert.equal(await code(svc.reserve(body(closed.id, 'C2', 1) as never, resp)), '409:shelter_closed') // the exception lapsed
})

test('required capabilities are re-checked at reservation time, whatever the client says it was told', async () => {
  const s = shelter({ wheelchair_access: 'partial' })
  const ok = shelter({ wheelchair_access: 'full', facilities: { family_accommodation: documented() } })
  const { svc } = setup([s, ok])
  const r = await svc.reserve(body(s.id, 'W', 4, { needs: { partySize: 4, wheelchairUsers: 1 } }) as never, resp).catch((e) => e as ShelterError)
  assert.equal((r as ShelterError).code, 'requirements_unmet')
  assert.match((r as ShelterError).message, /Request human review/)
  assert.equal(await code(svc.reserve(body(ok.id, 'W2', 4, { needs: { partySize: 4, wheelchairUsers: 1, keepFamilyTogether: true } }) as never, resp)), 'no error')
})

test('site hazards re-checked at reservation time block the booking', async () => {
  const s = shelter()
  const { svc } = setup([s], { siteBlockers: async () => [{ code: 'verified_hazard_exposure', severity: 'block', message: 'A confirmed critical flooding is recorded at the site.' }] })
  assert.equal(await code(svc.reserve(body(s.id, 'H', 3) as never, resp)), '409:site_hazard')
})

test('unknown incident or mission ids are rejected when verifiers are wired', async () => {
  const s = shelter()
  const { svc } = setup([s], { incidentExists: async () => false, dispatchExists: async () => false })
  assert.equal(await code(svc.reserve(body(s.id, 'I', 3, { incidentId: '11111111-1111-4111-8111-111111111111' }) as never, resp)), '404:incident_not_found')
  assert.equal(await code(svc.reserve(body(s.id, 'J', 3, { dispatchId: '11111111-1111-4111-8111-111111111111' }) as never, resp)), '404:dispatch_not_found')
})

test('closing a shelter cancels holds (reported back) and warns about people still inside', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 0 })
  const { svc, tables } = setup([s])
  const held = (await svc.reserve(body(s.id, 'Held', 10) as never, resp)).reservation
  const inside = (await svc.reserve(body(s.id, 'Inside', 10) as never, resp)).reservation
  await svc.confirmArrival(inside.id, { arrivedCount: null }, resp)
  const out = await svc.updateRegistry(s.id, { status: 'closed' }, admin)
  assert.deepEqual(out.cancelledReservations.map((r) => r.id), [held.id])
  assert.ok(out.warnings.some((w) => w.code === 'people_inside'))
  assert.equal(tables.shelters[0].reserved_capacity, 0)
  assert.equal(tables.shelter_reservations.find((r) => r.id === inside.id)!.status, 'arrived')
})

test('capacity cannot be lowered below people inside plus holds', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 60 })
  const { svc } = setup([s])
  await svc.reserve(body(s.id, 'X', 20) as never, resp)
  assert.equal(await code(svc.updateRegistry(s.id, { capacity: 70 }, admin)), '409:capacity_below_commitments')
  assert.equal(await code(svc.updateRegistry(s.id, { capacity: 80 }, admin)), 'no error')
})

test('capacity reconciliation repairs held-place drift and reports (without changing) occupancy problems', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 10 })
  const { svc, tables } = setup([s])
  const r = (await svc.reserve(body(s.id, 'R', 20) as never, resp)).reservation
  await svc.confirmArrival(r.id, { arrivedCount: null }, resp)
  await svc.reserve(body(s.id, 'S', 15) as never, resp)
  // Simulate corruption: held places drifted and someone overwrote occupancy to a lower number than the tracked arrivals.
  tables.shelters[0].reserved_capacity = 99
  tables.shelters[0].current_occupancy = 5
  const report = await svc.reconcile(s.id, admin)
  const byCheck = Object.fromEntries(report.map((i) => [i.check, i]))
  assert.equal(byCheck.reserved_capacity.fixed, true)
  assert.equal(byCheck.reserved_capacity.computed, 15)
  assert.equal(tables.shelters[0].reserved_capacity, 15)
  assert.equal(byCheck.occupancy_below_tracked.fixed, false)
  assert.equal(tables.shelters[0].current_occupancy, 5) // never rewritten: only a person can recount
  const clean = await svc.reconcile(s.id, admin)
  assert.ok(!clean.some((i) => i.check === 'reserved_capacity'))
})

test('reconciliation flags over-allocation and holds at closed shelters', async () => {
  const s = shelter({ capacity: 20, current_occupancy: 10 })
  const { svc, tables } = setup([s])
  await svc.reserve(body(s.id, 'Y', 10) as never, resp)
  await svc.setOccupancy(s.id, { count: 18, basis: 'counted' }, resp) // a real recount found more people inside
  const rep = await svc.reconcile(s.id, admin)
  assert.ok(rep.some((i) => i.check === 'over_allocated' && !i.fixed))
  tables.shelters[0].status = 'closed'
  assert.ok((await svc.reconcile(s.id, admin)).some((i) => i.check === 'reservation_at_closed_shelter'))
})

test('manual occupancy: freshness and basis are recorded; arrivals do not make an old headcount look fresh', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 10, occupancy_updated_at: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(), occupancy_basis: 'reported' })
  const { svc, tables } = setup([s])
  const r = (await svc.reserve(body(s.id, 'Z', 5) as never, resp)).reservation
  await svc.confirmArrival(r.id, { arrivedCount: null }, resp)
  assert.equal(tables.shelters[0].occupancy_basis, 'reported')
  assert.ok(Date.parse(tables.shelters[0].occupancy_updated_at) < NOW.getTime() - 4 * 3_600_000)
  const out = await svc.setOccupancy(s.id, { count: 30, basis: 'counted' }, resp)
  assert.equal(out.shelter.occupancy_basis, 'counted')
  assert.equal(out.shelter.occupancy_updated_at, new Date(clock).toISOString())
  const low = await svc.setOccupancy(s.id, { count: 2, basis: 'estimated' }, resp)
  assert.ok(low.warnings.length === 0 || low.warnings.every((w) => w.code))
})

test('registry: facilities count as documented only when the admin documents them; moving the pin clears location verification; new records start unverified', async () => {
  const s = shelter({ location_verified: true })
  const { svc } = setup([s])
  const a = await svc.updateRegistry(s.id, { facilities: { oxygen_support: { value: 'yes' }, medical_support: { value: 'yes', documented: true } } }, admin)
  assert.equal(a.shelter.facilities.oxygen_support!.documented_at, null)
  assert.ok(a.shelter.facilities.medical_support!.documented_at)
  const moved = await svc.updateRegistry(s.id, { location_lat: 24.5, location_lng: 67.5 }, admin)
  assert.equal(moved.shelter.location_verified, false)
  const created = await svc.createShelter({ name: 'New site', location_lat: 24.9, location_lng: 67.1, capacity: 50, verification_status: 'verified' }, admin)
  assert.equal(created.verification_status, 'verified') // an admin explicitly verified it, and that is audited
  const plain = await svc.createShelter({ name: 'Plain', location_lat: 24.9, location_lng: 67.1, capacity: 50 }, admin)
  assert.equal(plain.verification_status, 'unverified')
  assert.equal(plain.verified, false)
})

test('audit log records who did what, and keeps medical/needs detail out', async () => {
  const s = shelter()
  const { svc, tables } = setup([s])
  const r = (await svc.reserve(body(s.id, 'Audit', 6, { needs: { partySize: 6, oxygenUsers: 1, essentialMedication: 2 } }) as never, resp).catch(() => null))
  const ok = await svc.reserve(body(s.id, 'Audit2', 6) as never, resp)
  await svc.cancel(ok.reservation.id, 'plans changed', resp)
  const actions = tables.shelter_audit.map((a) => a.action)
  assert.ok(actions.includes('reservation_created') && actions.includes('reservation_cancelled'))
  assert.ok(tables.shelter_audit.every((a) => a.actor_id && a.created_at))
  assert.ok(!JSON.stringify(tables.shelter_audit).match(/oxygen|medication|wheelchair/i))
  void r
})

test('stress: 200 mixed concurrent operations keep occupied + held within capacity and reconcile clean', async () => {
  const s = shelter({ capacity: 120, current_occupancy: 20 })
  const { svc, tables } = setup([s])
  const ids: string[] = []
  await Promise.all(Array.from({ length: 80 }, async (_, i) => {
    const res = await svc.reserve(body(s.id, `stress-${i}`, 1 + (i % 7)) as never, resp).catch(() => null)
    if (res) ids.push(res.reservation.id)
  }))
  const row = tables.shelters[0]
  assert.ok(row.current_occupancy + row.reserved_capacity <= row.capacity)
  await Promise.all(ids.slice(0, 20).map((id) => svc.confirmArrival(id, { arrivedCount: null }, resp).catch(() => null)))
  await Promise.all(ids.slice(20, 40).map((id) => svc.cancel(id, 'cancel', resp).catch(() => null)))
  await Promise.all(ids.slice(0, 10).map((id) => svc.recordDeparture(id, resp).catch(() => null)))
  assert.ok(row.current_occupancy + row.reserved_capacity <= row.capacity)
  assert.deepEqual((await svc.reconcile(s.id, admin)).filter((i) => i.check === 'reserved_capacity' || i.check === 'over_allocated'), [])
})

// ---- Races that can actually interleave -------------------------------------------------------------------------------------------
// In production the booking path awaits (hazard re-check, database). These tests make it yield between "check capacity" and "write", so
// without the per-shelter / per-group locks they WOULD over-allocate. (Mutation-checked: removing the mutex makes them fail.)
const tick = () => new Promise<void>((r) => setTimeout(r, 1))
const yielding = { siteBlockers: async () => { await tick(); return [] }, incidentExists: async () => { await tick(); return true } }

test('race with yielding I/O: 12 groups of 10 into 35 places -> exactly 3 succeed, never over-allocated', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 65 })
  const { svc, tables } = setup([s], yielding)
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => code(svc.reserve(body(s.id, `race ${i}`, 10, { incidentId: '11111111-1111-4111-8111-111111111111' }) as never, resp))))
  assert.equal(results.filter((r) => r === 'no error').length, 3)
  assert.equal(tables.shelters[0].reserved_capacity, 30)
  assert.ok(tables.shelters[0].current_occupancy + tables.shelters[0].reserved_capacity <= tables.shelters[0].capacity)
})

test('race with yielding I/O: one group requested at 5 shelters at once -> exactly one booking', async () => {
  const list = Array.from({ length: 5 }, (_, i) => shelter({ name: `S${i}` }))
  const { svc, tables } = setup(list, yielding)
  const incident = '11111111-1111-4111-8111-111111111111'
  const results = await Promise.all(list.map((s) => code(svc.reserve(body(s.id, 'Same family', 6, { incidentId: incident }) as never, resp))))
  assert.equal(results.filter((r) => r === 'no error').length, 1)
  assert.equal(tables.shelter_reservations.filter((r) => r.status === 'reserved').length, 1)
})

test('race with yielding I/O: arrival and cancellation of the same reservation at once -> only one wins', async () => {
  const s = shelter({ capacity: 50, current_occupancy: 0 })
  const { svc, tables } = setup([s], yielding)
  const r = (await svc.reserve(body(s.id, 'Contested', 10, { incidentId: '11111111-1111-4111-8111-111111111111' }) as never, resp)).reservation
  const out = await Promise.all([code(svc.confirmArrival(r.id, { arrivedCount: null }, resp)), code(svc.cancel(r.id, 'cancelled at the same moment', resp))])
  assert.equal(out.filter((x) => x === 'no error').length, 1)
  const row = tables.shelters[0]
  assert.ok((row.current_occupancy === 10 && row.reserved_capacity === 0) || (row.current_occupancy === 0 && row.reserved_capacity === 0))
})

test('race with yielding I/O: the same idempotency key sent 6 times at once -> one reservation, five replays', async () => {
  const s = shelter({ capacity: 100, current_occupancy: 0 })
  const { svc, tables } = setup([s], yielding)
  const req = body(s.id, 'Retry storm', 7, { incidentId: '11111111-1111-4111-8111-111111111111' })
  const out = await Promise.all(Array.from({ length: 6 }, () => svc.reserve(req as never, resp).catch((e) => e as ShelterError)))
  const created = out.filter((o) => !(o instanceof ShelterError) && !o.replayed)
  assert.equal(created.length, 1)
  assert.equal(tables.shelter_reservations.length, 1)
  assert.equal(tables.shelters[0].reserved_capacity, 7)
})
