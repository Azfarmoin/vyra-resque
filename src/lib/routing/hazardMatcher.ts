// Geographic hazard matching: which hazards sit on, or near, a route's real road geometry.
// Pure functions of (route geometry, hazards, now). No network, no LLM.
import { boundsOf, boxesOverlap, expandBox, haversineM, nearestOnPolyline, polylineToPolylineM } from './geo'
import type { Freshness, Hazard, LatLng, Proximity, RouteFinding } from './types'

// ---- tunables (documented in ROUTE_ANALYSIS.md) -----------------------------------------------------
/** A mapped closure counts as on the route when its path lies within this distance of the route line (GPS + map-matching slack). */
export const LINE_TOLERANCE_M = 30
/** Beyond the hazard's own footprint, this much further still gets reported as "near the route". */
export const NEAR_BUFFER_M = 200
/** Confirmed records older than this (since last verification, else since reported) are stale. */
export const STALE_CONFIRMED_MIN = 6 * 60
/** Unverified records go stale sooner: nobody has checked them. */
export const STALE_UNVERIFIED_MIN = 3 * 60
/** Two active reports of the same kind this close, and this close in time, are treated as the same hazard. */
export const DUPLICATE_RADIUS_M = 75
export const DUPLICATE_WINDOW_MIN = 6 * 60

const isActive = (h: Hazard) => h.verification === 'confirmed' || h.verification === 'unverified'

export function hazardBasisTime(h: Hazard): string | null {
  if (h.lastVerifiedAt && (!h.reportedAt || h.lastVerifiedAt > h.reportedAt)) return h.lastVerifiedAt
  return h.reportedAt
}

export function ageMinutes(h: Hazard, now: Date): number | null {
  const basis = hazardBasisTime(h)
  if (!basis) return null
  return Math.max(0, Math.round((now.getTime() - Date.parse(basis)) / 60_000))
}

export function freshnessOf(h: Hazard, now: Date): Freshness {
  const age = ageMinutes(h, now)
  if (age === null) return 'unknown'
  const limit = h.verification === 'confirmed' ? STALE_CONFIRMED_MIN : STALE_UNVERIFIED_MIN
  return age > limit ? 'stale' : 'fresh'
}

const hazardPoints = (h: Hazard): LatLng[] => (h.geometry.type === 'point' ? [h.geometry.point] : h.geometry.path)

/** Closest distance between two hazards' geometries, metres. */
export function hazardGapM(a: Hazard, b: Hazard): number {
  const ag = a.geometry
  const bg = b.geometry
  if (ag.type === 'point' && bg.type === 'point') return haversineM(ag.point, bg.point)
  if (ag.type === 'point' && bg.type === 'line') return nearestOnPolyline(ag.point, bg.path)?.distanceM ?? Infinity
  if (ag.type === 'line' && bg.type === 'point') return nearestOnPolyline(bg.point, ag.path)?.distanceM ?? Infinity
  if (ag.type === 'line' && bg.type === 'line') return polylineToPolylineM(ag.path, bg.path)?.distanceM ?? Infinity
  return Infinity
}

const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 } as const

/** Which of two duplicates to keep as the representative: confirmed, then more severe, then more recent. */
function stronger(a: Hazard, b: Hazard): Hazard {
  const va = a.verification === 'confirmed' ? 1 : 0
  const vb = b.verification === 'confirmed' ? 1 : 0
  if (va !== vb) return va > vb ? a : b
  if (a.blocksRoad !== b.blocksRoad) return a.blocksRoad ? a : b
  if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] > SEV_RANK[b.severity] ? a : b
  return (hazardBasisTime(a) ?? '') >= (hazardBasisTime(b) ?? '') ? a : b
}

export interface DuplicateIndex {
  /** hazard id -> representative id (itself when it is the representative or has no duplicates) */
  representative: Map<string, string>
  /** representative id -> ids of the other records folded into it */
  members: Map<string, string[]>
}

/**
 * Groups probable duplicate ACTIVE hazards (compatible kind, within DUPLICATE_RADIUS_M, and within
 * DUPLICATE_WINDOW_MIN of each other when both have timestamps). Duplicates are folded together so a
 * flood reported by five neighbours does not outweigh a single confirmed closure, and so the same
 * closure listed in two registers is not double-counted. Nothing is deleted: members stay visible.
 */
export function findDuplicates(hazards: Hazard[]): DuplicateIndex {
  const active = hazards.filter(isActive)
  const parent = new Map(active.map((h) => [h.id, h.id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]
      const b = active[j]
      // An unclassified ('other') record may describe the same hazard as a classified one.
      if (a.kind !== b.kind && a.kind !== 'other' && b.kind !== 'other') continue
      const ta = hazardBasisTime(a)
      const tb = hazardBasisTime(b)
      if (ta && tb && Math.abs(Date.parse(ta) - Date.parse(tb)) > DUPLICATE_WINDOW_MIN * 60_000) continue
      if (hazardGapM(a, b) <= DUPLICATE_RADIUS_M) parent.set(find(a.id), find(b.id))
    }
  }
  const groups = new Map<string, Hazard[]>()
  for (const h of active) {
    const root = find(h.id)
    groups.set(root, [...(groups.get(root) ?? []), h])
  }
  const representative = new Map<string, string>()
  const members = new Map<string, string[]>()
  for (const group of groups.values()) {
    const rep = group.reduce(stronger)
    members.set(rep.id, group.filter((g) => g.id !== rep.id).map((g) => g.id))
    for (const g of group) representative.set(g.id, rep.id)
  }
  // Inactive hazards are never merged.
  for (const h of hazards) if (!representative.has(h.id)) representative.set(h.id, h.id)
  return { representative, members }
}

/** The part of a hazard's footprint that decides "on route": its own radius for areas, a fixed tolerance for mapped paths. */
const footprintM = (h: Hazard) => (h.geometry.type === 'point' ? h.geometry.radiusM : LINE_TOLERANCE_M)

export interface MatchContext {
  now: Date
  duplicates: DuplicateIndex
}

/**
 * Findings for one route: every hazard within footprint + NEAR_BUFFER_M of the route geometry.
 * Hazards beyond that are far enough to ignore for THIS route (they remain in the dataset counts).
 * Hazards with no usable geometry never reach here; hazardSources reports them as skipped.
 */
export function matchRoute(route: LatLng[], hazards: Hazard[], ctx: MatchContext): RouteFinding[] {
  const box = boundsOf(route)
  if (!box) return []
  const findings: RouteFinding[] = []
  for (const h of hazards) {
    const pts = hazardPoints(h)
    const hbox = boundsOf(pts)
    if (!hbox) continue
    const reach = footprintM(h) + NEAR_BUFFER_M
    // Cheap rejection before the exact distance.
    if (!boxesOverlap(expandBox(box, reach), hbox)) continue

    const hit = h.geometry.type === 'point' ? nearestOnPolyline(h.geometry.point, route) : polylineToPolylineM(h.geometry.path, route)
    if (!hit) continue
    const footprint = footprintM(h)
    let proximity: Proximity
    if (hit.distanceM <= footprint) proximity = 'on_route'
    else if (hit.distanceM <= footprint + NEAR_BUFFER_M) proximity = 'near_route'
    else continue

    const rep = ctx.duplicates.representative.get(h.id) ?? h.id
    const state = isActive(h) ? 'active' : 'inactive'
    findings.push({
      hazardId: h.id,
      sourceTable: h.sourceTable,
      kind: h.kind,
      description: h.description,
      source: h.source,
      severity: h.severity,
      verification: h.verification,
      proximity,
      distanceM: Math.round(hit.distanceM),
      alongRouteM: Number.isFinite(hit.alongM) ? Math.round(hit.alongM) : null,
      reportedAt: h.reportedAt,
      lastVerifiedAt: h.lastVerifiedAt,
      ageMinutes: ageMinutes(h, ctx.now),
      freshness: freshnessOf(h, ctx.now),
      blocksRoad: h.blocksRoad,
      state,
      duplicateOf: rep !== h.id ? rep : null,
      duplicateIds: ctx.duplicates.members.get(h.id) ?? [],
      location: h.geometry.type === 'point' ? h.geometry.point : hit.point,
      path: h.geometry.type === 'line' ? h.geometry.path : null,
      evidence: h.evidence,
    })
  }
  // Order along the direction of travel so a dispatcher reads them as they would meet them.
  return findings.sort((a, b) => (a.alongRouteM ?? Infinity) - (b.alongRouteM ?? Infinity))
}
