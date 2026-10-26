// Shelter dashboard: occupancy, remaining capacity, stale records, access problems and potential hazard exposure.
// Pure. Reuses siteRisk() so the dashboard, the recommendation engine and the coverage map never disagree.
import type { Hazard } from '../routing/types'
import type { DisasterZone } from '../zones/types'
import { activeExceptions } from './engine'
import { availability, dataQuality, normaliseShelter, openNow, type Availability, type DataQuality } from './facilities'
import { siteRisk } from './risk'
import type { ReservationRecord, ShelterException, ShelterRecord } from './types'

export type FlagCode =
  | 'stale_occupancy' | 'estimated_occupancy' | 'stale_verification' | 'unverified' | 'needs_review' | 'rejected' | 'no_location' | 'location_unverified'
  | 'access_problem' | 'verified_hazard_exposure' | 'potential_hazard_exposure' | 'dependency_at_risk' | 'over_allocated' | 'reservation_at_closed_shelter'
  | 'outside_hours' | 'capacity_unknown' | 'authorized_exception'
export interface DashFlag { code: FlagCode; severity: 'high' | 'medium' | 'low'; message: string }

export interface DashRow {
  id: string; name: string; area: string | null; status: ShelterRecord['status']; location: [number, number] | null
  max: number | null; occupied: number; reserved: number; available: number | null; percentFull: number | null
  availability: Availability; dataQuality: DataQuality
  activeReservations: number; arrivedGroups: number
  flags: DashFlag[]
  attentionScore: number
}
export interface DashSummary {
  shelters: number; open: number; full: number; closed: number
  totalCapacity: number; totalOccupied: number; totalReserved: number; totalAvailable: number // open shelters with known capacity only
  staleOccupancy: number; staleVerification: number; unverified: number; accessProblems: number; hazardExposed: number; potentiallyExposed: number; overAllocated: number
  capacityNote: string
}
export interface Dashboard { generatedAt: string; summary: DashSummary; rows: DashRow[]; attention: DashRow[] }

export interface DashboardInput {
  shelters: ShelterRecord[]; reservations: ReservationRecord[]; exceptions: ShelterException[]; hazards: Hazard[]; zones: DisasterZone[]; now: Date
}

const weight = { high: 3, medium: 2, low: 1 } as const

export function buildDashboard(input: DashboardInput): Dashboard {
  const { now } = input
  const rows: DashRow[] = input.shelters.map((raw) => {
    const s = normaliseShelter(raw as unknown as Record<string, unknown>)
    const q = dataQuality(s, now)
    const exs = activeExceptions(input.exceptions, s.id, now)
    const overflow = exs.filter((e) => e.kind === 'over_capacity').reduce((n, e) => n + e.extra_capacity, 0)
    const av = availability({ ...s, authorized_overflow: overflow }, q)
    const flags: DashFlag[] = []
    const add = (code: FlagCode, severity: DashFlag['severity'], message: string) => flags.push({ code, severity, message })

    if (s.verification_status === 'rejected') add('rejected', 'high', 'Record rejected during verification.')
    else if (s.verification_status === 'unverified') add('unverified', 'high', 'UNVERIFIED record: do not rely on its details.')
    else if (s.verification_status === 'needs_review') add('needs_review', 'medium', 'Flagged for re-verification.')
    else if (q.verification.stale) add('stale_verification', 'medium', q.verification.label)
    if (q.occupancy.basis === 'estimated') add('estimated_occupancy', 'medium', q.occupancy.label)
    else if (q.occupancy.freshness !== 'fresh') add('stale_occupancy', 'medium', q.occupancy.label)
    if (s.location_lat == null || s.location_lng == null) add('no_location', 'high', 'No coordinates recorded.')
    else if (!s.location_verified) add('location_unverified', 'low', 'Location pin not verified.')
    if (av.max == null) add('capacity_unknown', 'high', 'Maximum capacity not recorded.')
    if (av.overAllocatedBy > 0) add('over_allocated', 'high', `${av.overAllocatedBy} more people recorded or held than permitted capacity.`)
    const active = input.reservations.filter((r) => r.shelter_id === s.id && r.status === 'reserved')
    if (s.status === 'closed' && active.length) add('reservation_at_closed_shelter', 'high', `${active.length} active hold(s) at a closed shelter: re-route those groups.`)
    if (s.status !== 'closed' && openNow(s.opening_hours, now) === 'closed') add('outside_hours', 'low', 'Outside documented opening hours.')
    if (exs.length) add('authorized_exception', 'medium', `Authorized exception in force until ${exs.map((e) => e.expires_at).sort()[0]} (${exs.map((e) => e.kind).join(', ')}).`)
    if (s.location_lat != null && s.location_lng != null) {
      const risk = siteRisk([s.location_lat, s.location_lng], s, { hazards: input.hazards, zones: input.zones, now })
      for (const r of risk.reasons) {
        if (r.severity === 'block') add('verified_hazard_exposure', 'high', r.message)
        else if (r.severity === 'flag') add('potential_hazard_exposure', 'medium', r.message)
      }
      for (const r of risk.access) add('access_problem', 'medium', r.message)
      for (const r of risk.dependencies) add('dependency_at_risk', 'medium', r.message)
    }
    const occupied = av.occupied
    return {
      id: s.id, name: s.name, area: s.area, status: s.status, location: s.location_lat != null && s.location_lng != null ? [s.location_lat, s.location_lng] : null,
      max: av.max, occupied, reserved: av.reserved, available: av.available, percentFull: av.max ? Math.round(((occupied + av.reserved) / av.max) * 100) : null,
      availability: av, dataQuality: q, activeReservations: active.length, arrivedGroups: input.reservations.filter((r) => r.shelter_id === s.id && r.status === 'arrived').length,
      flags, attentionScore: flags.reduce((n, f) => n + weight[f.severity], 0),
    }
  })

  const has = (r: DashRow, code: FlagCode) => r.flags.some((f) => f.code === code)
  const counting = rows.filter((r) => r.status !== 'closed' && r.max != null)
  const summary: DashSummary = {
    shelters: rows.length, open: rows.filter((r) => r.status === 'open').length, full: rows.filter((r) => r.status === 'full').length, closed: rows.filter((r) => r.status === 'closed').length,
    totalCapacity: counting.reduce((n, r) => n + r.max!, 0), totalOccupied: counting.reduce((n, r) => n + r.occupied, 0), totalReserved: counting.reduce((n, r) => n + r.reserved, 0), totalAvailable: counting.reduce((n, r) => n + (r.available ?? 0), 0),
    staleOccupancy: rows.filter((r) => has(r, 'stale_occupancy') || has(r, 'estimated_occupancy')).length,
    staleVerification: rows.filter((r) => has(r, 'stale_verification') || has(r, 'unverified') || has(r, 'needs_review')).length,
    unverified: rows.filter((r) => has(r, 'unverified')).length,
    accessProblems: rows.filter((r) => has(r, 'access_problem')).length,
    hazardExposed: rows.filter((r) => has(r, 'verified_hazard_exposure')).length,
    potentiallyExposed: rows.filter((r) => has(r, 'potential_hazard_exposure')).length,
    overAllocated: rows.filter((r) => has(r, 'over_allocated')).length,
    capacityNote: 'Totals cover shelters that are not closed and have a recorded capacity. Figures from stale, estimated or unverified records are included but flagged: treat the total as an upper bound, not a guarantee.',
  }
  const sorted = [...rows].sort((a, b) => b.attentionScore - a.attentionScore || a.name.localeCompare(b.name))
  return { generatedAt: now.toISOString(), summary, rows: sorted, attention: sorted.filter((r) => r.attentionScore > 0).slice(0, 12) }
}
