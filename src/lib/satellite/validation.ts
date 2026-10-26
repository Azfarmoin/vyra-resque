// Input validation for satellite requests: calendar dates, ranges, area of interest, parameters.
import { COLLECTIONS, COLLECTION_EARLIEST, DEFAULT_OPTICAL_PARAMS, DEFAULT_SAR_PARAMS, type AoiInput, type Bbox, type CollectionId, type DateRange, type OpticalParams, type SarParams } from './types'

export const limits = () => ({
  maxRangeDays: Number(process.env.SATELLITE_MAX_RANGE_DAYS) || 45,
  maxAoiKm2: Number(process.env.SATELLITE_MAX_AOI_KM2) || 400,
  minAoiKm2: 0.05,
  maxGrid: Math.min(1024, Number(process.env.SATELLITE_MAX_GRID) || 640),
  maxUploadBytes: (Number(process.env.SATELLITE_MAX_UPLOAD_MB) || 40) * 1024 * 1024,
})

const DAY_MS = 86_400_000

/** Strict YYYY-MM-DD that is a real calendar day (2024-02-30 is rejected, not rolled over). */
export function parseDay(s: unknown): number | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = Date.parse(`${s}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 10) === s ? t : null
}

export function validateRange(label: string, r: unknown, collection: CollectionId, now: number, maxDays: number): string[] {
  const errors: string[] = []
  const o = (r ?? {}) as Partial<DateRange>
  const start = parseDay(o.start), end = parseDay(o.end)
  if (start == null) errors.push(`${label}: start date must be a real date in YYYY-MM-DD format.`)
  if (end == null) errors.push(`${label}: end date must be a real date in YYYY-MM-DD format.`)
  if (start == null || end == null) return errors
  if (start > end) errors.push(`${label}: the start date is after the end date.`)
  const todayUtc = Math.floor(now / DAY_MS) * DAY_MS
  if (end > todayUtc) errors.push(`${label}: the end date is in the future.`)
  const earliest = Date.parse(`${COLLECTION_EARLIEST[collection]}T00:00:00Z`)
  if (start < earliest) errors.push(`${label}: this collection has no imagery before ${COLLECTION_EARLIEST[collection]}.`)
  if (start <= end && (end - start) / DAY_MS + 1 > maxDays) errors.push(`${label}: the range is longer than ${maxDays} days. Use a shorter window.`)
  return errors
}

/** Both ranges, plus the rule that the "before" period must end before the "after" period starts. */
export function validateRanges(before: unknown, after: unknown, collection: CollectionId, now = Date.now(), maxDays = limits().maxRangeDays): string[] {
  const errors = [...validateRange('Before range', before, collection, now, maxDays), ...validateRange('After range', after, collection, now, maxDays)]
  const b = before as DateRange, a = after as DateRange
  const be = parseDay(b?.end), as = parseDay(a?.start)
  if (be != null && as != null && be >= as) errors.push('The before period must end before the after period starts. Overlapping or reversed periods cannot show change.')
  return errors
}

export function validateCollection(c: unknown): c is CollectionId {
  return typeof c === 'string' && (COLLECTIONS as readonly string[]).includes(c)
}

// ---- area of interest ---------------------------------------------------------------------------
const inRange = (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90

export function bboxAreaKm2(b: Bbox): number {
  const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180)
  return Math.abs(b[2] - b[0]) * 111.32 * Math.cos(midLat) * Math.abs(b[3] - b[1]) * 110.574
}

export interface AoiOk { ok: true; bbox: Bbox; polygon: number[][][] | null; areaKm2: number }
export function validateAoi(aoi: unknown, { maxKm2 = limits().maxAoiKm2, minKm2 = limits().minAoiKm2 } = {}): AoiOk | { ok: false; errors: string[] } {
  const errors: string[] = []
  const a = aoi as AoiInput | null
  let bbox: Bbox | null = null
  let polygon: number[][][] | null = null
  if (!a || typeof a !== 'object') return { ok: false, errors: ['Choose an area of interest on the map.'] }
  if (a.type === 'bbox') {
    const b = a.bbox
    if (!Array.isArray(b) || b.length !== 4 || b.some((n) => typeof n !== 'number')) errors.push('The area box needs four numbers: west, south, east, north.')
    else bbox = [b[0], b[1], b[2], b[3]]
  } else if (a.type === 'Polygon') {
    const ring = a.coordinates?.[0]
    if (!Array.isArray(a.coordinates) || !Array.isArray(ring) || ring.length < 4 || ring.some((p) => !Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number')) errors.push('The polygon needs at least three corners.')
    else if (a.coordinates.some((r) => r.some((p) => !inRange(p[0], p[1])))) errors.push('Polygon coordinates are outside valid longitude/latitude ranges.')
    else {
      const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
      bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      polygon = a.coordinates.map((r) => r.map((p) => [p[0], p[1]]))
    }
  } else errors.push('The area of interest must be a box or a polygon.')
  if (errors.length || !bbox) return { ok: false, errors }
  if (!inRange(bbox[0], bbox[1]) || !inRange(bbox[2], bbox[3])) return { ok: false, errors: ['The area is outside valid longitude/latitude ranges.'] }
  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return { ok: false, errors: ['The area has no size: west must be less than east and south less than north. Areas crossing the 180° meridian are not supported.'] }
  const areaKm2 = bboxAreaKm2(bbox)
  if (areaKm2 < minKm2) errors.push(`The area is too small (${areaKm2.toFixed(3)} km²). Minimum is ${minKm2} km².`)
  if (areaKm2 > maxKm2) errors.push(`The area is too large (${Math.round(areaKm2)} km²). The limit is ${maxKm2} km², so analysis keeps a useful resolution.`)
  return errors.length ? { ok: false, errors } : { ok: true, bbox, polygon, areaKm2 }
}

// ---- parameters ---------------------------------------------------------------------------------
const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)

export function validateOpticalParams(p: unknown): { ok: true; value: OpticalParams } | { ok: false; errors: string[] } {
  const o = (p ?? {}) as Partial<OpticalParams>, errors: string[] = [], d = DEFAULT_OPTICAL_PARAMS
  const index = o.index ?? d.index
  if (index !== 'mndwi' && index !== 'ndwi') errors.push('Water index must be mndwi or ndwi.')
  const waterThreshold = o.waterThreshold === undefined ? d.waterThreshold : num(o.waterThreshold, -1, 1)
  if (waterThreshold == null) errors.push('Water threshold must be a number between -1 and 1.')
  const ndviDrop = o.ndviDrop === undefined ? d.ndviDrop : num(o.ndviDrop, 0.05, 1)
  if (ndviDrop == null) errors.push('Vegetation drop must be between 0.05 and 1.')
  const minClusterPixels = o.minClusterPixels === undefined ? d.minClusterPixels : num(o.minClusterPixels, 1, 500)
  if (minClusterPixels == null) errors.push('Minimum cluster size must be between 1 and 500 pixels.')
  return errors.length ? { ok: false, errors } : { ok: true, value: { index: index as OpticalParams['index'], waterThreshold: waterThreshold!, ndviDrop: ndviDrop!, minClusterPixels: Math.round(minClusterPixels!) } }
}

export function validateSarParams(p: unknown): { ok: true; value: SarParams } | { ok: false; errors: string[] } {
  const o = (p ?? {}) as Partial<SarParams>, errors: string[] = [], d = DEFAULT_SAR_PARAMS
  const polarization = o.polarization ?? d.polarization
  if (polarization !== 'VV' && polarization !== 'VH') errors.push('Polarization must be VV or VH.')
  const waterThresholdDb = o.waterThresholdDb === undefined ? d.waterThresholdDb : num(o.waterThresholdDb, -40, 0)
  if (waterThresholdDb == null) errors.push('Water threshold must be between -40 and 0 dB.')
  const changeDb = o.changeDb === undefined ? d.changeDb : num(o.changeDb, 0.5, 20)
  if (changeDb == null) errors.push('Change threshold must be between 0.5 and 20 dB.')
  const speckleWindow = o.speckleWindow === undefined ? d.speckleWindow : num(o.speckleWindow, 1, 9)
  if (speckleWindow == null || (speckleWindow as number) % 2 === 0) errors.push('Speckle window must be an odd number from 1 to 9.')
  const minClusterPixels = o.minClusterPixels === undefined ? d.minClusterPixels : num(o.minClusterPixels, 1, 500)
  if (minClusterPixels == null) errors.push('Minimum cluster size must be between 1 and 500 pixels.')
  return errors.length ? { ok: false, errors } : { ok: true, value: { polarization: polarization as SarParams['polarization'], waterThresholdDb: waterThresholdDb!, changeDb: changeDb!, speckleWindow: speckleWindow!, minClusterPixels: Math.round(minClusterPixels!) } }
}
