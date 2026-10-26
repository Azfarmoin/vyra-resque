// The calculation core. Three deliberately simple methods, each named for what it really is:
//   uniformOverlay   : the same depth everywhere in the area (no terrain)
//   bathtub          : depth = water level - ground height, optionally only where water can connect to a source point
//   rainfallPonding  : a rainfall volume poured into the LOWEST ground first (no flow routing)
// None of these is a hydraulic model. Depth is metres; NaN means "not assessed" (outside the area, or no terrain data).
import { cellOf, type GridSpec } from './geo'
import { bandIndexFor, DEPTH_BANDS, type DepthBand, type LatLng, type ScenarioSummary } from './types'

export interface DepthResult {
  depth: Float32Array
  warnings: string[]
  /** Extra numbers a method wants to report (water level used, volume, effective rainfall). */
  info: Record<string, number>
}

const notAssessed = (n: number) => new Float32Array(n).fill(NaN)

export function uniformOverlay(mask: Uint8Array, depthM: number): DepthResult {
  const depth = notAssessed(mask.length)
  for (let i = 0; i < mask.length; i++) if (mask[i]) depth[i] = depthM
  return { depth, warnings: [], info: { depthM } }
}

/**
 * Bathtub. With connectivity 'seeded', water starts at the source cells and spreads only through 8-connected cells that are
 * lower than the water level; low ground behind a rise is NOT flooded. With 'none', every cell below the level floods, which
 * over-states flooding wherever low ground is not actually connected to the source.
 */
export function bathtub(z: Float32Array, mask: Uint8Array, spec: GridSpec, opt: { waterLevelM: number; connectivity: 'none' | 'seeded'; seeds: LatLng[] }): DepthResult {
  const { nx, ny } = spec
  const n = nx * ny
  const depth = notAssessed(n)
  const warnings: string[] = []
  const level = opt.waterLevelM
  const wet = new Uint8Array(n)

  if (opt.connectivity === 'none') {
    for (let i = 0; i < n; i++) if (Number.isFinite(z[i]) && z[i] < level) wet[i] = 1
  } else {
    const queue = new Int32Array(n)
    let head = 0
    let tail = 0
    let usable = 0
    for (const [lat, lng] of opt.seeds) {
      const c = cellOf(spec, lat, lng)
      if (!c) { warnings.push(`A source point (${lat.toFixed(4)}, ${lng.toFixed(4)}) is outside the working grid and was ignored.`); continue }
      const idx = c.row * nx + c.col
      if (!Number.isFinite(z[idx])) { warnings.push(`There is no terrain data at source point (${lat.toFixed(4)}, ${lng.toFixed(4)}); it was ignored.`); continue }
      if (!(z[idx] < level)) { warnings.push(`Source point (${lat.toFixed(4)}, ${lng.toFixed(4)}) stands at ${z[idx].toFixed(1)} m, not below the water level of ${level} m, so no water starts there.`); continue }
      if (!wet[idx]) { wet[idx] = 1; queue[tail++] = idx; usable++ }
    }
    if (usable === 0) warnings.push('No usable source point: nothing floods. Place a source point on ground lower than the water level.')
    while (head < tail) {
      const idx = queue[head++]
      const r = (idx / nx) | 0
      const c = idx - r * nx
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        if (rr < 0 || rr >= ny) continue
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const cc = c + dc
          if (cc < 0 || cc >= nx) continue
          const j = rr * nx + cc
          if (!wet[j] && Number.isFinite(z[j]) && z[j] < level) { wet[j] = 1; queue[tail++] = j }
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    depth[i] = !Number.isFinite(z[i]) ? NaN : wet[i] ? level - z[i] : 0
  }
  return { depth, warnings, info: { waterLevelM: level } }
}

/**
 * Rainfall ponding. effective rain = rain x runoff coefficient - drainage capacity - infiltration (never below 0). That depth
 * over the area is a volume, which is poured into the lowest assessed cells first by finding the single water level L with
 * sum(max(0, L - z) x cell area) = volume. Water is assumed to redistribute freely inside the area and nothing enters or leaves.
 */
export function rainfallPonding(z: Float32Array, mask: Uint8Array, spec: GridSpec, opt: { rainfallMm: number; runoffCoefficient: number; drainageCapacityMm: number; infiltrationMm: number }): DepthResult {
  const n = spec.nx * spec.ny
  const depth = notAssessed(n)
  const effectiveMm = Math.max(0, opt.rainfallMm * opt.runoffCoefficient - opt.drainageCapacityMm - opt.infiltrationMm)
  const cellArea = spec.cellWM * spec.cellHM
  const heights: number[] = []
  for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(z[i])) heights.push(z[i])
  const warnings: string[] = []
  for (let i = 0; i < n; i++) if (mask[i]) depth[i] = Number.isFinite(z[i]) ? 0 : NaN
  if (!heights.length) return { depth, warnings: ['There is no terrain data inside the area.'], info: { effectiveMm, volumeM3: 0, waterLevelM: NaN } }
  const volume = (effectiveMm / 1000) * cellArea * heights.length // spread over the assessed cells
  if (effectiveMm === 0) {
    warnings.push('After runoff, drainage and infiltration no rainfall is left to pond, so nothing floods in this run.')
    return { depth, warnings, info: { effectiveMm, volumeM3: 0, waterLevelM: NaN } }
  }
  heights.sort((a, b) => a - b)
  // Walk up through the sorted heights: with k cells under water at level L the stored volume is (k L - sum z) x A.
  let sum = 0
  let level = heights[0]
  for (let k = 1; k <= heights.length; k++) {
    sum += heights[k - 1]
    const nextH = k < heights.length ? heights[k] : Infinity
    const L = (volume / cellArea + sum) / k
    if (L <= nextH) { level = L; break }
    level = L
  }
  for (let i = 0; i < n; i++) if (mask[i] && Number.isFinite(z[i])) depth[i] = Math.max(0, level - z[i])
  return { depth, warnings, info: { effectiveMm, volumeM3: volume, waterLevelM: level } }
}

export function summarise(depth: Float32Array, spec: GridSpec | null, maskCells: number, minDepthM: number, bands: DepthBand[] = DEPTH_BANDS): Omit<ScenarioSummary, 'areaKm2' | 'unassessedFraction'> & { assessedCells: number } {
  let assessed = 0
  let flooded = 0
  let max = 0
  let sum = 0
  let volume = 0
  const cellKm2 = spec ? (spec.cellWM * spec.cellHM) / 1e6 : 0
  const bandCells = bands.map(() => 0)
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]
    if (!Number.isFinite(d)) continue
    assessed++
    if (d >= minDepthM) {
      flooded++
      sum += d
      volume += d * (spec ? spec.cellWM * spec.cellHM : 0)
      if (d > max) max = d
      const b = bandIndexFor(d, bands)
      if (b >= 0) bandCells[b]++
    }
  }
  const bandAreasKm2: Record<string, number> = {}
  bands.forEach((b, i) => (bandAreasKm2[b.id] = round(bandCells[i] * cellKm2, 4)))
  void maskCells
  return {
    assessedAreaKm2: round(assessed * cellKm2, 4),
    floodedAreaKm2: round(flooded * cellKm2, 4),
    floodedFractionOfAssessed: assessed ? round(flooded / assessed, 4) : 0,
    maxDepthM: flooded ? round(max, 2) : null,
    meanDepthM: flooded ? round(sum / flooded, 2) : null,
    volumeM3: flooded ? Math.round(volume) : null,
    bandAreasKm2,
    cellSizeM: spec ? round(Math.sqrt(spec.cellWM * spec.cellHM), 1) : null,
    cells: spec ? spec.nx * spec.ny : null,
    assessedCells: assessed,
  }
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
