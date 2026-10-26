// Geometry helpers for zones. All coordinates are GeoJSON [lng, lat]. No dependencies.
import type { BBox, Position, ZoneGeometry } from './types'

export const MAX_VERTICES = 20000
const MAX_RADIUS_M = 200_000

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
export const isPosition = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]) && p[0] >= -180 && p[0] <= 180 && p[1] >= -90 && p[1] <= 90

const samePos = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1]

function cross(o: Position, a: Position, b: Position) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}
function segmentsCross(a: Position, b: Position, c: Position, d: Position) {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

// A ring must be closed, have >= 4 positions, no zero-length edges and must not cross itself.
function ringErrors(ring: unknown, label: string): string[] {
  if (!Array.isArray(ring) || ring.length < 4) return [`${label}: a ring needs at least 4 positions (first = last).`]
  if (!ring.every(isPosition)) return [`${label}: every position must be [longitude, latitude] within range.`]
  const r = ring as Position[]
  if (!samePos(r[0], r[r.length - 1])) return [`${label}: ring is not closed.`]
  const errs: string[] = []
  for (let i = 1; i < r.length; i++) if (samePos(r[i - 1], r[i])) { errs.push(`${label}: repeated consecutive position.`); break }
  if (r.length <= 2000 && !errs.length) {
    outer: for (let i = 0; i < r.length - 1; i++) {
      for (let j = i + 2; j < r.length - 1; j++) {
        if (i === 0 && j === r.length - 2) continue // first and last edge share the closing vertex
        if (segmentsCross(r[i], r[i + 1], r[j], r[j + 1])) { errs.push(`${label}: boundary crosses itself.`); break outer }
      }
    }
  }
  return errs
}

export function countVertices(g: ZoneGeometry): number {
  switch (g.type) {
    case 'Point': return 1
    case 'LineString': return g.coordinates.length
    case 'Polygon': return g.coordinates.reduce((n, r) => n + r.length, 0)
    case 'MultiPolygon': return g.coordinates.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0)
  }
}

/** Returns a list of problems; an empty list means the geometry is valid. Never throws. */
export function geometryErrors(g: unknown): string[] {
  if (!g || typeof g !== 'object') return ['Geometry is missing.']
  const geo = g as { type?: unknown; coordinates?: unknown }
  const c = geo.coordinates
  if (!Array.isArray(c)) return ['Geometry has no coordinates.']
  switch (geo.type) {
    case 'Point':
      return isPosition(c) ? [] : ['Point must be [longitude, latitude] within range.']
    case 'LineString':
      if (c.length < 2) return ['A line needs at least 2 positions.']
      if (c.length > MAX_VERTICES) return ['Line has too many positions.']
      return c.every(isPosition) ? [] : ['Every line position must be [longitude, latitude] within range.']
    case 'Polygon': {
      if (!c.length) return ['Polygon has no rings.']
      if (JSON.stringify(c).length > 8_000_000) return ['Polygon is too large.']
      const errs = (c as unknown[]).flatMap((ring, i) => ringErrors(ring, i === 0 ? 'Outer ring' : `Hole ${i}`))
      if (!errs.length && countVertices(g as ZoneGeometry) > MAX_VERTICES) errs.push('Polygon has too many positions.')
      return errs
    }
    case 'MultiPolygon': {
      if (!c.length) return ['MultiPolygon has no polygons.']
      const errs = (c as unknown[][]).flatMap((poly, p) =>
        !Array.isArray(poly) || !poly.length ? [`Polygon ${p + 1} has no rings.`] : poly.flatMap((ring, i) => ringErrors(ring, `Polygon ${p + 1} ${i === 0 ? 'outer ring' : `hole ${i}`}`))
      )
      if (!errs.length && countVertices(g as ZoneGeometry) > MAX_VERTICES) errs.push('MultiPolygon has too many positions.')
      return errs
    }
    default:
      return ['Geometry type must be Point, LineString, Polygon or MultiPolygon.']
  }
}

export const isValidGeometry = (g: unknown): g is ZoneGeometry => geometryErrors(g).length === 0

/** Closes an open polygon ring (drawing tools leave rings open). Does not fix anything else. */
export function closeRing(ring: Position[]): Position[] {
  return ring.length && !samePos(ring[0], ring[ring.length - 1]) ? [...ring, ring[0]] : ring
}

function eachPosition(g: ZoneGeometry, fn: (p: Position) => void) {
  const walk = (x: unknown): void => {
    if (isPosition(x)) return fn(x)
    if (Array.isArray(x)) x.forEach(walk)
  }
  walk(g.coordinates)
}

export function bboxOfGeometry(g: ZoneGeometry): BBox {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90
  eachPosition(g, ([lng, lat]) => {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  })
  return [minLng, minLat, maxLng, maxLat]
}

/** Bounding box of a circle given its centre and radius in metres. */
export function circleBBox(centre: Position, radiusM: number): BBox {
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((centre[1] * Math.PI) / 180)))
  return [Math.max(-180, centre[0] - dLng), Math.max(-90, centre[1] - dLat), Math.min(180, centre[0] + dLng), Math.min(90, centre[1] + dLat)]
}

export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

export function parseBBox(raw: string | null | undefined): BBox | null {
  if (!raw) return null
  const p = raw.split(',').map(Number)
  if (p.length !== 4 || !p.every(isNum)) return null
  const [minLng, minLat, maxLng, maxLat] = p
  if (minLng > maxLng || minLat > maxLat || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null
  return [minLng, minLat, maxLng, maxLat]
}

export function isValidRadius(r: unknown): r is number {
  return isNum(r) && r > 0 && r <= MAX_RADIUS_M
}

// ---- display simplification (the stored source geometry is never modified) ---------------------

function sqSegDist(p: Position, a: Position, b: Position) {
  let [x, y] = a
  let dx = b[0] - x, dy = b[1] - y
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) { x = b[0]; y = b[1] } else if (t > 0) { x += dx * t; y += dy * t }
  }
  dx = p[0] - x; dy = p[1] - y
  return dx * dx + dy * dy
}

// Iterative Douglas-Peucker (no recursion, so very long rings cannot overflow the stack).
function dp(points: Position[], tol: number): Position[] {
  if (points.length <= 2) return points
  const sq = tol * tol
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()!
    let max = sq, idx = -1
    for (let i = first + 1; i < last; i++) {
      const d = sqSegDist(points[i], points[first], points[last])
      if (d > max) { idx = i; max = d }
    }
    if (idx > -1) { keep[idx] = 1; stack.push([first, idx], [idx, last]) }
  }
  return points.filter((_, i) => keep[i])
}

function simplifyRing(ring: Position[], tol: number): Position[] {
  const out = dp(ring, tol)
  // Never collapse a ring below a triangle; fall back to the original so the shape stays valid.
  return out.length >= 4 ? out : ring
}

/** Degrees of simplification tolerance for a Leaflet zoom level (about 1.2 screen pixels). */
export const toleranceForZoom = (zoom: number) => (360 / (256 * 2 ** Math.max(0, Math.min(22, zoom)))) * 1.2

/** Returns a lighter copy for drawing. Only used for display; the authoritative geometry is untouched. */
export function simplifyGeometry(g: ZoneGeometry, tol: number): ZoneGeometry {
  if (tol <= 0 || countVertices(g) < 60) return g
  switch (g.type) {
    case 'Point': return g
    case 'LineString': return { type: 'LineString', coordinates: dp(g.coordinates, tol) }
    case 'Polygon': return { type: 'Polygon', coordinates: g.coordinates.map((r) => simplifyRing(r, tol)) }
    case 'MultiPolygon': return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => simplifyRing(r, tol))) }
  }
}

// ---- measurement and containment ---------------------------------------------------------------

/** Approximate area of a ring in km^2 (local equirectangular projection; fine for zones, not for surveying). */
export function ringAreaKm2(ring: Position[]): number {
  if (ring.length < 4) return 0
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180)
  const kx = 111.32 * Math.cos(lat0), ky = 110.57
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky)
  return Math.abs(a) / 2
}

export function areaKm2(g: ZoneGeometry, radiusM?: number | null): number | null {
  if (g.type === 'Point') return radiusM ? (Math.PI * (radiusM / 1000) ** 2) : null
  if (g.type === 'LineString') return null
  const poly = (rings: Position[][]) => ringAreaKm2(rings[0]) - rings.slice(1).reduce((s, r) => s + ringAreaKm2(r), 0)
  return g.type === 'Polygon' ? poly(g.coordinates) : g.coordinates.reduce((s, p) => s + poly(p), 0)
}

export function lineLengthKm(coords: Position[]): number {
  let km = 0
  for (let i = 1; i < coords.length; i++) km += haversineKm(coords[i - 1], coords[i])
  return km
}

export function haversineKm(a: Position, b: Position) {
  const r = (d: number) => (d * Math.PI) / 180
  const dLat = r(b[1] - a[1]), dLng = r(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[1])) * Math.cos(r(b[1])) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function inRing(pt: Position, ring: Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const inPolygon = (pt: Position, rings: Position[][]) => inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h))

/** Is [lng, lat] inside the zone's area? Lines have no area, so they never contain a point. */
export function pointInZone(pt: Position, g: ZoneGeometry, radiusM?: number | null): boolean {
  if (g.type === 'Point') return !!radiusM && haversineKm(pt, g.coordinates) * 1000 <= radiusM
  if (g.type === 'Polygon') return inPolygon(pt, g.coordinates)
  if (g.type === 'MultiPolygon') return g.coordinates.some((p) => inPolygon(pt, p))
  return false
}

/** Does any vertex of a path fall inside the zone? (A cheap "road passes through" test, not a full intersection.) */
export const pathTouchesZone = (path: Position[], g: ZoneGeometry, radiusM?: number | null) => path.some((p) => pointInZone(p, g, radiusM))

/** A representative [lng, lat] for labels and marker glyphs. */
export function labelPoint(g: ZoneGeometry): Position {
  if (g.type === 'Point') return g.coordinates
  if (g.type === 'LineString') return g.coordinates[Math.floor(g.coordinates.length / 2)]
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates.reduce((best, p) => (ringAreaKm2(p[0]) > ringAreaKm2(best[0]) ? p : best))[0]
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f
  }
  const c: Position = a !== 0 ? [cx / (3 * a), cy / (3 * a)] : [(bboxOfGeometry(g)[0] + bboxOfGeometry(g)[2]) / 2, (bboxOfGeometry(g)[1] + bboxOfGeometry(g)[3]) / 2]
  // A concave polygon's centroid can fall outside it; fall back to the bbox centre of the ring then.
  if (inRing(c, ring)) return c
  const b = bboxOfGeometry(g)
  const mid: Position = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  return inRing(mid, ring) ? mid : ring[0]
}

export const toLatLng = ([lng, lat]: Position): [number, number] => [lat, lng]
