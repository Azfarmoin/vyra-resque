// Scene-level quality and comparability checks. These run before any pixel is analysed and explain, in plain
// language, why two images may not be directly comparable (clouds, seasons, sensors, geometry, resolution).
import type { Bbox, QualityCheck, QualityRating, SceneMeta } from './types'

export class AnalysisError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message) }
}

const family = (platform: string): string => {
  const p = platform.toLowerCase()
  const s = /sentinel[-_ ]?([12])/.exec(p)
  if (s) return `sentinel-${s[1]}`
  if (/landsat/.test(p)) return 'landsat'
  return p.trim()
}
const dayOfYear = (iso: string) => { const d = new Date(iso); return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000) }

/** Hard stops: these pairs cannot be compared at all. */
export function compatibilityErrors(before: SceneMeta, after: SceneMeta): string[] {
  const errors: string[] = []
  if (before.kind !== after.kind) errors.push('One scene is optical and the other is radar. Pick two scenes from the same kind of sensor.')
  if (before.collection !== after.collection) errors.push('The two scenes come from different collections. Compare scenes from the same collection.')
  if (Date.parse(before.acquiredAt) >= Date.parse(after.acquiredAt)) errors.push('The "before" scene was not acquired earlier than the "after" scene.')
  return errors
}

const covers = (f: Bbox | null, a: Bbox) => !f || (f[0] <= a[0] && f[1] <= a[1] && f[2] >= a[2] && f[3] >= a[3])

export function sceneChecks(before: SceneMeta, after: SceneMeta, aoi: Bbox, cellM: number): QualityCheck[] {
  const c: QualityCheck[] = []
  for (const [label, s] of [['before', before], ['after', after]] as const) {
    if (s.cloudCover != null) {
      if (s.cloudCover > 60) c.push({ code: `cloud_cover_${label}`, severity: 'warning', value: s.cloudCover, message: `The ${label} scene is ${Math.round(s.cloudCover)}% cloudy over its whole tile. Cloudy pixels are excluded, so results cover only what was visible.` })
      else if (s.cloudCover > 25) c.push({ code: `cloud_cover_${label}`, severity: 'info', value: s.cloudCover, message: `The ${label} scene is ${Math.round(s.cloudCover)}% cloudy over its tile.` })
    } else if (s.kind === 'optical') c.push({ code: `cloud_cover_unknown_${label}`, severity: 'info', value: null, message: `No scene-level cloud cover was provided for the ${label} image.` })
    if (!covers(s.footprintBbox, aoi)) c.push({ code: `partial_coverage_${label}`, severity: 'warning', message: `The ${label} scene does not cover the whole area of interest. Uncovered pixels are excluded.` })
    if (s.synthetic) c.push({ code: 'synthetic_data', severity: 'warning', message: 'DEMONSTRATION DATA: this scene is synthetic and does not show the real world.' })
    if (s.declaredByUser) c.push({ code: `declared_metadata_${label}`, severity: 'info', message: `The ${label} image's date, platform and sensor type were declared by the uploader and cannot be checked by VYRA.` })
  }
  if (family(before.platform) !== family(after.platform)) c.push({ code: 'sensor_difference', severity: 'warning', value: `${before.platform} / ${after.platform}`, message: `Different sensors (${before.platform} and ${after.platform}) respond differently to the same surface. Differences in calibration and bands can look like change.` })
  const ratio = Math.max(before.resolutionM, after.resolutionM) / Math.min(before.resolutionM, after.resolutionM)
  if (ratio >= 2) c.push({ code: 'resolution_mismatch', severity: 'warning', value: ratio, message: `The scenes have different resolutions (${before.resolutionM} m and ${after.resolutionM} m). The finer image is resampled to the coarser one, so small features may be missed.` })
  const doyDiff = Math.abs(dayOfYear(before.acquiredAt) - dayOfYear(after.acquiredAt)), seasonal = Math.min(doyDiff, 365 - doyDiff)
  if (seasonal > 45) c.push({ code: 'seasonal_difference', severity: 'warning', value: seasonal, message: `The scenes are about ${seasonal} days apart in the seasonal cycle. Crops, foliage, snow and seasonal water bodies change without any disaster. Prefer a baseline from the same time of year.` })
  const gapDays = (Date.parse(after.acquiredAt) - Date.parse(before.acquiredAt)) / 86_400_000
  if (gapDays > 365) c.push({ code: 'long_gap', severity: 'info', value: Math.round(gapDays), message: `The scenes are ${Math.round(gapDays)} days apart, so long-term land change is mixed in with any sudden change.` })
  if (before.kind === 'sar') {
    if (before.orbitDirection && after.orbitDirection && before.orbitDirection !== after.orbitDirection) c.push({ code: 'sar_geometry_mismatch', severity: 'warning', message: 'The radar scenes were taken from opposite orbit directions (ascending vs descending). Shadow, layover and building effects differ, which creates false changes.' })
    else if (before.relativeOrbit != null && after.relativeOrbit != null && before.relativeOrbit !== after.relativeOrbit) c.push({ code: 'sar_geometry_mismatch', severity: 'warning', message: `The radar scenes use different relative orbits (${before.relativeOrbit} and ${after.relativeOrbit}), so look angles differ.` })
    else if (!before.orbitDirection || !after.orbitDirection) c.push({ code: 'sar_geometry_unknown', severity: 'info', message: 'The orbit geometry of the radar scenes is not known, so matching viewing geometry could not be checked.' })
  }
  if (cellM > 2 * Math.max(before.resolutionM, after.resolutionM)) c.push({ code: 'downsampled', severity: 'info', value: Math.round(cellM), message: `The area is large, so analysis runs at about ${Math.round(cellM)} m per pixel instead of the sources' ${Math.max(before.resolutionM, after.resolutionM)} m. Narrow features such as small streams can disappear.` })
  return c
}

/** good: usable and few caveats | fair | poor: treat results with great caution | unusable: do not use. */
export function rate(validFraction: number, checks: QualityCheck[]): QualityRating {
  let level = validFraction < 0.1 ? 3 : validFraction < 0.4 ? 2 : validFraction < 0.75 ? 1 : 0
  if (checks.filter((x) => x.severity === 'warning').length >= 3) level = Math.min(2, level + 1)
  if (checks.some((x) => x.severity === 'blocking')) level = 3
  return (['good', 'fair', 'poor', 'unusable'] as const)[level]
}
