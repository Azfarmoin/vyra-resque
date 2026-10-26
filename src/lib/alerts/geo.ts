// Does an alert apply to a place? Uses only the boundary the source published.
// The answer is "yes", "possible", "no" or "unknown" - never a claim about an exact street or building.

import type { AlertGeometry, AlertRecord, LatLng, LocationMatch, SavedLocation } from './types'

const R = 6371
const rad = (d: number) => (d * Math.PI) / 180

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Ray casting on lat/lng treated as a plane: accurate for the regional polygons alerting authorities publish.
// (Polygons crossing the antimeridian are not supported; they are rare for national warnings.)
export function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Distance from a point to a segment, in km (local equirectangular projection around the point).
function distToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = Math.cos(rad(p[0])) * 111.32
  const ky = 110.57
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky
  const bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

export function distToRingEdgeKm(p: LatLng, ring: LatLng[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length - 1; i++) best = Math.min(best, distToSegmentKm(p, ring[i], ring[i + 1]))
  return best
}

// How precisely do we know where the person is? Named-area centres are only a stand-in for the whole area.
export function effectiveAccuracyKm(loc: SavedLocation): number {
  if (loc.source === 'gps') return Math.max(0.01, (loc.accuracyM ?? 100) / 1000)
  if (loc.source === 'area_centre') return Math.max(5, (loc.accuracyM ?? 0) / 1000)
  return Math.max(1, (loc.accuracyM ?? 0) / 1000)
}

type Hit = { result: 'yes' | 'possible' | 'no'; precision: LocationMatch['precision']; distanceKm: number }

function testGeometry(g: AlertGeometry, p: LatLng, accKm: number): Hit {
  if (g.type === 'polygon') {
    let best: Hit = { result: 'no', precision: 'polygon', distanceKm: Infinity }
    for (const ring of g.rings) {
      const inside = pointInRing(p, ring)
      const edge = distToRingEdgeKm(p, ring)
      let r: Hit['result'] = inside ? (accKm > edge ? 'possible' : 'yes') : accKm >= edge ? 'possible' : 'no'
      const d = inside ? 0 : edge
      if (rank(r) > rank(best.result) || (r === best.result && d < best.distanceKm)) best = { result: r, precision: 'polygon', distanceKm: d }
    }
    return best
  }
  const circle = g.type === 'circle' ? { c: g.center, r: g.radiusKm, precision: 'circle' as const } : g.type === 'point' ? { c: g.center, r: g.displayRadiusKm, precision: 'point_radius' as const } : null
  if (circle) {
    const d = haversineKm(p, circle.c)
    const edge = Math.abs(d - circle.r)
    const inside = d <= circle.r
    const r: Hit['result'] = inside ? (accKm > edge ? 'possible' : 'yes') : accKm >= edge ? 'possible' : 'no'
    return { result: r, precision: circle.precision, distanceKm: Math.max(0, d - circle.r) }
  }
  if (g.type === 'bbox') {
    const inside = p[0] >= g.south && p[0] <= g.north && p[1] >= g.west && p[1] <= g.east
    const dLat = Math.max(g.south - p[0], 0, p[0] - g.north) * 110.57
    const dLng = Math.max(g.west - p[1], 0, p[1] - g.east) * Math.cos(rad(p[0])) * 111.32
    const edge = inside ? Math.min((p[0] - g.south) * 110.57, (g.north - p[0]) * 110.57, (p[1] - g.west) * 111.32, (g.east - p[1]) * 111.32) : Math.hypot(dLat, dLng)
    const r: Hit['result'] = inside ? (accKm > edge ? 'possible' : 'yes') : accKm >= edge ? 'possible' : 'no'
    return { result: r, precision: 'bbox', distanceKm: inside ? 0 : Math.hypot(dLat, dLng) }
  }
  return { result: 'no', precision: 'none', distanceKm: Infinity }
}
const rank = (r: Hit['result']) => (r === 'yes' ? 2 : r === 'possible' ? 1 : 0)

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

// Name matching is a last resort for alerts published without boundaries. It can only ever say "possible".
function nameMatches(alert: AlertRecord, label: string): boolean {
  const haystack = ' ' + norm([alert.affected_area, ...alert.areas.flatMap((a) => [a.description, ...a.geocodes.map((g) => g.value)])].join(' ')) + ' '
  const parts = norm(label).split(' ').filter((t) => t.length >= 4)
  if (!parts.length) return false
  const phrase = norm(label)
  return haystack.includes(` ${phrase} `) || parts.some((t) => haystack.includes(` ${t} `))
}

export function matchLocation(alert: AlertRecord, loc: SavedLocation): LocationMatch {
  const p: LatLng = [loc.lat, loc.lng]
  const accKm = effectiveAccuracyKm(loc)
  const geoms = alert.areas.flatMap((a) => a.geometry)
  const imprecise = accKm >= 1
  const impNote = imprecise ? ` Your location is only approximate (about ${accKm < 10 ? accKm.toFixed(1) : Math.round(accKm)} km), so this may not describe your exact street or building.` : ''

  if (geoms.length) {
    let best: Hit = { result: 'no', precision: 'none', distanceKm: Infinity }
    for (const g of geoms) {
      const h = testGeometry(g, p, accKm)
      if (rank(h.result) > rank(best.result) || (h.result === best.result && h.distanceKm < best.distanceKm)) best = h
    }
    if (best.result === 'yes') return { result: 'yes', precision: best.precision, distanceKm: 0, note: `Inside the area published by the source.${impNote}` }
    if (best.result === 'possible') return { result: 'possible', precision: best.precision, distanceKm: best.distanceKm, note: `Close to the edge of the published area or your location is imprecise, so this may apply to you.${impNote}` }
    return { result: 'no', precision: best.precision, distanceKm: best.distanceKm, note: 'Outside the area published by the source. This is not a statement that your location is safe.' }
  }
  if (nameMatches(alert, loc.label)) {
    return { result: 'possible', precision: 'area_name', note: `Matched by area name only; the source published no boundary.${impNote}` }
  }
  return { result: 'unknown', precision: 'none', note: 'The source published no boundary, so VYRA cannot tell whether this applies to you. Read the area description.' }
}

// --- Rough extent, used to compare alerts from different sources --------------------------------
export function alertBBox(alert: AlertRecord): [number, number, number, number] | null {
  let s = 90, w = 180, n = -90, e = -180, any = false
  const add = (lat: number, lng: number) => { any = true; s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lng); e = Math.max(e, lng) }
  for (const a of alert.areas) for (const g of a.geometry) {
    if (g.type === 'polygon') g.rings.forEach((r) => r.forEach(([la, ln]) => add(la, ln)))
    else if (g.type === 'bbox') { add(g.south, g.west); add(g.north, g.east) }
    else {
      const r = g.type === 'circle' ? g.radiusKm : g.displayRadiusKm
      const dLat = r / 110.57
      const dLng = r / (111.32 * Math.max(0.1, Math.cos(rad(g.center[0]))))
      add(g.center[0] - dLat, g.center[1] - dLng); add(g.center[0] + dLat, g.center[1] + dLng)
    }
  }
  return any ? [s, w, n, e] : null
}
export const bboxOverlap = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
