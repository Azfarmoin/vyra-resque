// Shelter registry updates, reservations and capacity bookkeeping.
//
// ONE interface (`ShelterService`), two implementations:
//   * createMemoryShelterService (this file): used in demo mode and in tests. It works on the SAME rows the existing
//     demo `shelters` table holds, so the map, the Supplies page and this module always agree.
//   * createSupabaseShelterService (supabaseService.ts): calls the Postgres functions in migration 012, which take a
//     row lock (SELECT ... FOR UPDATE) so concurrent dispatchers cannot over-allocate.
// The rules below are mirrored in those SQL functions; tests/shelters.service.test.ts pins the TypeScript behaviour and
// tests/shelters.sql.test.ts checks the SQL still contains each guard.
//
// Concurrency here: every mutation runs inside a per-shelter mutex, and `reserve` additionally takes a per-group mutex FIRST
// (always group -> shelter, so no deadlock) so one group cannot be booked at two shelters by simultaneous requests.
import { randomUUID } from 'node:crypto'
import { availability, dataQuality, normaliseShelter } from './facilities'
import { activeExceptions, requirementsFor } from './engine'
import type { Reason } from './risk'
import {
  ACTIVE_RESERVATION, ShelterError,
  type Actor, type ReservationRecord, type ShelterAuditEntry, type ShelterException, type ShelterRecord,
} from './types'
import type { ExceptionBody, RegistryPatch, ReserveBody } from './validate'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ShelterTables {
  shelters: Row[]
  shelter_reservations: ReservationRecord[]
  shelter_exceptions: ShelterException[]
  shelter_audit: ShelterAuditEntry[]
}
export const emptyShelterTables = (shelters: Row[] = []): ShelterTables => ({ shelters, shelter_reservations: [], shelter_exceptions: [], shelter_audit: [] })

export interface ServiceOptions {
  now?: () => Date
  /** Re-checks hazards/zones at reservation time. Returns blocking reasons (verified exposure etc.). */
  siteBlockers?: (shelter: ShelterRecord) => Promise<Reason[]>
  incidentExists?: (id: string) => Promise<boolean>
  dispatchExists?: (id: string) => Promise<boolean>
}

export interface ReconcileItem { shelterId: string; name: string; check: string; stored: number | string; computed: number | string; fixed: boolean; note: string }
export interface Warning { code: string; message: string }

export interface ShelterService {
  listShelters(): Promise<ShelterRecord[]>
  getShelter(id: string): Promise<ShelterRecord>
  createShelter(patch: RegistryPatch, actor: Actor): Promise<ShelterRecord>
  updateRegistry(id: string, patch: RegistryPatch, actor: Actor): Promise<{ shelter: ShelterRecord; cancelledReservations: ReservationRecord[]; warnings: Warning[] }>
  setOccupancy(id: string, input: { count: number; basis: 'counted' | 'reported' | 'estimated' }, actor: Actor): Promise<{ shelter: ShelterRecord; warnings: Warning[] }>
  listReservations(filter?: { shelterId?: string; incidentId?: string; dispatchId?: string; activeOnly?: boolean }): Promise<ReservationRecord[]>
  reserve(input: ReserveBody, actor: Actor): Promise<{ reservation: ReservationRecord; replayed: boolean }>
  confirmArrival(id: string, input: { arrivedCount: number | null }, actor: Actor): Promise<ReservationRecord>
  recordDeparture(id: string, actor: Actor): Promise<ReservationRecord>
  cancel(id: string, reason: string, actor: Actor): Promise<ReservationRecord>
  extendHold(id: string, minutes: number, actor: Actor): Promise<ReservationRecord>
  createException(input: ExceptionBody, actor: Actor): Promise<ShelterException>
  revokeException(id: string, actor: Actor): Promise<ShelterException>
  listExceptions(): Promise<ShelterException[]>
  reconcile(shelterId: string | null, actor: Actor): Promise<ReconcileItem[]>
  listAudit(filter?: { shelterId?: string; limit?: number }): Promise<ShelterAuditEntry[]>
}

class Mutex {
  private tails = new Map<string, Promise<unknown>>()
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const tail = prev.then(() => gate)
    this.tails.set(key, tail)
    await prev.catch(() => undefined)
    try { return await fn() } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

const copy = <T,>(v: T): T => structuredClone(v)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
export const groupKeyFor = (incidentId: string | null, label: string) => `${incidentId ? `incident:${incidentId}` : 'adhoc'}:${slug(label)}`

export function createMemoryShelterService(tables: ShelterTables, opts: ServiceOptions = {}): ShelterService {
  const now = () => (opts.now ? opts.now() : new Date())
  const iso = () => now().toISOString()
  const mutex = new Mutex()

  const audit = (action: string, actor: Actor, shelterId: string | null, reservationId: string | null, detail: Record<string, unknown> = {}) => {
    tables.shelter_audit.push({ id: randomUUID(), shelter_id: shelterId, reservation_id: reservationId, action, actor_id: actor.id, actor_role: actor.role ?? 'system', detail, created_at: iso() })
  }
  const SYSTEM: Actor = { id: 'system', name: 'system', role: null }

  const rowOf = (id: string): Row => {
    const r = tables.shelters.find((s) => s.id === id)
    if (!r) throw new ShelterError(404, 'shelter_not_found', 'Shelter not found.')
    return r
  }
  const activeRes = (shelterId: string, statuses: string[] = ['reserved']) => tables.shelter_reservations.filter((r) => r.shelter_id === shelterId && statuses.includes(r.status))

  /** Recompute the derived columns from the ledger. Always called under the shelter's lock. */
  const recompute = (row: Row) => {
    row.reserved_capacity = activeRes(row.id).reduce((n, r) => n + r.party_size, 0)
    const ex = activeExceptions(tables.shelter_exceptions, row.id, now()).filter((e) => e.kind === 'over_capacity')
    row.authorized_overflow = ex.reduce((n, e) => n + e.extra_capacity, 0)
    row.updated_at = iso()
  }
  const autoStatus = (row: Row) => {
    const cap = row.capacity
    if (cap == null) return
    const ceiling = cap + (row.authorized_overflow ?? 0)
    if (row.status === 'open' && (row.current_occupancy ?? 0) >= ceiling) { row.status = 'full'; row.auto_full = true }
    else if (row.status === 'full' && row.auto_full && (row.current_occupancy ?? 0) < ceiling) { row.status = 'open'; row.auto_full = false }
  }

  /** Expire holds that passed their deadline. Under the shelter's lock. */
  const sweepLocked = (row: Row) => {
    let n = 0
    for (const r of tables.shelter_reservations) {
      if (r.shelter_id === row.id && r.status === 'reserved' && Date.parse(r.hold_expires_at) <= now().getTime()) {
        r.status = 'expired'; r.cancelled_at = iso(); r.cancel_reason = 'Hold expired without a confirmed arrival.'; r.updated_at = iso()
        audit('reservation_expired', SYSTEM, row.id, r.id, { party_size: r.party_size })
        n++
      }
    }
    // Exceptions lapse the same way: the overflow column follows the ledger.
    const before = row.authorized_overflow
    recompute(row)
    if (n || before !== row.authorized_overflow) autoStatus(row)
    return n
  }
  const sweepAll = async () => { for (const r of [...tables.shelters]) await mutex.run(r.id, async () => sweepLocked(r)) }

  const resOf = (id: string) => {
    const r = tables.shelter_reservations.find((x) => x.id === id)
    if (!r) throw new ShelterError(404, 'reservation_not_found', 'Reservation not found.')
    return r
  }
  const needNumbers = (n: ReservationRecord['needs']) => ({ ...n })

  const svc: ShelterService = {
    async listShelters() {
      await sweepAll()
      return tables.shelters.map((r) => normaliseShelter(copy(r)))
    },
    async getShelter(id) {
      return mutex.run(id, async () => { const r = rowOf(id); sweepLocked(r); return normaliseShelter(copy(r)) })
    },

    async createShelter(patch, actor) {
      const row: Row = {
        id: randomUUID(), name: patch.name, location_lat: patch.location_lat, location_lng: patch.location_lng, address: patch.address ?? null, area: patch.area ?? null,
        capacity: patch.capacity ?? null, current_occupancy: 0, services: [], status: patch.status ?? 'open', verified: false, contact_number: patch.contact_number ?? null,
        reserved_capacity: 0, authorized_overflow: 0, auto_full: false, location_verified: false, location_verified_at: null, location_source: patch.location_source ?? null,
        opening_hours: patch.opening_hours ?? null, last_verified_at: null, verified_by: null, verification_status: 'unverified', responsible_org: patch.responsible_org ?? null,
        data_source: patch.data_source ?? null, occupancy_updated_at: null, occupancy_basis: 'unknown', wheelchair_access: patch.wheelchair_access ?? 'unknown', facilities: {},
        infrastructure_dependencies: patch.infrastructure_dependencies ?? [], created_at: iso(), updated_at: iso(),
      }
      tables.shelters.push(row)
      // A new record is never verified at creation: verification is a separate, audited step.
      if (patch.facilities || patch.verification_status || patch.location_verified) await svc.updateRegistry(row.id, { facilities: patch.facilities, verification_status: patch.verification_status, location_verified: patch.location_verified }, actor)
      audit('shelter_created', actor, row.id, null, { name: row.name })
      return normaliseShelter(copy(row))
    },

    async updateRegistry(id, patch, actor) {
      return mutex.run(id, async () => {
        const row = rowOf(id)
        sweepLocked(row)
        const warnings: Warning[] = []
        const cancelled: ReservationRecord[] = []
        const changes: Record<string, unknown> = {}
        const set = (k: string, v: unknown) => { if (JSON.stringify(row[k]) !== JSON.stringify(v)) { changes[k] = { from: row[k] ?? null, to: v }; row[k] = v } }

        if (patch.capacity != null) {
          const floor = (row.current_occupancy ?? 0) + row.reserved_capacity
          if (patch.capacity + (row.authorized_overflow ?? 0) < floor) throw new ShelterError(409, 'capacity_below_commitments', `Capacity cannot be set below the ${floor} people already inside or held. Cancel reservations or record departures first.`, { floor })
          set('capacity', patch.capacity)
        }
        for (const k of ['name', 'address', 'area', 'contact_number', 'responsible_org', 'data_source', 'location_source', 'opening_hours', 'wheelchair_access', 'infrastructure_dependencies'] as const) if (k in patch) set(k, (patch as Row)[k])
        if (patch.location_lat != null && patch.location_lng != null) {
          set('location_lat', patch.location_lat); set('location_lng', patch.location_lng)
          // Moving the pin invalidates the earlier location check.
          if (changes.location_lat || changes.location_lng) { set('location_verified', false); row.location_verified_at = null }
        }
        if (patch.location_verified != null && !(changes.location_lat || changes.location_lng)) { set('location_verified', patch.location_verified); row.location_verified_at = patch.location_verified ? iso() : null }
        if (patch.facilities) {
          const fac: Row = { ...(row.facilities ?? {}) }
          for (const [k, v] of Object.entries(patch.facilities)) {
            fac[k] = { value: v!.value, documented_at: v!.value === 'yes' && v!.documented ? iso() : null, note: v!.note ?? null }
          }
          set('facilities', fac)
        }
        if (patch.verification_status) {
          set('verification_status', patch.verification_status)
          row.verified = patch.verification_status === 'verified'
          if (patch.verification_status === 'verified') { row.last_verified_at = iso(); row.verified_by = actor.id }
        }
        if (patch.status && patch.status !== row.status) {
          const from = row.status
          set('status', patch.status)
          row.auto_full = false
          if (patch.status === 'closed') {
            // Anyone still being sent here must be re-routed: holds are cancelled and reported back, people already inside stay on record.
            for (const r of activeRes(id)) {
              r.status = 'cancelled'; r.cancelled_at = iso(); r.cancel_reason = `Shelter closed by ${actor.name}.`; r.updated_at = iso()
              audit('reservation_cancelled', actor, id, r.id, { reason: 'shelter_closed' })
              cancelled.push(copy(r))
            }
            const inside = activeRes(id, ['arrived']).length
            if (inside) warnings.push({ code: 'people_inside', message: `${inside} tracked group${inside === 1 ? ' is' : 's are'} still recorded as inside this shelter.` })
            if (cancelled.length) warnings.push({ code: 'reservations_cancelled', message: `${cancelled.length} reservation${cancelled.length === 1 ? ' was' : 's were'} cancelled because the shelter closed. Re-route those groups.` })
          }
          audit('status_changed', actor, id, null, { from, to: patch.status })
        }
        recompute(row)
        autoStatus(row)
        audit('registry_updated', actor, id, null, { fields: Object.keys(changes) })
        return { shelter: normaliseShelter(copy(row)), cancelledReservations: cancelled, warnings }
      })
    },

    async setOccupancy(id, input, actor) {
      return mutex.run(id, async () => {
        const row = rowOf(id)
        sweepLocked(row)
        const warnings: Warning[] = []
        const tracked = activeRes(id, ['arrived']).reduce((n, r) => n + r.arrived_count, 0)
        if (input.count < tracked) warnings.push({ code: 'below_tracked_arrivals', message: `The count (${input.count}) is below the ${tracked} people recorded as arrived through reservations. Check whether departures were missed.` })
        const from = row.current_occupancy
        row.current_occupancy = input.count
        row.occupancy_basis = input.basis
        row.occupancy_updated_at = iso()
        recompute(row)
        if (row.capacity != null && input.count + row.reserved_capacity > row.capacity + row.authorized_overflow) warnings.push({ code: 'over_allocated', message: 'Occupancy plus held places now exceeds the permitted capacity. Reconcile reservations.' })
        autoStatus(row)
        audit('occupancy_set', actor, id, null, { from, to: input.count, basis: input.basis })
        return { shelter: normaliseShelter(copy(row)), warnings }
      })
    },

    async listReservations(filter = {}) {
      await sweepAll()
      return tables.shelter_reservations
        .filter((r) => (!filter.shelterId || r.shelter_id === filter.shelterId) && (!filter.incidentId || r.incident_id === filter.incidentId) && (!filter.dispatchId || r.dispatch_id === filter.dispatchId) && (!filter.activeOnly || ACTIVE_RESERVATION.includes(r.status)))
        .map(copy).sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async reserve(input, actor) {
      const groupKey = groupKeyFor(input.incidentId, input.groupLabel)
      // Lock order is always group -> shelter.
      return mutex.run(`group:${groupKey}`, () => mutex.run(input.shelterId, async () => {
        const row = rowOf(input.shelterId)
        sweepLocked(row)

        // Idempotent retry (flaky network, double click): same key returns the same reservation instead of booking twice.
        const prior = tables.shelter_reservations.find((r) => r.idempotency_key === input.idempotencyKey)
        if (prior) {
          if (prior.shelter_id !== input.shelterId || prior.party_size !== input.needs.partySize || prior.group_key !== groupKey)
            throw new ShelterError(422, 'idempotency_conflict', 'This idempotency key was already used for a different reservation.')
          return { reservation: copy(prior), replayed: true }
        }
        if (input.incidentId && opts.incidentExists && !(await opts.incidentExists(input.incidentId))) throw new ShelterError(404, 'incident_not_found', 'Incident not found.')
        if (input.dispatchId && opts.dispatchExists && !(await opts.dispatchExists(input.dispatchId))) throw new ShelterError(404, 'dispatch_not_found', 'Mission not found.')

        const clash = tables.shelter_reservations.find((r) => r.group_key === groupKey && ACTIVE_RESERVATION.includes(r.status))
        if (clash) throw new ShelterError(409, 'double_booking', `This group already has an active reservation${clash.shelter_id === input.shelterId ? ' at this shelter' : ' at another shelter'}. Cancel it or record the departure first.`, { reservationId: clash.id, shelterId: clash.shelter_id })

        const s = normaliseShelter(copy(row))
        if (s.verification_status === 'rejected') throw new ShelterError(409, 'shelter_rejected', 'This shelter record was rejected and cannot be used.')
        const exs = activeExceptions(tables.shelter_exceptions, s.id, now())
        const closedEx = exs.find((e) => e.kind === 'closed_use') ?? null
        if (s.status === 'closed' && !closedEx) throw new ShelterError(409, 'shelter_closed', 'The shelter is closed and no authorized exception is recorded.')
        const overflow = exs.filter((e) => e.kind === 'over_capacity').reduce((n, e) => n + e.extra_capacity, 0)
        if (s.capacity == null) throw new ShelterError(409, 'capacity_unknown', 'Maximum capacity is not recorded, so capacity cannot be reserved.')
        const overEx = exs.find((e) => e.kind === 'over_capacity') ?? null
        if (s.status === 'full' && !overEx) throw new ShelterError(409, 'shelter_full', 'The shelter is marked full and no authorized exception is recorded.')

        // The caller's recommendation is not trusted: required capabilities are re-checked here against the stored record.
        const unmet = requirementsFor(input.needs, s).filter((r) => !r.met)
        if (unmet.length) throw new ShelterError(409, 'requirements_unmet', `The shelter does not document: ${unmet.map((u) => u.label).join('; ')}. Request human review.`, { unmet: unmet.map((u) => ({ requirement: u.label, detail: u.detail })) })

        if (opts.siteBlockers) {
          const blockers = (await opts.siteBlockers(s)).filter((r) => r.severity === 'block')
          if (blockers.length) throw new ShelterError(409, 'site_hazard', blockers[0].message, { reasons: blockers.map((b) => b.message) })
        }

        const q = dataQuality(s, now())
        const av = availability({ ...s, authorized_overflow: overflow, reserved_capacity: activeRes(s.id).reduce((n, r) => n + r.party_size, 0) }, q)
        if (input.needs.partySize > av.available!) throw new ShelterError(409, 'insufficient_capacity', `Only ${av.available} places are free (${av.occupied} occupied, ${av.reserved} held, capacity ${av.max}${av.overflow ? ` + ${av.overflow} authorized` : ''}); the group needs ${input.needs.partySize}.`, { available: av.available })

        const t = now()
        const expected = input.expectedArrivalAt
        const holdFrom = expected && Date.parse(expected) > t.getTime() ? Date.parse(expected) : t.getTime()
        const { partySize, ...needs } = input.needs
        const rec: ReservationRecord = {
          id: randomUUID(), shelter_id: s.id, group_key: groupKey, group_label: input.groupLabel, incident_id: input.incidentId, dispatch_id: input.dispatchId,
          party_size: partySize, needs: needNumbers(needs), status: 'reserved', expected_arrival_at: expected, hold_expires_at: new Date(holdFrom + input.holdMinutes * 60_000).toISOString(),
          confirmed_arrival_at: null, confirmed_by: null, arrived_count: 0, departed_at: null, cancelled_at: null, cancel_reason: null,
          exception_id: s.status === 'closed' ? closedEx?.id ?? null : s.status === 'full' || av.available! < partySize ? overEx?.id ?? null : null,
          idempotency_key: input.idempotencyKey, created_by: actor.id, created_at: iso(), updated_at: iso(),
        }
        tables.shelter_reservations.push(rec)
        recompute(row)
        // Invariant: occupied + held never exceeds the permitted ceiling.
        if ((row.current_occupancy ?? 0) + row.reserved_capacity > row.capacity + row.authorized_overflow) {
          tables.shelter_reservations.pop(); recompute(row)
          throw new ShelterError(409, 'insufficient_capacity', 'Capacity changed while reserving; nothing was held.')
        }
        audit('reservation_created', actor, s.id, rec.id, { party_size: partySize, group_key: groupKey, exception_id: rec.exception_id })
        return { reservation: copy(rec), replayed: false }
      }))
    },

    async confirmArrival(id, input, actor) {
      const res0 = resOf(id)
      return mutex.run(res0.shelter_id, async () => {
        const row = rowOf(res0.shelter_id)
        sweepLocked(row)
        const r = resOf(id)
        if (r.status === 'arrived') throw new ShelterError(409, 'already_arrived', 'Arrival was already confirmed for this reservation.')
        if (r.status === 'expired') throw new ShelterError(409, 'hold_expired', 'The hold expired and its places were released. Make a new reservation if the shelter still has room.')
        if (r.status !== 'reserved') throw new ShelterError(409, 'invalid_state', `A ${r.status} reservation cannot be marked as arrived.`)
        const count = input.arrivedCount ?? r.party_size
        if (count > r.party_size) throw new ShelterError(422, 'arrived_exceeds_reserved', `${count} people arrived but only ${r.party_size} were reserved. Reserve the extra places first.`)
        r.status = 'arrived'; r.arrived_count = count; r.confirmed_arrival_at = iso(); r.confirmed_by = actor.id; r.updated_at = iso()
        row.current_occupancy = (row.current_occupancy ?? 0) + count
        recompute(row) // held places for this group are released; only the people who really arrived now count as occupied
        autoStatus(row)
        audit('arrival_confirmed', actor, row.id, r.id, { arrived: count, reserved: r.party_size })
        return copy(r)
      })
    },

    async recordDeparture(id, actor) {
      const res0 = resOf(id)
      return mutex.run(res0.shelter_id, async () => {
        const row = rowOf(res0.shelter_id)
        sweepLocked(row)
        const r = resOf(id)
        if (r.status !== 'arrived') throw new ShelterError(409, 'invalid_state', r.status === 'reserved' ? 'This group has not been confirmed as arrived, so there is no departure to record. Cancel the reservation instead.' : `A ${r.status} reservation cannot be marked as departed.`)
        const before = row.current_occupancy ?? 0
        row.current_occupancy = Math.max(0, before - r.arrived_count)
        if (before < r.arrived_count) audit('reconcile_needed', actor, row.id, r.id, { note: 'Occupancy was lower than the group being removed.', occupancy: before, group: r.arrived_count })
        r.status = 'departed'; r.departed_at = iso(); r.updated_at = iso()
        recompute(row)
        autoStatus(row)
        audit('departure_recorded', actor, row.id, r.id, { departed: r.arrived_count })
        return copy(r)
      })
    },

    async cancel(id, reason, actor) {
      const res0 = resOf(id)
      return mutex.run(res0.shelter_id, async () => {
        const row = rowOf(res0.shelter_id)
        sweepLocked(row)
        const r = resOf(id)
        if (r.status === 'cancelled') throw new ShelterError(409, 'already_cancelled', 'This reservation is already cancelled.')
        if (r.status === 'arrived') throw new ShelterError(409, 'invalid_state', 'People are recorded as inside. Record their departure instead of cancelling.')
        if (r.status !== 'reserved') throw new ShelterError(409, 'invalid_state', `A ${r.status} reservation cannot be cancelled.`)
        r.status = 'cancelled'; r.cancelled_at = iso(); r.cancel_reason = reason; r.updated_at = iso()
        recompute(row)
        audit('reservation_cancelled', actor, row.id, r.id, { reason })
        return copy(r)
      })
    },

    async extendHold(id, minutes, actor) {
      const res0 = resOf(id)
      return mutex.run(res0.shelter_id, async () => {
        const row = rowOf(res0.shelter_id)
        sweepLocked(row)
        const r = resOf(id)
        if (r.status !== 'reserved') throw new ShelterError(409, r.status === 'expired' ? 'hold_expired' : 'invalid_state', r.status === 'expired' ? 'The hold already expired and was released.' : `A ${r.status} reservation has no hold to extend.`)
        const max = Date.parse(r.created_at) + 24 * 3_600_000
        const next = Math.min(max, Date.parse(r.hold_expires_at) + minutes * 60_000)
        if (next <= Date.parse(r.hold_expires_at)) throw new ShelterError(409, 'hold_limit', 'A hold cannot be extended beyond 24 hours from creation.')
        r.hold_expires_at = new Date(next).toISOString(); r.updated_at = iso()
        audit('hold_extended', actor, row.id, r.id, { minutes })
        return copy(r)
      })
    },

    async createException(input, actor) {
      if (actor.role !== 'admin') throw new ShelterError(403, 'forbidden', 'Only administrators can authorize a capacity or closure exception.')
      return mutex.run(input.shelterId, async () => {
        const row = rowOf(input.shelterId)
        const exp = Date.parse(input.expiresAt)
        if (exp <= now().getTime()) throw new ShelterError(422, 'invalid_expiry', 'The exception must expire in the future.')
        if (exp - now().getTime() > 72 * 3_600_000) throw new ShelterError(422, 'invalid_expiry', 'An exception can last at most 72 hours. Renew it if it is still needed.')
        const e: ShelterException = {
          id: randomUUID(), shelter_id: row.id, kind: input.kind, extra_capacity: input.kind === 'over_capacity' ? input.extraCapacity : 0, reason: input.reason,
          authorized_by: actor.id, authorized_by_name: actor.name, expires_at: new Date(exp).toISOString(), revoked_at: null, created_at: iso(),
        }
        tables.shelter_exceptions.push(e)
        recompute(row)
        audit('exception_created', actor, row.id, null, { kind: e.kind, extra: e.extra_capacity, expires_at: e.expires_at, reason: e.reason })
        return copy(e)
      })
    },
    async revokeException(id, actor) {
      if (actor.role !== 'admin') throw new ShelterError(403, 'forbidden', 'Only administrators can revoke an exception.')
      const e = tables.shelter_exceptions.find((x) => x.id === id)
      if (!e) throw new ShelterError(404, 'exception_not_found', 'Exception not found.')
      return mutex.run(e.shelter_id, async () => {
        const row = rowOf(e.shelter_id)
        e.revoked_at = iso()
        recompute(row)
        autoStatus(row)
        audit('exception_revoked', actor, row.id, null, { exception_id: id })
        return copy(e)
      })
    },
    async listExceptions() { return tables.shelter_exceptions.map(copy) },

    /**
     * Capacity reconciliation: recompute everything derivable from the ledger and report/repair drift.
     * It never changes `current_occupancy`: that is a headcount only a person can supply (it includes walk-ins).
     */
    async reconcile(shelterId, actor) {
      const ids = shelterId ? [shelterId] : tables.shelters.map((s) => s.id)
      const out: ReconcileItem[] = []
      for (const id of ids) {
        await mutex.run(id, async () => {
          const row = rowOf(id)
          // Read what is STORED before the expiry sweep, because the sweep recomputes the derived columns and would hide drift.
          const storedReserved = row.reserved_capacity
          const storedOverflow = row.authorized_overflow
          sweepLocked(row)
          const trueReserved = activeRes(id).reduce((n, r) => n + r.party_size, 0)
          const tracked = activeRes(id, ['arrived']).reduce((n, r) => n + r.arrived_count, 0)
          if (storedReserved !== trueReserved) { out.push({ shelterId: id, name: row.name, check: 'reserved_capacity', stored: storedReserved, computed: trueReserved, fixed: true, note: 'Held places did not match the active reservations; corrected.' }); row.reserved_capacity = trueReserved }
          if ((row.current_occupancy ?? 0) < tracked) out.push({ shelterId: id, name: row.name, check: 'occupancy_below_tracked', stored: row.current_occupancy ?? 0, computed: tracked, fixed: false, note: 'Fewer people are recorded inside than reservations say arrived. A person must recount; occupancy was not changed.' })
          if (row.capacity != null && (row.current_occupancy ?? 0) + trueReserved > row.capacity + storedOverflow) out.push({ shelterId: id, name: row.name, check: 'over_allocated', stored: (row.current_occupancy ?? 0) + trueReserved, computed: row.capacity + storedOverflow, fixed: false, note: 'More people are recorded or held than the permitted capacity. A person must decide which groups to move.' })
          if (row.status === 'closed' && trueReserved > 0) out.push({ shelterId: id, name: row.name, check: 'reservation_at_closed_shelter', stored: trueReserved, computed: 0, fixed: false, note: 'Active holds exist at a closed shelter. Re-route those groups.' })
          autoStatus(row)
          audit('reconciled', actor, id, null, { findings: out.filter((o) => o.shelterId === id).map((o) => o.check) })
        })
      }
      return out
    },

    async listAudit(filter = {}) {
      return tables.shelter_audit.filter((a) => !filter.shelterId || a.shelter_id === filter.shelterId).slice(-(filter.limit ?? 200)).reverse().map(copy)
    },
  }
  return svc
}
