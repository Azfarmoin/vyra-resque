// A DepthField answers one question: "how deep is the water at this point?" It hides whether the answer comes from a grid, a
// uniform overlay or imported polygons, so asset intersection code is the same for every scenario kind.
// depthAt returns null when the point is outside what was assessed. null is "unknown", never "dry".
import { deflateSync, inflateSync } from 'node:zlib'
import { cellOf, pointInArea, type GridSpec } from './geo'
import type { AreaGeometry, BBox, DepthFeatureCollection, PackedGrid } from './types'

export interface DepthField {
  kind: 'uniform' | 'grid' | 'polygons'
  depthAt(lat: number, lng: number): number | null
  /** Ground resolution in metres where it has a meaning, else null. */
  resolutionM: number | null
  coverage: BBox
}

export class UniformField implements DepthField {
  kind = 'uniform' as const
  resolutionM = null
  constructor(private area: AreaGeometry, private depthM: number, public coverage: BBox) {}
  depthAt(lat: number, lng: number) {
    return pointInArea(lat, lng, this.area) ? this.depthM : null
  }
}

export class GridField implements DepthField {
  kind = 'grid' as const
  resolutionM: number
  coverage: BBox
  constructor(private spec: GridSpec, private depth: Float32Array) {
    this.resolutionM = Math.round(Math.sqrt(spec.cellWM * spec.cellHM) * 10) / 10
    this.coverage = spec.bbox
  }
  depthAt(lat: number, lng: number) {
    const c = cellOf(this.spec, lat, lng)
    if (!c) return null
    const d = this.depth[c.row * this.spec.nx + c.col]
    return Number.isFinite(d) ? d : null
  }
  get gridSpec() { return this.spec }
  get values() { return this.depth }
}

type Ring = number[][]
interface PolyFeature { bbox: BBox; depth: number; polys: Ring[][] }

const inRing = (x: number, y: number, ring: Ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Imported polygons. Outside the scenario area -> null; inside the area but in no polygon -> 0 (dry in that model output). */
export class PolygonField implements DepthField {
  kind = 'polygons' as const
  resolutionM = null
  private feats: PolyFeature[]
  private buckets = new Map<number, number[]>()
  private nb = 48
  constructor(fc: DepthFeatureCollection, private area: AreaGeometry, public coverage: BBox) {
    this.feats = fc.features.map((f) => {
      const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][]
      let w = 180, s = 90, e = -180, n = -90
      for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y }
      return { bbox: [w, s, e, n] as BBox, depth: f.properties.depth_m, polys }
    })
    // Bucket index so lookups stay fast with thousands of polygons.
    this.feats.forEach((f, idx) => {
      const [c0, r0] = this.bucketOf(f.bbox[0], f.bbox[1])
      const [c1, r1] = this.bucketOf(f.bbox[2], f.bbox[3])
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const k = r * this.nb + c; const l = this.buckets.get(k); if (l) l.push(idx); else this.buckets.set(k, [idx]) }
    })
  }
  private bucketOf(lng: number, lat: number): [number, number] {
    const [w, s, e, n] = this.coverage
    const c = Math.min(this.nb - 1, Math.max(0, Math.floor(((lng - w) / (e - w || 1)) * this.nb)))
    const r = Math.min(this.nb - 1, Math.max(0, Math.floor(((lat - s) / (n - s || 1)) * this.nb)))
    return [c, r]
  }
  depthAt(lat: number, lng: number) {
    if (!pointInArea(lat, lng, this.area)) return null
    let best = 0
    const [bc, br] = this.bucketOf(lng, lat)
    for (const idx of this.buckets.get(br * this.nb + bc) ?? []) {
      const f = this.feats[idx]
      if (lng < f.bbox[0] || lng > f.bbox[2] || lat < f.bbox[1] || lat > f.bbox[3]) continue
      if (f.depth <= best) continue
      if (f.polys.some((p) => inRing(lng, lat, p[0]) && !p.slice(1).some((h) => inRing(lng, lat, h)))) best = f.depth
    }
    return best
  }
}

// ---- packing a depth grid for storage --------------------------------------------------------------------------------

export function packGrid(spec: GridSpec, depth: Float32Array): PackedGrid {
  const u16 = new Uint16Array(depth.length)
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]
    u16[i] = Number.isFinite(d) ? Math.min(65534, Math.max(0, Math.round(d * 100))) : 65535
  }
  const data = deflateSync(Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength)).toString('base64')
  return { bbox: spec.bbox, nx: spec.nx, ny: spec.ny, cellWM: spec.cellWM, cellHM: spec.cellHM, encoding: 'u16-cm+deflate+base64', data }
}

export function unpackGrid(p: PackedGrid): { spec: GridSpec; depth: Float32Array } {
  if (p.encoding !== 'u16-cm+deflate+base64') throw new Error('Unknown grid encoding')
  const raw = inflateSync(Buffer.from(p.data, 'base64'))
  const u16 = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  if (u16.length !== p.nx * p.ny) throw new Error('Stored grid has the wrong size')
  const depth = new Float32Array(u16.length)
  for (let i = 0; i < u16.length; i++) depth[i] = u16[i] === 65535 ? NaN : u16[i] / 100
  return { spec: { bbox: p.bbox, nx: p.nx, ny: p.ny, dxDeg: (p.bbox[2] - p.bbox[0]) / p.nx, dyDeg: (p.bbox[3] - p.bbox[1]) / p.ny, cellWM: p.cellWM, cellHM: p.cellHM }, depth }
}

/** Merge flooded cells into rectangles per depth band (row runs, then vertical merge). For reports and GeoJSON export. */
export function gridToBandRects(spec: GridSpec, depth: Float32Array, bandIndex: (d: number) => number): { band: number; col0: number; col1: number; row0: number; row1: number }[] {
  const out: { band: number; col0: number; col1: number; row0: number; row1: number }[] = []
  let open = new Map<string, { band: number; col0: number; col1: number; row0: number; row1: number }>()
  for (let r = 0; r < spec.ny; r++) {
    const next = new Map<string, { band: number; col0: number; col1: number; row0: number; row1: number }>()
    let c = 0
    while (c < spec.nx) {
      const d = depth[r * spec.nx + c]
      const b = Number.isFinite(d) ? bandIndex(d) : -1
      if (b < 0) { c++; continue }
      let c1 = c
      while (c1 + 1 < spec.nx) {
        const d2 = depth[r * spec.nx + c1 + 1]
        if ((Number.isFinite(d2) ? bandIndex(d2) : -1) !== b) break
        c1++
      }
      const key = `${b}:${c}:${c1}`
      const prev = open.get(key)
      if (prev) { prev.row1 = r; next.set(key, prev); open.delete(key) } else next.set(key, { band: b, col0: c, col1: c1, row0: r, row1: r })
      c = c1 + 1
    }
    for (const done of open.values()) out.push(done)
    open = next
  }
  for (const done of open.values()) out.push(done)
  return out
}
