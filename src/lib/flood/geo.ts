// Grid and polygon helpers for the flood engine. Pure geometry on GeoJSON [lng, lat] positions, no dependencies.
// Distances use a local equirectangular approximation (metres per degree of latitude is constant, of longitude shrinks with
// cos(latitude)). Over a city-sized area this is far finer than the accuracy of any elevation model.
import { areaKm2 as zoneAreaKm2, bboxOfGeometry, closeRing, geometryErrors, pointInZone } from '../zones/geometry'
import { KARACHI_BBOX } from './config'
import { FloodError, type AreaGeometry, type BBox, type LatLng, type Position } from './types'

export const M_PER_DEG_LAT = 111_320
export const mPerDegLng = (latDeg: number) => M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)

export const isLat = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90
export const isLng = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180
export const isLatLng = (p: unknown): p is LatLng => Array.isArray(p) && p.length === 2 && isLat(p[0]) && isLng(p[1])

export interface GridSpec {
  bbox: BBox
  nx: number
  ny: number
  dxDeg: number
  dyDeg: number
  cellWM: number
  cellHM: number
}

/** Cells that exactly tile `bbox`. Cell size is at least `targetCellM`, and coarser if needed to stay under `maxCells`. */
export function makeGridSpec(bbox: BBox, targetCellM: number, maxCells: number): GridSpec {
  const [w, s, e, n] = bbox
  const latMid = (s + n) / 2
  const widthM = Math.max(1, (e - w) * mPerDegLng(latMid))
  const heightM = Math.max(1, (n - s) * M_PER_DEG_LAT)
  const cell = Math.max(targetCellM, Math.sqrt((widthM * heightM) / maxCells), 1)
  const nx = Math.max(1, Math.ceil(widthM / cell))
  const ny = Math.max(1, Math.ceil(heightM / cell))
  const dxDeg = (e - w) / nx
  const dyDeg = (n - s) / ny
  return { bbox, nx, ny, dxDeg, dyDeg, cellWM: dxDeg * mPerDegLng(latMid), cellHM: dyDeg * M_PER_DEG_LAT }
}

export const cellCenter = (spec: GridSpec, col: number, row: number): LatLng => [spec.bbox[3] - (row + 0.5) * spec.dyDeg, spec.bbox[0] + (col + 0.5) * spec.dxDeg]

/** Column / row (row 0 = north) of the cell containing the point, or null when outside the grid. */
export function cellOf(spec: GridSpec, lat: number, lng: number): { col: number; row: number } | null {
  const [w, s, e, n] = spec.bbox
  if (!(lng >= w && lng <= e && lat >= s && lat <= n)) return null
  return { col: Math.min(spec.nx - 1, Math.floor((lng - w) / spec.dxDeg)), row: Math.min(spec.ny - 1, Math.floor((n - lat) / spec.dyDeg)) }
}

const polygonsOf = (a: AreaGeometry): Position[][][] => (a.type === 'Polygon' ? [a.coordinates] : a.coordinates)

/** 1 for every cell whose centre lies inside the area (even-odd scanline, holes respected). */
export function rasterizeArea(area: AreaGeometry, spec: GridSpec): Uint8Array {
  const mask = new Uint8Array(spec.nx * spec.ny)
  const [w, , , n] = spec.bbox
  for (const rings of polygonsOf(area)) {
    for (let row = 0; row < spec.ny; row++) {
      const yc = n - (row + 0.5) * spec.dyDeg
      const xs: number[] = []
      for (const ring of rings) {
        for (let k = 0; k < ring.length - 1; k++) {
          const [x1, y1] = ring[k]
          const [x2, y2] = ring[k + 1]
          if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1))
        }
      }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - w) / spec.dxDeg - 0.5))
        const c1 = Math.min(spec.nx - 1, Math.floor((xs[k + 1] - w) / spec.dxDeg - 0.5))
        for (let c = c0; c <= c1; c++) mask[row * spec.nx + c] = 1
      }
    }
  }
  return mask
}

export const pointInArea = (lat: number, lng: number, area: AreaGeometry) => pointInZone([lng, lat], area)

export const areaOfKm2 = (area: AreaGeometry) => zoneAreaKm2(area) ?? 0
export const bboxOfArea = (area: AreaGeometry): BBox => bboxOfGeometry(area)

/** Approximate polygon around a point. `steps` straight edges; the area is within 0.2% of a true circle at 64 steps. */
export function circlePolygon(centre: LatLng, radiusM: number, steps = 64): AreaGeometry {
  const ring: Position[] = []
  const mLng = mPerDegLng(centre[0])
  for (let k = 0; k < steps; k++) {
    const t = (2 * Math.PI * k) / steps
    ring.push([centre[1] + (Math.cos(t) * radiusM) / mLng, centre[0] + (Math.sin(t) * radiusM) / M_PER_DEG_LAT])
  }
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring] }
}

export function rectanglePolygon(bbox: BBox): AreaGeometry {
  const [w, s, e, n] = bbox
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

export const distanceM = (a: LatLng, b: LatLng): number => {
  const dy = (b[0] - a[0]) * M_PER_DEG_LAT
  const dx = (b[1] - a[1]) * mPerDegLng((a[0] + b[0]) / 2)
  return Math.hypot(dx, dy)
}

export const polylineLengthM = (p: LatLng[]): number => {
  let t = 0
  for (let i = 1; i < p.length; i++) t += distanceM(p[i - 1], p[i])
  return t
}

/** Points along a polyline at most `stepM` apart (always includes both ends). */
export function samplePolyline(path: LatLng[], stepM: number): { point: LatLng; segmentM: number }[] {
  const out: { point: LatLng; segmentM: number }[] = []
  if (path.length === 0) return out
  if (path.length === 1) return [{ point: path[0], segmentM: 0 }]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const len = distanceM(a, b)
    if (len === 0) continue
    const k = Math.max(1, Math.ceil(len / stepM))
    for (let j = 0; j < k; j++) {
      // The centre of each sub-segment represents `len / k` metres of road.
      const t = (j + 0.5) / k
      out.push({ point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], segmentM: len / k })
    }
  }
  return out
}

/** Douglas-Peucker in metres, for drawing only. */
export function simplifyPath(path: LatLng[], toleranceM: number): LatLng[] {
  if (path.length <= 2) return path.slice()
  const keep = new Uint8Array(path.length)
  keep[0] = keep[path.length - 1] = 1
  const stack: [number, number][] = [[0, path.length - 1]]
  const lat0 = path[0][0]
  const kx = mPerDegLng(lat0)
  const px = (p: LatLng): [number, number] => [(p[1] - path[0][1]) * kx, (p[0] - lat0) * M_PER_DEG_LAT]
  const pts = path.map(px)
  while (stack.length) {
    const [s, e] = stack.pop()!
    let max = 0
    let idx = -1
    const [ax, ay] = pts[s]
    const [bx, by] = pts[e]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    for (let i = s + 1; i < e; i++) {
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2))
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy))
      if (d > max) { max = d; idx = i }
    }
    if (idx > -1 && max > toleranceM) { keep[idx] = 1; stack.push([s, idx], [idx, e]) }
  }
  return path.filter((_, i) => keep[i])
}

export const bboxesIntersect = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
export const padBBox = (b: BBox, meters: number): BBox => {
  const dLat = meters / M_PER_DEG_LAT
  const dLng = meters / mPerDegLng((b[1] + b[3]) / 2)
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat]
}

export interface AreaCheckOptions {
  maxAreaKm2: number
  allowAnyRegion: boolean
  minAreaKm2?: number
  maxVertices?: number
}

/**
 * Normalises (closes rings) and validates a user supplied area. Throws FloodError with a plain-language message; never
 * returns a geometry that has not been checked for validity, size and region.
 */
export function validateArea(raw: unknown, opt: AreaCheckOptions): { area: AreaGeometry; areaKm2: number; bbox: BBox } {
  if (!raw || typeof raw !== 'object') throw new FloodError('invalid_area', 400, 'Choose or draw an area first.')
  const g = raw as { type?: unknown; coordinates?: unknown }
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') throw new FloodError('invalid_area', 400, 'The area must be a polygon.')
  const closed = (ring: Position[]) => (Array.isArray(ring) ? closeRing(ring) : ring)
  const area = (g.type === 'Polygon'
    ? { type: 'Polygon', coordinates: (g.coordinates as Position[][]).map(closed) }
    : { type: 'MultiPolygon', coordinates: (g.coordinates as Position[][][]).map((p) => p.map(closed)) }) as AreaGeometry

  // Coordinates first: a clear message for the most common mistake (swapped or out-of-range values).
  const flat: unknown[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x) && x.length >= 2 && typeof x[0] === 'number') flat.push(x)
    else if (Array.isArray(x)) x.forEach(walk)
  }
  walk(area.coordinates)
  if (!flat.length) throw new FloodError('invalid_coordinates', 400, 'The area has no coordinates.')
  for (const p of flat as number[][]) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) throw new FloodError('invalid_coordinates', 400, 'The area contains a coordinate that is not a number.')
    if (p[1] < -90 || p[1] > 90) throw new FloodError('invalid_coordinates', 400, `Latitude ${p[1]} is outside -90 to 90. Positions are [longitude, latitude].`)
    if (p[0] < -180 || p[0] > 180) throw new FloodError('invalid_coordinates', 400, `Longitude ${p[0]} is outside -180 to 180.`)
  }
  if (flat.length > (opt.maxVertices ?? 5000)) throw new FloodError('invalid_area', 400, 'The area has too many corners. Draw a simpler outline.')
  const errs = geometryErrors(area)
  if (errs.length) throw new FloodError('invalid_area', 400, `The area is not a valid polygon: ${errs[0]}`, 'Check that the outline does not cross itself.')

  const bbox = bboxOfArea(area)
  if (!opt.allowAnyRegion) {
    const [rw, rs, re, rn] = KARACHI_BBOX
    if (bbox[0] < rw || bbox[1] < rs || bbox[2] > re || bbox[3] > rn) {
      throw new FloodError('outside_region', 422, 'This area is outside the Karachi region the simulator is set up for.', 'Datasets and data-quality checks are Karachi specific. An administrator can lift this limit with FLOOD_ALLOW_ANY_REGION=true.')
    }
  }
  const km2 = areaOfKm2(area)
  if (!(km2 >= (opt.minAreaKm2 ?? 0.01))) throw new FloodError('area_too_small', 422, 'The area is too small (under 0.01 km2). Draw a larger area.')
  if (km2 > opt.maxAreaKm2) throw new FloodError('area_too_large', 422, `The area is ${km2.toFixed(0)} km2, over the ${opt.maxAreaKm2} km2 limit. A larger area would have to be simulated at a resolution too coarse to mean anything.`, 'Choose a smaller area or split it.')
  return { area, areaKm2: km2, bbox }
}
