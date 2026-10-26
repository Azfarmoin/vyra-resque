// Report evidence for zones, and SUGGESTED boundary changes for a person to review.
// Nothing here changes a zone. Suggestions become private AI drafts (never public, never official) and a responder
// must edit and promote them with a recorded reason. Absence of reports is never treated as evidence of safety.
import { haversineKm, pointInZone } from './geometry'
import type { DisasterZone, Position, ZoneGeometry } from './types'

export interface EvidenceReport { id: string; lat: number; lng: number; verified: boolean; created_at: string; status?: string }
export interface Evidence { linked: number; inside: number; total: number; verified: number; unverified: number; last24h: number; ids: string[] }

export const DEFAULTS = { minScore: 3, verifiedWeight: 2, clusterM: 500, nearM: 500, windowH: 24, quietH: 48 }
const counted = (r: EvidenceReport) => r.status !== 'cancelled' && r.status !== 'resolved'
const posOf = (r: EvidenceReport): Position => [r.lng, r.lat]

/** Reports linked to the zone plus open reports located inside its boundary (each counted once). */
export function zoneEvidence(z: DisasterZone, reports: EvidenceReport[], now = Date.now()): Evidence {
  const linkedIds = new Set(z.related_report_ids)
  const hit = reports.filter((r) => counted(r) && (linkedIds.has(r.id) || pointInZone(posOf(r), z.geometry, z.radius_m)))
  return {
    linked: hit.filter((r) => linkedIds.has(r.id)).length, inside: hit.filter((r) => pointInZone(posOf(r), z.geometry, z.radius_m)).length, total: hit.length,
    verified: hit.filter((r) => r.verified).length, unverified: hit.filter((r) => !r.verified).length,
    last24h: hit.filter((r) => now - Date.parse(r.created_at) <= 24 * 3_600_000).length, ids: hit.map((r) => r.id),
  }
}

const score = (rs: EvidenceReport[], w = DEFAULTS.verifiedWeight) => rs.reduce((s, r) => s + (r.verified ? w : 1), 0)

/** Convex hull (monotone chain) of [lng, lat] points. Returns null when the points are collinear or too few. */
export function convexHull(pts: Position[]): Position[] | null {
  const p = [...new Map(pts.map((q) => [`${q[0]},${q[1]}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return null
  const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Position[]) => { const h: Position[] = []; for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q) } h.pop(); return h }
  const hull = [...half(p), ...half([...p].reverse())]
  return hull.length >= 3 ? hull : null
}
const ring = (hull: Position[]): ZoneGeometry => ({ type: 'Polygon', coordinates: [[...hull, hull[0]]] })

export interface Suggestion {
  kind: 'new' | 'extend' | 'review_quiet' | 'review_official'
  zone_id: string | null
  title: string
  basis: string // plain-language reason shown to the reviewer and stored on the draft
  report_ids: string[]
  geometry: ZoneGeometry | null // approximate: convex hull of the points used; null = no boundary proposed
}

/**
 * Looks at open reports and existing zones and returns suggestions. Rules (all tunable via `opts`):
 *  - new:      >= minScore weighted reports within clusterM of each other, not inside any current hazard zone
 *  - extend:   >= minScore reports within nearM OUTSIDE an unofficial hazard zone -> hull of the zone and those reports
 *  - review_official: same pattern around an OFFICIAL zone -> no geometry, just "ask the authority"
 *  - review_quiet: an unofficial zone that had reports but none in quietH hours -> consider reviewing; NOT evidence of safety
 */
export function suggestChanges(zones: DisasterZone[], reports: EvidenceReport[], opts: Partial<typeof DEFAULTS> = {}, now = Date.now()): Suggestion[] {
  const o = { ...DEFAULTS, ...opts }
  const open = reports.filter((r) => counted(r) && now - Date.parse(r.created_at) <= o.windowH * 3_600_000)
  const live = zones.filter((z) => z.lifecycle === 'active' && z.verification_status !== 'ai_suggested' && ['danger', 'elevated', 'caution', 'restricted'].includes(z.zone_type) && (!z.valid_until || Date.parse(z.valid_until) > now))
  const out: Suggestion[] = []
  const used = new Set<string>()

  // extend / review_official: reports hugging the outside of a zone
  for (const z of live) {
    const edge = open.filter((r) => !pointInZone(posOf(r), z.geometry, z.radius_m) && nearZone(z, posOf(r), o.nearM))
    if (score(edge, o.verifiedWeight) < o.minScore) continue
    edge.forEach((r) => used.add(r.id))
    const official = z.verification_status === 'official'
    const hull = official || z.geometry.type !== 'Polygon' ? null : convexHull([...z.geometry.coordinates[0].slice(0, -1), ...edge.map(posOf)])
    out.push({
      kind: official ? 'review_official' : 'extend', zone_id: z.id, report_ids: edge.map((r) => r.id), geometry: hull ? ring(hull) : null,
      title: official ? `Reports just outside official zone "${z.name}"` : `Extend "${z.name}"?`,
      basis: `${edge.length} open report(s) (${edge.filter((r) => r.verified).length} verified) within ${o.nearM} m outside this zone in the last ${o.windowH} h.${official ? ' Official boundaries are not edited here: check with the issuing authority.' : ' Proposed area is the convex hull of the current boundary and those reports, so it is approximate.'}`,
    })
  }

  // new: clusters of reports in no current zone
  const free = open.filter((r) => !used.has(r.id) && !live.some((z) => pointInZone(posOf(r), z.geometry, z.radius_m)))
  const taken = new Set<string>()
  for (const seed of free) {
    if (taken.has(seed.id)) continue
    const group = free.filter((r) => !taken.has(r.id) && haversineKm(posOf(seed), posOf(r)) * 1000 <= o.clusterM)
    if (score(group, o.verifiedWeight) < o.minScore) continue
    const hull = convexHull(group.map(posOf))
    if (!hull) continue // collinear or too few distinct points: not enough to draw an area, so no boundary is invented
    group.forEach((r) => taken.add(r.id))
    out.push({ kind: 'new', zone_id: null, report_ids: group.map((r) => r.id), geometry: ring(hull), title: `New caution area from ${group.length} reports`,
      basis: `${group.length} open report(s) (${group.filter((r) => r.verified).length} verified) within ${o.clusterM} m of each other in the last ${o.windowH} h, outside every current zone. Boundary is the convex hull of the report locations, so it is approximate.` })
  }

  // quiet unofficial zones
  for (const z of live) {
    if (z.verification_status === 'official') continue
    const ev = zoneEvidence(z, reports, now)
    const recent = reports.filter((r) => ev.ids.includes(r.id) && now - Date.parse(r.created_at) <= o.quietH * 3_600_000)
    if (ev.total === 0 || recent.length) continue
    out.push({ kind: 'review_quiet', zone_id: z.id, report_ids: ev.ids, geometry: null, title: `Review "${z.name}"`, basis: `No new reports for ${o.quietH} h. This is NOT evidence the area is safe: check with responders on the ground before cancelling or reducing it.` })
  }
  return out
}

// Distance from a point to the zone's EDGES (not just its corners), in metres, using a local flat projection.
function nearZone(z: DisasterZone, p: Position, meters: number): boolean {
  const lines: Position[][] = z.geometry.type === 'Point' ? [[z.geometry.coordinates]] : z.geometry.type === 'LineString' ? [z.geometry.coordinates] : z.geometry.type === 'Polygon' ? [z.geometry.coordinates[0]] : z.geometry.coordinates.map((x) => x[0])
  const extra = z.geometry.type === 'Point' && z.radius_m ? z.radius_m : 0
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180), ky = 110_570
  const m = (q: Position): [number, number] => [(q[0] - p[0]) * kx, (q[1] - p[1]) * ky]
  return lines.some((line) => {
    if (line.length === 1) { const [x, y] = m(line[0]); return Math.hypot(x, y) <= meters + extra }
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = m(line[i - 1]), [bx, by] = m(line[i])
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
      if (Math.hypot(ax + t * dx, ay + t * dy) <= meters + extra) return true
    }
    return false
  })
}
