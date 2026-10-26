// ShelterService backed by Postgres (migration 012). Every state change is ONE call to a SECURITY DEFINER function that locks the
// shelter row, checks the caller's role and writes the audit row, so concurrency control and permissions live in the database and
// cannot be bypassed by a buggy route. The client passed in must act AS the signed-in user (their access token): the functions use
// auth.uid() for the audit trail and `current_user_role()` for permission.
//
// NOT EXECUTED IN THIS REPOSITORY'S TEST RUN: it needs a live Postgres with the migrations applied (see SHELTER_ASSISTANT.md).
import type { SupabaseClient } from '@supabase/supabase-js'
import { normaliseShelter } from './facilities'
import type { ReconcileItem, ServiceOptions, ShelterService } from './service'
import { ShelterError, type ReservationRecord, type ShelterAuditEntry, type ShelterException, type ShelterRecord } from './types'

const STATUS: Record<string, number> = {
  forbidden: 403, unauthenticated: 401, shelter_not_found: 404, reservation_not_found: 404, exception_not_found: 404, incident_not_found: 404, dispatch_not_found: 404,
  invalid_party: 400, invalid_request: 400, invalid_expiry: 422, idempotency_conflict: 422, arrived_exceeds_reserved: 422,
}

/** The SQL functions raise `code|message`. Anything else is an unexpected database error and is NOT shown to the user verbatim. */
function toError(error: { message: string; code?: string; details?: string | null }): ShelterError {
  const m = /^([a-z_]+)\|([\s\S]*)$/.exec(error.message)
  if (m) return new ShelterError(STATUS[m[1]] ?? 409, m[1], m[2])
  if (error.code === '42501') return new ShelterError(403, 'forbidden', 'Your role cannot do this.')
  if (error.code === '23505') return new ShelterError(409, 'conflict', 'That conflicts with an existing record (for example this group is already booked).')
  console.error('shelter database error', error.code, error.message)
  return new ShelterError(500, 'database_error', 'The shelter database could not complete the request. Nothing was changed.')
}

export function createSupabaseShelterService(db: SupabaseClient, opts: ServiceOptions = {}): ShelterService {
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw toError(error)
    return data as T
  }
  const rows = async <T,>(q: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>): Promise<T[]> => {
    const { data, error } = await q
    if (error) throw toError(error)
    return (data ?? []) as T[]
  }
  const get = async (id: string) => {
    const { data, error } = await db.from('shelters').select('*').eq('id', id).maybeSingle()
    if (error) throw toError(error)
    if (!data) throw new ShelterError(404, 'shelter_not_found', 'Shelter not found.')
    return normaliseShelter(data)
  }

  const svc: ShelterService = {
    async listShelters() {
      await db.rpc('shelter_expire_all') // best effort: release lapsed holds before anyone reads capacity
      return (await rows<Record<string, unknown>>(db.from('shelters').select('*').order('name'))).map(normaliseShelter)
    },
    getShelter: get,

    async createShelter(patch, actor) {
      const { data, error } = await db.from('shelters').insert({
        name: patch.name, location_lat: patch.location_lat, location_lng: patch.location_lng, address: patch.address ?? null, area: patch.area ?? null, capacity: patch.capacity ?? null,
        current_occupancy: 0, status: patch.status ?? 'open', verified: false, contact_number: patch.contact_number ?? null, responsible_org: patch.responsible_org ?? null,
        data_source: patch.data_source ?? null, location_source: patch.location_source ?? null, opening_hours: patch.opening_hours ?? null, wheelchair_access: patch.wheelchair_access ?? 'unknown',
        infrastructure_dependencies: patch.infrastructure_dependencies ?? [], verification_status: 'unverified',
      }).select('*').single()
      if (error) throw toError(error)
      void actor
      const follow: Record<string, unknown> = {}
      if (patch.facilities) follow.facilities = patch.facilities
      if (patch.verification_status) follow.verification_status = patch.verification_status
      if (patch.location_verified) follow.location_verified = true
      if (Object.keys(follow).length) return (await svc.updateRegistry(data.id, follow, actor)).shelter
      return normaliseShelter(data)
    },
    async updateRegistry(id, patch) {
      const out = await rpc<{ shelter: Record<string, unknown>; cancelledReservations: ReservationRecord[]; warnings: { code: string; message: string }[] }>('shelter_update_registry', { p_id: id, p_patch: patch })
      return { shelter: normaliseShelter(out.shelter), cancelledReservations: out.cancelledReservations ?? [], warnings: out.warnings ?? [] }
    },
    async setOccupancy(id, input) {
      const out = await rpc<{ shelter: Record<string, unknown>; warnings: { code: string; message: string }[] }>('shelter_set_occupancy', { p_id: id, p_count: input.count, p_basis: input.basis })
      return { shelter: normaliseShelter(out.shelter), warnings: out.warnings ?? [] }
    },

    async listReservations(filter = {}) {
      let q = db.from('shelter_reservations').select('*').order('created_at', { ascending: false }).limit(500)
      if (filter.shelterId) q = q.eq('shelter_id', filter.shelterId)
      if (filter.incidentId) q = q.eq('incident_id', filter.incidentId)
      if (filter.dispatchId) q = q.eq('dispatch_id', filter.dispatchId)
      if (filter.activeOnly) q = q.in('status', ['reserved', 'arrived'])
      await db.rpc('shelter_expire_all')
      return rows<ReservationRecord>(q)
    },
    async reserve(input) {
      if (opts.siteBlockers) {
        const blockers = (await opts.siteBlockers(await get(input.shelterId))).filter((r) => r.severity === 'block')
        if (blockers.length) throw new ShelterError(409, 'site_hazard', blockers[0].message, { reasons: blockers.map((b) => b.message) })
      }
      const out = await rpc<{ reservation: ReservationRecord; replayed: boolean }>('shelter_reserve', {
        p_shelter: input.shelterId, p_group_label: input.groupLabel, p_incident: input.incidentId, p_dispatch: input.dispatchId, p_party: input.needs.partySize,
        p_needs: input.needs, p_expected: input.expectedArrivalAt, p_hold_minutes: input.holdMinutes, p_idem: input.idempotencyKey,
      })
      return out
    },
    confirmArrival: (id, input) => rpc<ReservationRecord>('shelter_confirm_arrival', { p_id: id, p_count: input.arrivedCount }),
    recordDeparture: (id) => rpc<ReservationRecord>('shelter_record_departure', { p_id: id }),
    cancel: (id, reason) => rpc<ReservationRecord>('shelter_cancel_reservation', { p_id: id, p_reason: reason }),
    extendHold: (id, minutes) => rpc<ReservationRecord>('shelter_extend_hold', { p_id: id, p_minutes: minutes }),

    createException: (input, actor) => rpc<ShelterException>('shelter_create_exception', { p_shelter: input.shelterId, p_kind: input.kind, p_extra: input.extraCapacity, p_reason: input.reason, p_expires: input.expiresAt, p_actor_name: actor.name }),
    revokeException: (id) => rpc<ShelterException>('shelter_revoke_exception', { p_id: id }),
    listExceptions: () => rows<ShelterException>(db.from('shelter_exceptions').select('*').order('created_at', { ascending: false }).limit(200)),
    reconcile: (shelterId) => rpc<ReconcileItem[]>('shelter_reconcile', { p_id: shelterId }),
    async listAudit(filter = {}) {
      let q = db.from('shelter_audit').select('*').order('created_at', { ascending: false }).limit(filter.limit ?? 200)
      if (filter.shelterId) q = q.eq('shelter_id', filter.shelterId)
      return rows<ShelterAuditEntry>(q)
    },
  }
  return svc
}
export type { ShelterRecord }
