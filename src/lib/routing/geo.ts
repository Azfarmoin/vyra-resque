// Geographic calculations for route/hazard matching. Plain geometry only: no LLM, no text-derived distances.
//
// Distances use a local equirectangular projection around a reference latitude. Over the few tens of
// kilometres a response route covers, the error is well under a metre per kilometre, which is far
// finer than the accuracy of GPS reports or road-network snapping.
import type { LatLng } from './types'

const EARTH_R = 6371008.8
const M_PER_DEG = (Math.PI / 180) * EARTH_R // ~111,195 m per degree of latitude
const rad = (d: number) => (d * Math.PI) / 180

export const isValidLatLng = (p: unknown): p is LatLng =>
  Array.isArray(p) &&
  p.length === 2 &&
  typeof p[0] === 'number' &&
  typeof p[1] === 'number' &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  p[0] >= -90 &&
  p[0] <= 90 &&
  p[1] >= -180 &&
  p[1] <= 180

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)))
}

type XY = [number, number]

function projector(ref: LatLng) {
  const cos = Math.cos(rad(ref[0]))
  return (p: LatLng): XY => [(p[1] - ref[1]) * M_PER_DEG * cos, (p[0] - ref[0]) * M_PER_DEG]
}

function distPointSeg(p: XY, a: XY, b: XY): { d: number; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t }
}

const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function distSegSeg(a: XY, b: XY, c: XY, d: XY): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(distPointSeg(a, c, d).d, distPointSeg(b, c, d).d, distPointSeg(c, a, b).d, distPointSeg(d, a, b).d)
}

export interface NearestOnLine {
  distanceM: number
  point: LatLng
  alongM: number // metres from the start of the line to the nearest point
}

/** Closest point on a polyline to `p`. A single-point line degrades to a point distance. */
export function nearestOnPolyline(p: LatLng, line: LatLng[]): NearestOnLine | null {
  if (!line.length) return null
  if (line.length === 1) return { distanceM: haversineM(p, line[0]), point: line[0], alongM: 0 }
  const proj = projector(p)
  const origin: XY = [0, 0]
  let best: NearestOnLine | null = null
  let travelled = 0
  for (let i = 0; i < line.length - 1; i++) {
    const a = proj(line[i])
    const b = proj(line[i + 1])
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    const { d, t } = distPointSeg(origin, a, b)
    if (!best || d < best.distanceM) {
      best = {
        distanceM: d,
        point: [line[i][0] + t * (line[i + 1][0] - line[i][0]), line[i][1] + t * (line[i + 1][1] - line[i][1])],
        alongM: travelled + t * segLen,
      }
    }
    travelled += segLen
  }
  return best
}

export interface LineBox {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function boundsOf(points: LatLng[]): LineBox | null {
  if (!points.length) return null
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const [la, ln] of points) {
    if (la < minLat) minLat = la
    if (la > maxLat) maxLat = la
    if (ln < minLng) minLng = ln
    if (ln > maxLng) maxLng = ln
  }
  return { minLat, maxLat, minLng, maxLng }
}

export function expandBox(b: LineBox, meters: number): LineBox {
  const dLat = meters / M_PER_DEG
  const dLng = meters / (M_PER_DEG * Math.max(0.01, Math.cos(rad((b.minLat + b.maxLat) / 2))))
  return { minLat: b.minLat - dLat, maxLat: b.maxLat + dLat, minLng: b.minLng - dLng, maxLng: b.maxLng + dLng }
}

export const boxesOverlap = (a: LineBox, b: LineBox) =>
  a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng

export const pointInBox = (p: LatLng, b: LineBox) => p[0] >= b.minLat && p[0] <= b.maxLat && p[1] >= b.minLng && p[1] <= b.maxLng

/** Minimum distance between two polylines (0 when they cross). Cheap bounding-box skip keeps long routes fast. */
export function polylineToPolylineM(hazard: LatLng[], route: LatLng[]): NearestOnLine | null {
  if (!hazard.length || !route.length) return null
  if (hazard.length === 1) return nearestOnPolyline(hazard[0], route)
  if (route.length === 1) {
    const n = nearestOnPolyline(route[0], hazard)
    return n ? { distanceM: n.distanceM, point: n.point, alongM: 0 } : null
  }
  const hb = boundsOf(hazard)!
  const ref = hazard[0]
  const proj = projector(ref)
  const hp = hazard.map(proj)
  let best: NearestOnLine | null = null
  let travelled = 0
  for (let i = 0; i < route.length - 1; i++) {
    const a = proj(route[i])
    const b = proj(route[i + 1])
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    // Skip segments clearly farther than the best match found so far.
    const cutoffM = best ? best.distanceM : Infinity
    if (Number.isFinite(cutoffM)) {
      const sb = expandBox(boundsOf([route[i], route[i + 1]])!, cutoffM)
      if (!boxesOverlap(sb, hb)) {
        travelled += segLen
        continue
      }
    }
    for (let j = 0; j < hp.length - 1; j++) {
      const d = distSegSeg(a, b, hp[j], hp[j + 1])
      if (!best || d < best.distanceM) {
        // Report the point on the hazard path nearest the route segment's closest end, for marker placement.
        const nearest = nearestOnPolyline(route[i], [hazard[j], hazard[j + 1]])
        best = { distanceM: d, point: nearest ? nearest.point : hazard[j], alongM: travelled }
      }
    }
    travelled += segLen
  }
  return best
}

export function polylineLengthM(line: LatLng[]): number {
  let total = 0
  for (let i = 0; i < line.length - 1; i++) total += haversineM(line[i], line[i + 1])
  return total
}

/** Ramer-Douglas-Peucker in metres. For DISPLAY geometry only; matching always uses the full geometry. */
export function simplifyPolyline(line: LatLng[], toleranceM: number): LatLng[] {
  if (line.length <= 2) return line.slice()
  const proj = projector(line[0])
  const pts = line.map(proj)
  const keep = new Array<boolean>(line.length).fill(false)
  keep[0] = keep[line.length - 1] = true
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const { d } = distPointSeg(pts[i], pts[s], pts[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = true
      stack.push([s, idx], [idx, e])
    }
  }
  return line.filter((_, i) => keep[i])
}

/**
 * A closed rectangle ring (GeoJSON order: [lng, lat]) of half-width `meters` around each segment of
 * `path`, extended past both ends. Used to ask a routing engine to avoid a closed road. One ring per
 * segment; a single-point path becomes an octagon.
 */
export function bufferPathToRings(path: LatLng[], meters: number): number[][][] {
  const rings: number[][][] = []
  const toLngLat = (ref: LatLng, x: number, y: number): number[] => [
    ref[1] + x / (M_PER_DEG * Math.cos(rad(ref[0]))),
    ref[0] + y / M_PER_DEG,
  ]
  if (path.length === 1) {
    const c = path[0]
    const ring: number[][] = []
    for (let k = 0; k < 8; k++) ring.push(toLngLat(c, Math.cos((k * Math.PI) / 4) * meters, Math.sin((k * Math.PI) / 4) * meters))
    ring.push(ring[0])
    return [ring]
  }
  const proj = projector(path[0])
  for (let i = 0; i < path.length - 1; i++) {
    const a = proj(path[i])
    const b = proj(path[i + 1])
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const ux = (b[0] - a[0]) / len
    const uy = (b[1] - a[1]) / len
    const nx = -uy * meters
    const ny = ux * meters
    const ax = a[0] - ux * meters
    const ay = a[1] - uy * meters
    const bx = b[0] + ux * meters
    const by = b[1] + uy * meters
    const corners: XY[] = [
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ]
    const ring = corners.map(([x, y]) => toLngLat(path[0], x, y))
    ring.push(ring[0])
    rings.push(ring)
  }
  return rings
}
