// Request handlers for the shelter APIs, written as plain functions: (caller, input, deps) -> { status, body }.
// The Next.js route files are thin adapters, so ALL authorization and validation lives here and is unit-tested without a web server.
//
// Rule of the file: every handler starts with `gate(caller, action)`. A handler that forgets it fails tests/shelters.handlers.test.ts,
// which calls every exported handler as anonymous, citizen, responder and admin and compares the outcome with the permission matrix.
import type { Hazard } from '../routing/types'
import type { DisasterZone } from '../zones/types'
import { analyseCoverage, compareHypotheticals, type DemandPoint } from './coverage'
import { buildDashboard } from './dashboard'
import { recommendShelters, type RouteAssessor } from './engine'
import { dataQuality, availability, normaliseShelter } from './facilities'
import { can, PUBLIC_SHELTER_FIELDS, type ShelterAction } from './permissions'
import { siteRisk, type FloodScenario } from './risk'
import type { ShelterService } from './service'
import { ShelterError, type Actor, type ShelterRecord } from './types'
import {
  parseCoverage, parseException, parseOccupancy, parseRecommend, parseRegistryPatch, parseReservationAction, parseReserve, UUID_RE,
} from './validate'

export interface Result { status: number; body: unknown }
export interface RiskInputs { hazards: Hazard[]; zones: DisasterZone[]; notices: string[] }
export interface HandlerDeps {
  service: ShelterService
  loadRisk: () => Promise<RiskInputs>
  routeAssessor: () => RouteAssessor | null
  loadDemand: () => Promise<DemandPoint[]>
  now?: () => Date
}

const ok = (body: unknown, status = 200): Result => ({ status, body })
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { code, error, ...extra } })
const invalid = (errors: { path: string; message: string }[]) => fail(400, 'invalid_request', errors[0] ? `${errors[0].path ? errors[0].path + ': ' : ''}${errors[0].message}` : 'Invalid request.', { details: errors })

/** Returns a failure Result when the caller may not perform `action`; otherwise null. */
export function gate(caller: Actor | null, action: ShelterAction): Result | null {
  if (can(caller?.role, action)) return null
  if (!caller || !caller.role) return fail(401, 'unauthenticated', 'Sign in to use the shelter tools.')
  return fail(403, 'forbidden', 'Your role cannot do this. Shelter reservations are for responders; registry changes are for administrators.')
}

async function guarded(fn: () => Promise<Result>): Promise<Result> {
  try { return await fn() } catch (e) {
    if (e instanceof ShelterError) return fail(e.status, e.code, e.message, e.details ? { details: e.details } : {})
    console.error('shelter handler failed', e instanceof Error ? e.message : e)
    return fail(500, 'internal_error', 'The shelter service failed unexpectedly. Nothing was changed unless a confirmation was shown.')
  }
}

const publicView = (s: ShelterRecord) => Object.fromEntries(PUBLIC_SHELTER_FIELDS.map((k) => [k, (s as unknown as Record<string, unknown>)[k] ?? null]))

/** Staff view of a shelter: record + availability + data-quality labels. */
export function staffView(s: ShelterRecord, now: Date, exceptions: { shelter_id: string; kind: string; extra_capacity: number; expires_at: string; revoked_at: string | null }[] = []) {
  const q = dataQuality(s, now)
  const overflow = exceptions.filter((e) => e.shelter_id === s.id && e.kind === 'over_capacity' && !e.revoked_at && Date.parse(e.expires_at) > now.getTime()).reduce((n, e) => n + e.extra_capacity, 0)
  return { ...s, availability: availability({ ...s, authorized_overflow: overflow }, q), dataQuality: q }
}

// ---------------------------------------------------------------------------------------------------------------------------------
export const listShelters = (caller: Actor | null, deps: HandlerDeps) => guarded(async () => {
  const now = (deps.now ?? (() => new Date()))()
  const all = await deps.service.listShelters()
  if (!can(caller?.role, 'view_detail')) return ok({ shelters: all.filter((s) => s.verification_status === 'verified').map(publicView), view: 'public' })
  const ex = await deps.service.listExceptions()
  return ok({ shelters: all.map((s) => staffView(s, now, ex)), view: 'staff' })
})

export const getShelter = (caller: Actor | null, id: string, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_detail'); if (g) return g
  if (!UUID_RE.test(id)) return fail(400, 'invalid_request', 'Invalid shelter id.')
  const now = (deps.now ?? (() => new Date()))()
  return ok({ shelter: staffView(await deps.service.getShelter(id), now, await deps.service.listExceptions()) })
})

export const createShelter = (caller: Actor | null, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'create_shelter'); if (g) return g
  const p = parseRegistryPatch(body, { creating: true }); if (!p.ok) return invalid(p.errors)
  return ok({ shelter: await deps.service.createShelter(p.value, caller!) }, 201)
})

/** PATCH /api/shelters/:id  -  { occupancy: {count, basis} } (responder) OR registry fields (administrator). */
export const patchShelter = (caller: Actor | null, id: string, body: unknown, deps: HandlerDeps) => guarded(async () => {
  if (!UUID_RE.test(id)) return fail(400, 'invalid_request', 'Invalid shelter id.')
  const isOccupancy = !!body && typeof body === 'object' && 'occupancy' in (body as object)
  if (isOccupancy) {
    const g = gate(caller, 'update_occupancy'); if (g) return g
    const keys = Object.keys(body as object)
    if (keys.length !== 1) return fail(400, 'invalid_request', 'Send occupancy on its own.')
    const p = parseOccupancy((body as { occupancy: unknown }).occupancy); if (!p.ok) return invalid(p.errors)
    return ok(await deps.service.setOccupancy(id, p.value, caller!))
  }
  const g = gate(caller, 'edit_registry'); if (g) return g
  const p = parseRegistryPatch(body); if (!p.ok) return invalid(p.errors)
  if (!Object.keys(p.value).length) return fail(400, 'invalid_request', 'Nothing to update.')
  return ok(await deps.service.updateRegistry(id, p.value, caller!))
})

// ---------------------------------------------------------------------------------------------------------------------------------
export const recommend = (caller: Actor | null, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'recommend'); if (g) return g
  const p = parseRecommend(body); if (!p.ok) return invalid(p.errors)
  const { origin, needs, vehicle, floodScenarioZoneIds, useActiveFloodZones } = p.value
  const now = (deps.now ?? (() => new Date()))()
  const [shelters, exceptions, risk] = await Promise.all([deps.service.listShelters(), deps.service.listExceptions(), deps.loadRisk()])

  // Flood scenario = existing flood zones chosen by the dispatcher. VYRA has no flood simulator: this is zone data, said plainly.
  let floodScenario: FloodScenario | null = null
  const floodZones = risk.zones.filter((z) => z.hazard_type === 'flood' && z.lifecycle === 'active' && z.verification_status !== 'ai_suggested' && (useActiveFloodZones || floodScenarioZoneIds.includes(z.id)))
  if (floodZones.length) floodScenario = { name: floodZones.length === 1 ? floodZones[0].name : `${floodZones.length} flood zones`, polygons: floodZones.map((z) => z.geometry), source: 'VYRA disaster zones' }
  if (floodScenarioZoneIds.length && floodZones.length !== floodScenarioZoneIds.length) return fail(404, 'zone_not_found', 'One or more selected flood zones were not found or are not active flood zones.')

  const result = await recommendShelters({ origin, needs, vehicle, floodScenario, now }, { shelters, exceptions, hazards: risk.hazards, zones: risk.zones, routeAssess: deps.routeAssessor() })
  return ok({ ...result, hazardDataNotices: risk.notices, floodScenario: floodScenario ? { name: floodScenario.name, source: floodScenario.source, zones: floodZones.length } : null, integrations: INTEGRATIONS })
})

export const INTEGRATIONS = {
  routing: 'Uses the existing OSRM / OpenRouteService provider and route-hazard analysis. If no provider is configured or it fails, estimates are labelled.',
  hazards: 'Uses the existing route-hazard register, blocked-road register, citizen reports and disaster zones.',
  floodSimulation: 'NOT AVAILABLE: VYRA has no flood simulator. A flood "scenario" here means the existing flood disaster zones you select.',
  infrastructureDependency: 'LIMITED: shelters can declare dependencies (grid power, municipal water, single access road) and are flagged when a recorded hazard is nearby. There is no infrastructure network model.',
}

// ---------------------------------------------------------------------------------------------------------------------------------
export const listReservations = (caller: Actor | null, q: { shelterId?: string; incidentId?: string; dispatchId?: string; activeOnly?: boolean }, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_reservations'); if (g) return g
  for (const k of ['shelterId', 'incidentId', 'dispatchId'] as const) if (q[k] && !UUID_RE.test(q[k]!)) return fail(400, 'invalid_request', `Invalid ${k}.`)
  return ok({ reservations: await deps.service.listReservations(q) })
})

export const reserve = (caller: Actor | null, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'reserve'); if (g) return g
  const p = parseReserve(body); if (!p.ok) return invalid(p.errors)
  const out = await deps.service.reserve(p.value, caller!)
  return ok(out, out.replayed ? 200 : 201)
})

export const reservationAction = (caller: Actor | null, id: string, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'update_reservation'); if (g) return g
  if (!UUID_RE.test(id)) return fail(400, 'invalid_request', 'Invalid reservation id.')
  const p = parseReservationAction(body); if (!p.ok) return invalid(p.errors)
  const a = p.value
  const reservation =
    a.action === 'confirm_arrival' ? await deps.service.confirmArrival(id, { arrivedCount: a.arrivedCount }, caller!)
    : a.action === 'depart' ? await deps.service.recordDeparture(id, caller!)
    : a.action === 'cancel' ? await deps.service.cancel(id, a.reason, caller!)
    : await deps.service.extendHold(id, a.minutes, caller!)
  return ok({ reservation })
})

// ---------------------------------------------------------------------------------------------------------------------------------
export const dashboard = (caller: Actor | null, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_dashboard'); if (g) return g
  const now = (deps.now ?? (() => new Date()))()
  const [shelters, reservations, exceptions, risk] = await Promise.all([deps.service.listShelters(), deps.service.listReservations({ activeOnly: true }), deps.service.listExceptions(), deps.loadRisk()])
  return ok({ ...buildDashboard({ shelters, reservations, exceptions, hazards: risk.hazards, zones: risk.zones, now }), hazardDataNotices: risk.notices })
})

export const coverage = (caller: Actor | null, query: { cellKm?: number; reachMinutes?: number }, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_coverage'); if (g) return g
  const p = parseCoverage({ cellKm: query.cellKm, reachMinutes: query.reachMinutes }); if (!p.ok) return invalid(p.errors)
  const now = (deps.now ?? (() => new Date()))()
  const [shelters, exceptions, risk, demand] = await Promise.all([deps.service.listShelters(), deps.service.listExceptions(), deps.loadRisk(), deps.loadDemand()])
  return ok(analyseCoverage({ shelters, exceptions, hazards: risk.hazards, zones: risk.zones, demand, cellKm: p.value.cellKm, reachMinutes: p.value.reachMinutes, now }))
})

export const evaluateHypotheticals = (caller: Actor | null, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'evaluate_hypotheticals'); if (g) return g
  const p = parseCoverage(body); if (!p.ok) return invalid(p.errors)
  if (!p.value.candidates.length) return fail(400, 'invalid_request', 'Add at least one hypothetical site.')
  const now = (deps.now ?? (() => new Date()))()
  const [shelters, exceptions, risk, demand] = await Promise.all([deps.service.listShelters(), deps.service.listExceptions(), deps.loadRisk(), deps.loadDemand()])
  return ok(compareHypotheticals({ shelters, exceptions, hazards: risk.hazards, zones: risk.zones, demand, cellKm: p.value.cellKm, reachMinutes: p.value.reachMinutes, now }, p.value.candidates.map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, capacity: c.capacity }))))
})

// ---------------------------------------------------------------------------------------------------------------------------------
export const createException = (caller: Actor | null, body: unknown, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'manage_exceptions'); if (g) return g
  const p = parseException(body); if (!p.ok) return invalid(p.errors)
  return ok({ exception: await deps.service.createException(p.value, caller!) }, 201)
})
export const revokeException = (caller: Actor | null, id: string, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'manage_exceptions'); if (g) return g
  if (!UUID_RE.test(id)) return fail(400, 'invalid_request', 'Invalid exception id.')
  return ok({ exception: await deps.service.revokeException(id, caller!) })
})
export const listExceptions = (caller: Actor | null, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_reservations'); if (g) return g
  return ok({ exceptions: await deps.service.listExceptions() })
})
export const reconcile = (caller: Actor | null, shelterId: string | null, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'reconcile'); if (g) return g
  if (shelterId && !UUID_RE.test(shelterId)) return fail(400, 'invalid_request', 'Invalid shelter id.')
  return ok({ findings: await deps.service.reconcile(shelterId, caller!) })
})
export const audit = (caller: Actor | null, q: { shelterId?: string }, deps: HandlerDeps) => guarded(async () => {
  const g = gate(caller, 'view_audit'); if (g) return g
  if (q.shelterId && !UUID_RE.test(q.shelterId)) return fail(400, 'invalid_request', 'Invalid shelter id.')
  return ok({ audit: await deps.service.listAudit(q) })
})

/** Used by the reservation service: hazards and zones re-checked at booking time. */
export const siteBlockersFrom = (load: () => Promise<RiskInputs>, now: () => Date = () => new Date()) => async (s: ShelterRecord) => {
  if (s.location_lat == null || s.location_lng == null) return []
  const r = await load()
  return siteRisk([s.location_lat, s.location_lng], normaliseShelter(s as unknown as Record<string, unknown>), { hazards: r.hazards, zones: r.zones, now: now() }).reasons
}
