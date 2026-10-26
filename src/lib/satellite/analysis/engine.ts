// Change detection on two co-registered grids. Pure functions: no network, no storage.
//   optical_water_index_v1   water index (MNDWI or NDWI) per date, plus NDVI change, over pixels that are
//                            clear (no cloud, shadow, cirrus, snow, no-data) on BOTH dates.
//   sar_backscatter_change_v1  boxcar-multilooked backscatter in dB; open water is dark (low return), so
//                            new water = dark after, not dark before, and a clear drop between dates.
// Every result is a CANDIDATE change. The code never labels a change as caused by a disaster.
import { CLASS, CLASS_LABELS, FLAG, type AnalysisStats, type OpticalParams, type QualityCheck, type SarParams } from '../types'
import { cellAreaKm2, type Grid } from '../raster/grid'
import { AnalysisError } from '../quality'
import { removeSmallClusters } from './cluster'
import { renderChangePng, renderOpticalPng, renderSarPng } from './png'

export interface LoadedScene {
  bands: Partial<Record<'blue' | 'green' | 'red' | 'nir' | 'swir' | 'vv' | 'vh', Float32Array>>
  flags: Uint8Array // FLAG bits per pixel; 0 = usable
  maskAvailable: boolean // false when the source had no cloud/quality layer (clouds were NOT screened)
}
export interface EngineResult {
  classes: Uint8Array; stats: AnalysisStats; checks: QualityCheck[]; findings: string[]; limitations: string[]
  images: { before: Buffer; after: Buffer; change: Buffer }
}

const ratio = (a: number, b: number) => (a + b > 1e-9 ? (a - b) / (a + b) : NaN)

function need<T>(v: T | undefined, what: string): T {
  if (!v) throw new AnalysisError('missing_bands', `The imagery does not include the ${what} band this method needs.`)
  return v
}

/** Mean of the linear values in a k×k window, ignoring invalid pixels (reduces speckle before converting to dB). */
export function boxcar(linear: Float32Array, width: number, height: number, k: number): Float32Array {
  if (k <= 1) return linear
  const h = (k - 1) / 2, out = new Float32Array(linear.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0, n = 0
      for (let yy = Math.max(0, y - h); yy <= Math.min(height - 1, y + h); yy++)
        for (let xx = Math.max(0, x - h); xx <= Math.min(width - 1, x + h); xx++) { const v = linear[yy * width + xx]; if (Number.isFinite(v) && v > 0) { sum += v; n++ } }
      out[y * width + x] = n ? sum / n : NaN
    }
  return out
}
const toDb = (lin: Float32Array) => { const o = new Float32Array(lin.length); for (let i = 0; i < lin.length; i++) o[i] = lin[i] > 0 && Number.isFinite(lin[i]) ? 10 * Math.log10(lin[i]) : NaN; return o }

function pearson(a: Float32Array, b: Float32Array, valid: Uint8Array): number | null {
  let n = 0, sa = 0, sb = 0
  for (let i = 0; i < a.length; i++) if (valid[i] && Number.isFinite(a[i]) && Number.isFinite(b[i])) { n++; sa += a[i]; sb += b[i] }
  if (n < 50) return null
  const ma = sa / n, mb = sb / n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < a.length; i++) if (valid[i] && Number.isFinite(a[i]) && Number.isFinite(b[i])) { const da = a[i] - ma, db = b[i] - mb; cov += da * db; va += da * da; vb += db * db }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null
}

function summarise(classes: Uint8Array, inside: Uint8Array, g: Grid, before: LoadedScene, after: LoadedScene, waterB: Uint8Array, waterA: Uint8Array, corr: number | null): AnalysisStats {
  const counts = new Array(8).fill(0)
  let insidePx = 0, maskedB = 0, maskedA = 0, wB = 0, wA = 0
  for (let i = 0; i < classes.length; i++) {
    if (!inside[i]) continue
    insidePx++
    counts[classes[i]]++
    if (before.flags[i]) maskedB++
    if (after.flags[i]) maskedA++
    if (classes[i] !== CLASS.MASKED) { if (waterB[i]) wB++; if (waterA[i]) wA++ }
  }
  const cell = cellAreaKm2(g), valid = insidePx - counts[0]
  const changed = counts[3] + counts[4] + counts[5] + counts[6] + counts[7]
  return {
    gridWidth: g.width, gridHeight: g.height, cellSizeM: Math.round(g.cellM * 10) / 10, insideAoiPixels: insidePx, validPixels: valid, validFraction: insidePx ? valid / insidePx : 0,
    maskedFractionBefore: insidePx ? maskedB / insidePx : 0, maskedFractionAfter: insidePx ? maskedA / insidePx : 0,
    classes: counts.map((pixels, code) => ({ code, label: CLASS_LABELS[code], pixels, areaKm2: Math.round(pixels * cell * 1e4) / 1e4 })),
    waterAreaBeforeKm2: Math.round(wB * cell * 1e4) / 1e4, waterAreaAfterKm2: Math.round(wA * cell * 1e4) / 1e4,
    changedFractionOfValid: valid ? changed / valid : 0, correlation: corr,
  }
}

function describe(stats: AnalysisStats, kind: 'optical' | 'sar'): string[] {
  const by = (c: number) => stats.classes[c], pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`
  const out = ['These are candidate changes between two satellite acquisitions. They are not confirmed events and are not proof of a disaster.']
  out.push(`Usable area: ${pct(stats.validFraction)} of the area of interest was clear on both dates; the rest is excluded and its status is unknown.`)
  if (by(3).pixels) out.push(`${by(3).areaKm2} km² (${by(3).pixels} px) shows possible new surface water. This may be flooding, but also tides, reservoir or irrigation changes, seasonal water, shadow or radar look-alikes.`)
  if (by(4).pixels) out.push(`${by(4).areaKm2} km² shows possible loss of surface water (recession, drying or a different tide/season).`)
  if (by(5).pixels) out.push(`${by(5).areaKm2} km² shows possible vegetation loss (harvest, burning, clearing, flooding or seasonal change are all possible).`)
  if (by(6).pixels) out.push(`${by(6).areaKm2} km² shows possible vegetation gain (typically seasonal growth).`)
  if (by(7).pixels) out.push(`${by(7).areaKm2} km² shows a rise in radar backscatter. This is ambiguous: it can be flooded vegetation or buildings, but also wind, soil moisture or crop change.`)
  if (!by(3).pixels && !by(4).pixels && !by(5).pixels && !by(6).pixels && !by(7).pixels) out.push(`No change above the chosen thresholds was found in the usable area. That does not rule out flooding under cloud${kind === 'optical' ? ', canopy' : ''} or buildings.`)
  return out
}

const OPTICAL_LIMITS = [
  'Water indices mistake shadows, wet soil, burn scars, dark roofs and some wetlands for water, and miss turbid or vegetated floodwater.',
  'Floodwater under dense canopy or cloud cannot be seen in optical imagery.',
  'Two dates a season apart will differ in vegetation and water without any disaster.',
  'Sensor differences, sub-pixel misalignment and resolution limits create false change along edges.',
]
const SAR_LIMITS = [
  'Smooth surfaces other than water (tarmac, dry sand, airstrips) are dark in radar and wind-roughened water can look bright, so water mapping has false alarms and misses.',
  'Flooded vegetation and flooded buildings often get brighter, not darker, and can be missed by the water rule.',
  'Radar shadow and layover in hilly or built-up areas look like change when viewing geometry differs.',
  'Speckle noise remains after the multilook filter; small clusters are removed, which also removes genuinely small changes.',
]

export function analyseOptical(g: Grid, inside: Uint8Array, before: LoadedScene, after: LoadedScene, p: OpticalParams): EngineResult {
  const n = g.width * g.height, useSwir = p.index === 'mndwi'
  const gB = need(before.bands.green, 'green'), gA = need(after.bands.green, 'green')
  const xB = need(useSwir ? before.bands.swir : before.bands.nir, useSwir ? 'shortwave infrared (SWIR)' : 'near infrared'), xA = need(useSwir ? after.bands.swir : after.bands.nir, useSwir ? 'shortwave infrared (SWIR)' : 'near infrared')
  const rB = need(before.bands.red, 'red'), rA = need(after.bands.red, 'red'), nB = need(before.bands.nir, 'near infrared'), nA = need(after.bands.nir, 'near infrared')
  const valid = new Uint8Array(n), waterB = new Uint8Array(n), waterA = new Uint8Array(n)
  const classes = new Uint8Array(n)
  const vegB = new Float32Array(n), vegA = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue
    const iB = ratio(gB[i], xB[i]), iA = ratio(gA[i], xA[i])
    vegB[i] = ratio(nB[i], rB[i]); vegA[i] = ratio(nA[i], rA[i])
    if (before.flags[i] || after.flags[i] || !Number.isFinite(iB) || !Number.isFinite(iA) || !Number.isFinite(vegB[i]) || !Number.isFinite(vegA[i])) { classes[i] = CLASS.MASKED; continue }
    valid[i] = 1
    waterB[i] = iB > p.waterThreshold ? 1 : 0
    waterA[i] = iA > p.waterThreshold ? 1 : 0
    if (waterA[i] && !waterB[i]) classes[i] = CLASS.NEW_WATER
    else if (waterB[i] && !waterA[i]) classes[i] = CLASS.WATER_LOSS
    else if (waterA[i] && waterB[i]) classes[i] = CLASS.STABLE_WATER
    else if (vegB[i] - vegA[i] >= p.ndviDrop && vegB[i] >= 0.3) classes[i] = CLASS.VEG_LOSS
    else if (vegA[i] - vegB[i] >= p.ndviDrop && vegA[i] >= 0.3) classes[i] = CLASS.VEG_GAIN
    else classes[i] = CLASS.STABLE_LAND
  }
  const removed = removeSmallClusters(classes, g.width, g.height, [3, 4, 5, 6], p.minClusterPixels, (i) => (waterA[i] ? CLASS.STABLE_WATER : CLASS.STABLE_LAND))
  const corr = pearson(nB, nA, valid)
  const stats = summarise(classes, inside, g, before, after, waterB, waterA, corr)
  const checks = pixelChecks(stats, removed, before, after)
  return { classes, stats, checks, findings: describe(stats, 'optical'), limitations: OPTICAL_LIMITS, images: { before: renderOpticalPng(rB, gB, before.bands.blue, g.width, g.height, inside), after: renderOpticalPng(rA, gA, after.bands.blue, g.width, g.height, inside), change: renderChangePng(classes, g.width, g.height, inside) } }
}

export function analyseSar(g: Grid, inside: Uint8Array, before: LoadedScene, after: LoadedScene, p: SarParams): EngineResult {
  const n = g.width * g.height, key = p.polarization === 'VV' ? 'vv' : 'vh'
  const linB = need(before.bands[key], p.polarization), linA = need(after.bands[key], p.polarization)
  const dbB = toDb(boxcar(linB, g.width, g.height, p.speckleWindow)), dbA = toDb(boxcar(linA, g.width, g.height, p.speckleWindow))
  const valid = new Uint8Array(n), waterB = new Uint8Array(n), waterA = new Uint8Array(n), classes = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue
    if (before.flags[i] || after.flags[i] || !Number.isFinite(dbB[i]) || !Number.isFinite(dbA[i])) { classes[i] = CLASS.MASKED; continue }
    valid[i] = 1
    waterB[i] = dbB[i] < p.waterThresholdDb ? 1 : 0
    waterA[i] = dbA[i] < p.waterThresholdDb ? 1 : 0
    const diff = dbA[i] - dbB[i]
    if (waterA[i] && !waterB[i] && diff <= -p.changeDb) classes[i] = CLASS.NEW_WATER
    else if (waterB[i] && !waterA[i] && diff >= p.changeDb) classes[i] = CLASS.WATER_LOSS
    else if (waterA[i] && waterB[i]) classes[i] = CLASS.STABLE_WATER
    else if (!waterA[i] && diff >= p.changeDb) classes[i] = CLASS.BACKSCATTER_UP
    else classes[i] = waterA[i] ? CLASS.STABLE_WATER : CLASS.STABLE_LAND
  }
  const removed = removeSmallClusters(classes, g.width, g.height, [3, 4, 7], p.minClusterPixels, (i) => (waterA[i] ? CLASS.STABLE_WATER : CLASS.STABLE_LAND))
  const corr = pearson(dbB, dbA, valid)
  const stats = summarise(classes, inside, g, before, after, waterB, waterA, corr)
  const checks = pixelChecks(stats, removed, before, after)
  return { classes, stats, checks, findings: describe(stats, 'sar'), limitations: SAR_LIMITS, images: { before: renderSarPng(dbB, g.width, g.height, inside), after: renderSarPng(dbA, g.width, g.height, inside), change: renderChangePng(classes, g.width, g.height, inside) } }
}

/** Checks that need the actual pixels: usable fraction, mask coverage, agreement between the dates, filtering. */
function pixelChecks(s: AnalysisStats, removedPx: number, before: LoadedScene, after: LoadedScene): QualityCheck[] {
  const c: QualityCheck[] = []
  const pct = (x: number) => `${Math.round(x * 100)}%`
  if (s.validFraction < 0.1) c.push({ code: 'insufficient_valid_data', severity: 'blocking', value: s.validFraction, message: `Only ${pct(s.validFraction)} of the area was usable on both dates. Do not draw conclusions from this analysis.` })
  else if (s.validFraction < 0.6) c.push({ code: 'low_valid_fraction', severity: 'warning', value: s.validFraction, message: `Only ${pct(s.validFraction)} of the area was clear on both dates (clouds, shadows, no-data). Change outside that area is unknown.` })
  for (const [label, f, sc] of [['before', s.maskedFractionBefore, before], ['after', s.maskedFractionAfter, after]] as const) {
    if (!sc.maskAvailable) c.push({ code: `no_cloud_mask_${label}`, severity: 'warning', message: `The ${label} image has no cloud or quality layer, so clouds and shadows were NOT screened out. Cloud edges and shadows may appear as change.` })
    else if (f > 0.3) c.push({ code: `masked_${label}`, severity: 'warning', value: f, message: `${pct(f)} of the area is cloud, shadow, snow or no-data in the ${label} image.` })
  }
  if (s.correlation != null && s.correlation < 0.3) c.push({ code: 'low_correlation', severity: 'warning', value: Math.round(s.correlation * 100) / 100, message: `The two images agree poorly pixel-for-pixel (correlation ${s.correlation.toFixed(2)}). That happens with severe change, different conditions or misaligned images, and detected changes are less reliable.` })
  if (removedPx > 0) c.push({ code: 'small_clusters_removed', severity: 'info', value: removedPx, message: `${removedPx} pixels in clusters below the minimum size were dropped as likely noise or misregistration.` })
  c.push({ code: 'registration_unverified', severity: 'info', message: 'Both images were placed on one map grid by their embedded geolocation. Residual misalignment of up to about one pixel cannot be measured here and causes false change along edges.' })
  return c
}

export { FLAG }
