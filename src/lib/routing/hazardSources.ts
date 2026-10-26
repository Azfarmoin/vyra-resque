// Turns VYRA's three hazard-bearing tables into one normalised Hazard list.
//
//   route_hazards     point + radius hazards (flooded underpass, cracked bridge). No verification or
//                     timestamp-of-verification columns exist, so these are "unverified" unless the
//                     optional migration-006 columns say otherwise. active=false means cleared.
//   blocked_roads     polyline closures with a `verified` flag. Severity is DERIVED from `reason`.
//   emergency_reports citizen reports whose structured `dangers` include a road-relevant hazard.
//                     These describe where a person is in danger, not necessarily that the road
//                     is impassable, so blocksRoad stays null.
//
// Nothing is invented: an absent timestamp stays null, a record without usable coordinates is SKIPPED
// and counted (it can never silently vanish), and a failing table is reported as an unavailable source.
import { getStore } from '../db'
import { supabase } from '../serverDb'
import { DANGERS, type Danger } from '../constants'
import type { BlockedRoad, ReportRow } from '../types'
import { isValidLatLng } from './geo'
import { sanitizeText } from './text'
import type {
  Hazard,
  HazardDataset,
  HazardKind,
  LatLng,
  Severity,
  SkippedHazard,
  SourceStatus,
  Verification,
} from './types'

type Row = Record<string, unknown>

// ---- tunables ------------------------------------------------------------------------------------
export const REPORT_HAZARD_RADIUS_M = 100 // an incident report marks an area, not an exact road point
export const MIN_RADIUS_M = 25
export const MAX_RADIUS_M = 3000
export const DEFAULT_ROUTE_HAZARD_RADIUS_M = 1000 // matches the table default (radius_km DEFAULT 1)

const KINDS: readonly HazardKind[] = [
  'road_closure', 'flooding', 'damaged_infrastructure', 'structural_collapse', 'debris', 'fire', 'landslide', 'electrical', 'gas_leak', 'other',
]
const VERIFICATIONS: readonly Verification[] = ['unverified', 'confirmed', 'resolved', 'expired']
const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high', 'critical']

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** ISO string for a valid, non-future timestamp; otherwise null (an unusable time is "unknown", not "now"). */
function isoOrNull(v: unknown, nowMs: number): string | null {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  if (!Number.isFinite(t) || t > nowMs + 10 * 60_000) return null
  return new Date(t).toISOString()
}

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null)

function evidenceList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').slice(0, 8).map((x) => sanitizeText(x, 160))
}

/** `resolved`/`expired` can come from the record's own state, never from age alone. */
function applyExpiry(verification: Verification, expiresAt: string | null, nowMs: number): Verification {
  if (verification === 'resolved') return 'resolved'
  if (expiresAt && Date.parse(expiresAt) < nowMs) return 'expired'
  return verification
}

// ---- route_hazards -------------------------------------------------------------------------------
export function normaliseRouteHazard(row: Row, nowMs: number): Hazard | SkippedHazard {
  const id = String(row.id ?? 'unknown')
  const lat = num(row.location_lat)
  const lng = num(row.location_lng)
  if (lat === null || lng === null || !isValidLatLng([lat, lng])) {
    return { id, sourceTable: 'route_hazards', reason: 'missing or invalid coordinates' }
  }
  const radiusKm = num(row.radius_km)
  const radiusM = Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radiusKm === null ? DEFAULT_ROUTE_HAZARD_RADIUS_M : radiusKm * 1000))
  const expiresAt = isoOrNull(row.expires_at, nowMs)
  // `active = false` is how the existing API marks a hazard cleared.
  const stated = oneOf(row.verification_status, VERIFICATIONS)
  const base: Verification = row.active === false ? 'resolved' : stated ?? 'unverified'
  const reportedAt = isoOrNull(row.reported_at, nowMs) ?? isoOrNull(row.created_at, nowMs)
  return {
    id,
    sourceTable: 'route_hazards',
    kind: oneOf(row.hazard_type, KINDS) ?? 'other',
    description: sanitizeText(row.description, 240) || 'Hazard (no description)',
    source: typeof row.source === 'string' && row.source ? sanitizeText(row.source, 80) : 'Route-hazard register',
    geometry: { type: 'point', point: [lat, lng], radiusM },
    reportedAt,
    lastVerifiedAt: isoOrNull(row.last_verified_at, nowMs),
    verification: applyExpiry(base, expiresAt, nowMs),
    severity: oneOf(row.severity, SEVERITIES) ?? 'medium',
    evidence: evidenceList(row.evidence),
    expiresAt,
    blocksRoad: typeof row.blocks_road === 'boolean' ? row.blocks_road : null,
  }
}

// ---- blocked_roads -------------------------------------------------------------------------------
const ROAD_REASON: Record<string, { kind: HazardKind; severity: Severity }> = {
  flooding: { kind: 'flooding', severity: 'high' },
  debris: { kind: 'debris', severity: 'high' },
  collapse: { kind: 'structural_collapse', severity: 'critical' },
  structural: { kind: 'damaged_infrastructure', severity: 'critical' },
  other: { kind: 'road_closure', severity: 'medium' },
}

export function normaliseBlockedRoad(row: BlockedRoad | Row, nowMs: number): Hazard | SkippedHazard {
  const r = row as Row
  const id = String(r.id ?? 'unknown')
  const raw = typeof r.path === 'string' ? safeJson(r.path) : r.path
  const path = Array.isArray(raw) ? (raw as unknown[]).map((p) => (Array.isArray(p) ? ([num(p[0]), num(p[1])] as [number | null, number | null]) : [null, null])) : []
  const valid = path.filter((p): p is LatLng => p[0] !== null && p[1] !== null && isValidLatLng([p[0], p[1]]))
  if (valid.length < 2 || valid.length !== path.length) {
    return { id, sourceTable: 'blocked_roads', reason: 'missing or invalid road path' }
  }
  const mapped = ROAD_REASON[String(r.reason)] ?? ROAD_REASON.other
  const expiresAt = isoOrNull(r.expires_at, nowMs)
  const stated = oneOf(r.verification_status, VERIFICATIONS)
  const base: Verification = stated ?? (r.verified === true ? 'confirmed' : 'unverified')
  return {
    id,
    sourceTable: 'blocked_roads',
    kind: mapped.kind,
    description: sanitizeText(r.description, 240) || 'Blocked road (no description)',
    source: typeof r.source === 'string' && r.source ? sanitizeText(r.source, 80) : 'Blocked-road register',
    geometry: { type: 'line', path: valid },
    reportedAt: isoOrNull(r.created_at, nowMs),
    // `verified` is a flag with no timestamp, and `updated_at` changes on any edit, so neither is
    // treated as a verification time. Only an explicit last_verified_at column counts.
    lastVerifiedAt: isoOrNull(r.last_verified_at, nowMs),
    verification: applyExpiry(base, expiresAt, nowMs),
    severity: mapped.severity,
    evidence: evidenceList(r.evidence),
    expiresAt,
    blocksRoad: true, // the register exists to record closures
  }
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// ---- emergency_reports ---------------------------------------------------------------------------
// Road-relevant dangers only. `drowning`, `trapped`, medical needs etc. say nothing about the road.
const REPORT_DANGER: Partial<Record<Danger, { kind: HazardKind; severity: Severity; rank: number }>> = {
  building_collapse: { kind: 'structural_collapse', severity: 'high', rank: 5 },
  fire: { kind: 'fire', severity: 'high', rank: 4 },
  gas_leak: { kind: 'gas_leak', severity: 'high', rank: 4 },
  electrocution: { kind: 'electrical', severity: 'high', rank: 4 },
  landslide: { kind: 'landslide', severity: 'high', rank: 3 },
  rising_water: { kind: 'flooding', severity: 'medium', rank: 2 },
}

export function normaliseReport(report: ReportRow, nowMs: number): Hazard | SkippedHazard | null {
  const dangers = (report.dangers ?? []).filter((d) => REPORT_DANGER[d])
  if (!dangers.length || report.status === 'cancelled') return null // not a road hazard / withdrawn duplicate
  const id = report.id
  const lat = num(report.location_lat)
  const lng = num(report.location_lng)
  if (lat === null || lng === null || !isValidLatLng([lat, lng])) {
    return { id, sourceTable: 'emergency_reports', reason: 'missing or invalid coordinates' }
  }
  const top = dangers.sort((a, b) => REPORT_DANGER[b]!.rank - REPORT_DANGER[a]!.rank)[0]
  const m = REPORT_DANGER[top]!
  const accuracy = num(report.location_accuracy_m)
  const radiusM = Math.min(500, Math.max(REPORT_HAZARD_RADIUS_M, accuracy ?? 0))
  const detail = sanitizeText(report.danger_details, 200)
  const verification: Verification = report.status === 'resolved' ? 'resolved' : report.verified ? 'confirmed' : 'unverified'
  return {
    id,
    sourceTable: 'emergency_reports',
    kind: m.kind,
    description: `${DANGERS[top]}${detail ? `: ${detail}` : ''}`,
    source: 'Citizen emergency report',
    geometry: { type: 'point', point: [lat, lng], radiusM },
    reportedAt: isoOrNull(report.created_at, nowMs),
    lastVerifiedAt: null, // reports carry a verified flag, not a verification time
    verification,
    severity: m.severity,
    evidence: [`Emergency report #${id.replace(/-/g, '').slice(-6).toUpperCase()}`, ...(dangers.length > 1 ? [`Also reported: ${dangers.slice(1).map((d) => DANGERS[d]).join(', ')}`] : [])],
    expiresAt: null,
    blocksRoad: null, // a person in danger near a road is not evidence the road is closed
  }
}

// ---- loading -------------------------------------------------------------------------------------
const isSkipped = (x: Hazard | SkippedHazard): x is SkippedHazard => 'reason' in x

const newest = (hs: Hazard[]) =>
  hs.reduce<string | null>((acc, h) => {
    const t = h.lastVerifiedAt && (!h.reportedAt || h.lastVerifiedAt > h.reportedAt) ? h.lastVerifiedAt : h.reportedAt
    return t && (!acc || t > acc) ? t : acc
  }, null)

async function loadOne(
  name: string,
  table: SourceStatus['table'],
  fetchRows: () => Promise<(Hazard | SkippedHazard | null)[]>,
): Promise<{ hazards: Hazard[]; skipped: SkippedHazard[]; status: SourceStatus }> {
  try {
    const items = (await fetchRows()).filter((x): x is Hazard | SkippedHazard => x !== null)
    const hazards = items.filter((x): x is Hazard => !isSkipped(x))
    const skipped = items.filter(isSkipped)
    return { hazards, skipped, status: { name, table, ok: true, count: hazards.length, newestAt: newest(hazards) } }
  } catch (err) {
    // A failing source is reported, never swallowed into "no hazards".
    return { hazards: [], skipped: [], status: { name, table, ok: false, count: 0, newestAt: null, error: err instanceof Error ? err.message : 'failed to load' } }
  }
}

/**
 * Loads every hazard source. Pass `deps` in tests. The real loaders hit the configured store/Supabase.
 */
export interface HazardLoaders {
  routeHazards: () => Promise<Row[]>
  blockedRoads: () => Promise<Row[]>
  reports: () => Promise<ReportRow[]>
}

export const defaultLoaders: HazardLoaders = {
  async routeHazards() {
    const { data, error } = await supabase.from('route_hazards').select('*')
    if (error) throw new Error(error.message)
    return (data ?? []) as Row[]
  },
  async blockedRoads() {
    // Through the data store (not the Supabase proxy) so demo mode sees its seeded roads.
    return (await getStore().listBlockedRoads()) as unknown as Row[]
  },
  async reports() {
    return getStore().listReports({})
  },
}

export async function loadHazards(loaders: HazardLoaders = defaultLoaders, now = new Date()): Promise<HazardDataset> {
  const nowMs = now.getTime()
  const parts = await Promise.all([
    loadOne('Route-hazard register', 'route_hazards', async () => (await loaders.routeHazards()).map((r) => normaliseRouteHazard(r, nowMs))),
    loadOne('Blocked-road register', 'blocked_roads', async () => (await loaders.blockedRoads()).map((r) => normaliseBlockedRoad(r, nowMs))),
    loadOne('Citizen emergency reports', 'emergency_reports', async () => (await loaders.reports()).map((r) => normaliseReport(r, nowMs))),
  ])
  return {
    hazards: parts.flatMap((p) => p.hazards),
    skipped: parts.flatMap((p) => p.skipped),
    sources: parts.map((p) => p.status),
    loadedAt: now.toISOString(),
  }
}
