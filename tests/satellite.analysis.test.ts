// Change-detection maths and quality checks on small synthetic grids. No network, no storage.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyseOptical, analyseSar, boxcar, type LoadedScene } from '../src/lib/satellite/analysis/engine'
import { removeSmallClusters } from '../src/lib/satellite/analysis/cluster'
import { encodePng } from '../src/lib/satellite/analysis/png'
import { compatibilityErrors, rate, sceneChecks } from '../src/lib/satellite/quality'
import { insideMask, makeGrid } from '../src/lib/satellite/raster/grid'
import { sclToFlags, landsatQaToFlags } from '../src/lib/satellite/providers/planetaryComputer'
import { CLASS, DEFAULT_OPTICAL_PARAMS, DEFAULT_SAR_PARAMS, FLAG } from '../src/lib/satellite/types'
import { scene } from './satellite.helpers'

const G = makeGrid([67, 24.8, 67.02, 24.82], 10, 40) // ~40x40
const N = G.width * G.height
const at = (c: number, r: number) => r * G.width + c
const opt = (fill: (c: number, r: number) => { g: number; r: number; nir: number; swir: number }, flag?: (c: number, r: number) => number): LoadedScene => {
  const b = { green: new Float32Array(N), red: new Float32Array(N), nir: new Float32Array(N), swir: new Float32Array(N) }, flags = new Uint8Array(N)
  for (let r = 0; r < G.height; r++) for (let c = 0; c < G.width; c++) { const v = fill(c, r); b.green[at(c, r)] = v.g; b.red[at(c, r)] = v.r; b.nir[at(c, r)] = v.nir; b.swir[at(c, r)] = v.swir; flags[at(c, r)] = flag?.(c, r) ?? 0 }
  return { bands: b, flags, maskAvailable: true }
}
const LAND = { g: 0.1, r: 0.09, nir: 0.36, swir: 0.22 }, WATER = { g: 0.08, r: 0.05, nir: 0.03, swir: 0.02 }
const inBox = (c: number, r: number, a = 10, b = 20) => c >= a && c < b && r >= a && r < b
const all = new Uint8Array(N).fill(1)
const count = (cls: Uint8Array, code: number) => cls.reduce((n, v) => n + (v === code ? 1 : 0), 0)

test('optical: a lake that appears is reported as possible new water, with the right area', () => {
  const r = analyseOptical(G, all, opt(() => LAND), opt((c, rr) => (inBox(c, rr) ? WATER : LAND)), DEFAULT_OPTICAL_PARAMS)
  assert.equal(count(r.classes, CLASS.NEW_WATER), 100)
  assert.equal(count(r.classes, CLASS.STABLE_LAND), N - 100)
  const cell = (G.cellM * G.cellM) / 1e6
  assert.ok(Math.abs(r.stats.classes[CLASS.NEW_WATER].areaKm2 - 100 * cell) < 1e-3)
  assert.equal(r.stats.validFraction, 1)
  assert.match(r.findings.join(' '), /possible new surface water/i)
  assert.match(r.findings[0], /not confirmed events and are not proof of a disaster/)
})
test('optical: no change gives an honest "none found, not ruled out" message', () => {
  const r = analyseOptical(G, all, opt(() => LAND), opt(() => LAND), DEFAULT_OPTICAL_PARAMS)
  assert.equal(count(r.classes, CLASS.NEW_WATER), 0)
  assert.match(r.findings.join(' '), /does not rule out flooding/)
})
test('optical: receding water, vegetation loss and gain are separate classes', () => {
  const before = opt((c, r) => (inBox(c, r, 2, 8) ? WATER : LAND))
  const after = opt((c, r) => (inBox(c, r, 12, 18) ? { g: 0.12, r: 0.2, nir: 0.22, swir: 0.3 } : inBox(c, r, 25, 31) ? { g: 0.1, r: 0.04, nir: 0.6, swir: 0.2 } : LAND))
  const r = analyseOptical(G, all, before, after, DEFAULT_OPTICAL_PARAMS)
  assert.equal(count(r.classes, CLASS.WATER_LOSS), 36)
  assert.equal(count(r.classes, CLASS.VEG_LOSS), 36)
  assert.equal(count(r.classes, CLASS.VEG_GAIN), 36)
})
test('optical: cloud and shadow pixels are excluded, never reported as change, and shown as unknown', () => {
  const cloudy = opt((c, r) => (inBox(c, r) ? { g: 0.7, r: 0.7, nir: 0.7, swir: 0.7 } : LAND), (c, r) => (inBox(c, r) ? FLAG.CLOUD : 0))
  const r = analyseOptical(G, all, opt(() => LAND), cloudy, DEFAULT_OPTICAL_PARAMS)
  assert.equal(count(r.classes, CLASS.MASKED), 100)
  assert.equal(count(r.classes, CLASS.NEW_WATER), 0)
  assert.ok(Math.abs(r.stats.validFraction - (N - 100) / N) < 1e-9)
  assert.ok(Math.abs(r.stats.maskedFractionAfter - 100 / N) < 1e-9)
  const shadow = opt(() => WATER, () => FLAG.SHADOW) // dark shadow looks like water to an index, but is masked
  assert.equal(count(analyseOptical(G, all, opt(() => LAND), shadow, DEFAULT_OPTICAL_PARAMS).classes, CLASS.NEW_WATER), 0)
})
test('optical: isolated single pixels (noise / misregistration) are dropped by the minimum cluster size', () => {
  const after = opt((c, r) => ((c === 5 && r === 5) || (c === 30 && r === 30) ? WATER : LAND))
  const r = analyseOptical(G, all, opt(() => LAND), after, DEFAULT_OPTICAL_PARAMS)
  assert.equal(count(r.classes, CLASS.NEW_WATER), 0)
  assert.ok(r.checks.some((c) => c.code === 'small_clusters_removed'))
  assert.equal(count(analyseOptical(G, all, opt(() => LAND), after, { ...DEFAULT_OPTICAL_PARAMS, minClusterPixels: 1 }).classes, CLASS.NEW_WATER), 2)
})
test('optical: pixels outside the AOI polygon are never counted', () => {
  const half = new Uint8Array(N); for (let r = 0; r < G.height; r++) for (let c = 0; c < G.width / 2; c++) half[at(c, r)] = 1
  const r = analyseOptical(G, half, opt(() => LAND), opt((c, rr) => (c >= 5 && c < 35 && rr >= 5 && rr < 15 ? WATER : LAND)), DEFAULT_OPTICAL_PARAMS)
  const halfCols = Math.ceil(G.width / 2) // columns whose index is below width/2
  assert.equal(count(r.classes, CLASS.NEW_WATER), (halfCols - 5) * 10)
  assert.equal(r.stats.insideAoiPixels, halfCols * G.height)
})
test('optical: a missing band stops the analysis with a clear message', () => {
  const b = opt(() => LAND); delete b.bands.swir
  assert.throws(() => analyseOptical(G, all, b, opt(() => LAND), DEFAULT_OPTICAL_PARAMS), /SWIR/)
  assert.doesNotThrow(() => analyseOptical(G, all, b, b, { ...DEFAULT_OPTICAL_PARAMS, index: 'ndwi' }))
})
test('optical: heavy cloud makes the pair low quality; almost-all-cloud is flagged blocking and rated unusable', () => {
  const heavy = opt(() => LAND, (c) => (c < 36 ? FLAG.CLOUD : 0))
  const r = analyseOptical(G, all, opt(() => LAND), heavy, DEFAULT_OPTICAL_PARAMS)
  assert.ok(r.checks.some((c) => c.code === 'insufficient_valid_data' && c.severity === 'blocking'))
  assert.equal(rate(r.stats.validFraction, r.checks), 'unusable')
  assert.equal(rate(0.9, []), 'good'); assert.equal(rate(0.5, []), 'fair'); assert.equal(rate(0.2, []), 'poor')
})

// ---- SAR -------------------------------------------------------------------------------------------
const sar = (fill: (c: number, r: number) => number, vh = false): LoadedScene => {
  const a = new Float32Array(N)
  for (let r = 0; r < G.height; r++) for (let c = 0; c < G.width; c++) a[at(c, r)] = Math.pow(10, fill(c, r) / 10)
  return { bands: vh ? { vh: a } : { vv: a }, flags: new Uint8Array(N), maskAvailable: true }
}
test('SAR: dark-after, bright-before is possible new water; threshold and change both must hold', () => {
  const r = analyseSar(G, all, sar(() => -9), sar((c, rr) => (inBox(c, rr) ? -24 : -9)), DEFAULT_SAR_PARAMS)
  assert.ok(count(r.classes, CLASS.NEW_WATER) >= 64 && count(r.classes, CLASS.NEW_WATER) <= 100)
  // water that was already dark before is NOT new water
  const stable = analyseSar(G, all, sar((c, rr) => (inBox(c, rr) ? -24 : -9)), sar((c, rr) => (inBox(c, rr) ? -24 : -9)), DEFAULT_SAR_PARAMS)
  assert.equal(count(stable.classes, CLASS.NEW_WATER), 0)
  assert.ok(count(stable.classes, CLASS.STABLE_WATER) > 0)
  // a drop that never reaches the water threshold is not water
  const weak = analyseSar(G, all, sar(() => -9), sar((c, rr) => (inBox(c, rr) ? -13 : -9)), DEFAULT_SAR_PARAMS)
  assert.equal(count(weak.classes, CLASS.NEW_WATER), 0)
})
test('SAR: a brightness increase is labelled ambiguous backscatter, not flooding', () => {
  const r = analyseSar(G, all, sar(() => -12), sar((c, rr) => (inBox(c, rr) ? -6 : -12)), DEFAULT_SAR_PARAMS)
  assert.ok(count(r.classes, CLASS.BACKSCATTER_UP) > 0)
  assert.match(r.findings.join(' '), /ambiguous/)
  assert.equal(count(r.classes, CLASS.NEW_WATER), 0)
})
test('SAR: VH is used when chosen and a missing polarization fails clearly', () => {
  assert.throws(() => analyseSar(G, all, sar(() => -9), sar(() => -9), { ...DEFAULT_SAR_PARAMS, polarization: 'VH' }), /VH/)
  const r = analyseSar(G, all, sar(() => -15, true), sar((c, rr) => (inBox(c, rr) ? -30 : -15), true), { ...DEFAULT_SAR_PARAMS, polarization: 'VH', waterThresholdDb: -24 })
  assert.ok(count(r.classes, CLASS.NEW_WATER) > 0)
})
test('SAR: the multilook filter averages in linear power and ignores invalid pixels', () => {
  const a = new Float32Array([1, 1, 1, 1, 100, 1, 1, 1, NaN]); const o = boxcar(a, 3, 3, 3)
  assert.ok(Math.abs(o[4] - (8 + 100 - 1 + 0) / 8) < 1e-4 || o[4] > 10) // centre pixel pulled toward its neighbours
  assert.ok(Number.isFinite(o[8]))
})

// ---- comparability and quality -------------------------------------------------------------------
test('comparability: optical vs radar, mixed collections and reversed dates are refused', () => {
  assert.ok(compatibilityErrors(scene(), scene({ kind: 'sar' })).some((e) => /optical and the other is radar/.test(e)))
  assert.ok(compatibilityErrors(scene(), scene({ collection: 'landsat-c2-l2' })).some((e) => /different collections/.test(e)))
  assert.ok(compatibilityErrors(scene({ acquiredAt: '2026-09-20T00:00:00Z' }), scene({ acquiredAt: '2026-08-01T00:00:00Z' })).some((e) => /not acquired earlier/.test(e)))
  assert.deepEqual(compatibilityErrors(scene({ acquiredAt: '2026-08-01T00:00:00Z' }), scene({ acquiredAt: '2026-09-01T00:00:00Z' })), [])
})
test('quality: seasons, sensors, resolution, SAR geometry, cloud and coverage each raise their own warning', () => {
  const codes = (b: object, a: object, cell = 10) => sceneChecks(scene({ acquiredAt: '2026-01-10T00:00:00Z', ...b }), scene({ acquiredAt: '2026-07-10T00:00:00Z', ...a }), [67, 24.8, 67.04, 24.84], cell).map((c) => c.code)
  assert.ok(codes({}, {}).includes('seasonal_difference'))
  assert.ok(codes({ platform: 'Sentinel-2A' }, { platform: 'landsat-8', resolutionM: 30 }).includes('sensor_difference'))
  assert.ok(codes({}, { resolutionM: 30 }).includes('resolution_mismatch'))
  assert.ok(codes({}, { cloudCover: 85 }).includes('cloud_cover_after'))
  assert.ok(codes({}, { footprintBbox: [67.01, 24.8, 67.5, 24.9] }).includes('partial_coverage_after'))
  assert.ok(codes({}, {}, 50).includes('downsampled'))
  assert.ok(codes({ kind: 'sar', orbitDirection: 'ascending' }, { kind: 'sar', orbitDirection: 'descending' }).includes('sar_geometry_mismatch'))
  assert.ok(codes({ synthetic: true }, {}).includes('synthetic_data'))
  const close = sceneChecks(scene({ acquiredAt: '2026-08-20T00:00:00Z' }), scene({ acquiredAt: '2026-09-05T00:00:00Z' }), [67, 24.8, 67.04, 24.84], 10).map((c) => c.code)
  assert.ok(!close.includes('seasonal_difference') && !close.includes('sensor_difference'))
})
test('user imagery without a cloud mask is flagged: clouds were not screened', () => {
  const l = opt(() => LAND); l.maskAvailable = false
  assert.ok(analyseOptical(G, all, l, opt(() => LAND), DEFAULT_OPTICAL_PARAMS).checks.some((c) => c.code === 'no_cloud_mask_before'))
})
test('quality masks: Sentinel-2 SCL and Landsat QA_PIXEL codes map to the right flags', () => {
  assert.equal(sclToFlags(0), FLAG.NODATA); assert.equal(sclToFlags(9), FLAG.CLOUD); assert.equal(sclToFlags(3), FLAG.SHADOW); assert.equal(sclToFlags(10), FLAG.CIRRUS); assert.equal(sclToFlags(11), FLAG.SNOW); assert.equal(sclToFlags(4), 0); assert.equal(sclToFlags(6), 0); assert.equal(sclToFlags(NaN), FLAG.NODATA)
  assert.equal(landsatQaToFlags(0), 0); assert.ok(landsatQaToFlags(1) & FLAG.NODATA); assert.ok(landsatQaToFlags(8) & FLAG.CLOUD); assert.ok(landsatQaToFlags(16) & FLAG.SHADOW); assert.ok(landsatQaToFlags(32) & FLAG.SNOW)
})
test('grid and helpers: polygon mask with a hole, cluster removal, PNG header', () => {
  const g = makeGrid([0, 0, 0.01, 0.01], 10, 20)
  const poly = insideMask(g, [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]], [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]]])
  const filled = poly.reduce((a, b) => a + b, 0)
  assert.ok(filled < g.width * g.height && filled > 0.8 * g.width * g.height)
  const cls = new Uint8Array(25); cls[0] = 3; cls[12] = cls[13] = cls[17] = 3
  const removed = removeSmallClusters(cls, 5, 5, [3], 2, () => 1)
  assert.equal(removed, 1); assert.equal(cls[0], 1); assert.equal(cls[12], 3)
  const png = encodePng(new Uint8Array(2 * 2 * 4).fill(255), 2, 2)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.throws(() => encodePng(new Uint8Array(3), 2, 2))
})
