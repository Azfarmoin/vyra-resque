// Dependency-free request validation for the shelter APIs (same strict, whitelist-only style as the rest of VYRA).
// Unknown keys are rejected rather than ignored, so a client can never smuggle in a server-owned field
// (reserved_capacity, authorized_overflow, verification fields, status of a reservation, ...).
import { isValidLatLng } from '../routing/geo'
import { VEHICLE_TYPES, type LatLng, type VehicleType } from '../routing/types'
import { FACILITY_KEYS, type FacilityKey, type GroupNeeds, type OccupancyBasis, type OpeningHours, type Tri, WEEKDAYS, type WheelchairAccess } from './types'

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: { path: string; message: string }[] }
type Errs = { path: string; message: string }[]

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function strictKeys(o: Record<string, unknown>, allowed: readonly string[], errs: Errs, path = '') {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) errs.push({ path: path + k, message: 'Unknown or not allowed field.' })
}
const done = <T>(errs: Errs, value: T): Parsed<T> => (errs.length ? { ok: false, errors: errs } : { ok: true, value })

function text(o: Record<string, unknown>, k: string, errs: Errs, { min = 0, max = 200, required = false } = {}): string | undefined {
  const v = o[k]
  if (v == null || v === '') { if (required) errs.push({ path: k, message: 'Required.' }); return undefined }
  if (typeof v !== 'string') { errs.push({ path: k, message: 'Must be text.' }); return undefined }
  const t = v.trim()
  if (t.length < min || t.length > max) errs.push({ path: k, message: `Use ${min}-${max} characters.` })
  // Control characters have no place in labels that later appear in tables and logs.
  if (/[\u0000-\u001f\u007f]/.test(t)) errs.push({ path: k, message: 'Contains control characters.' })
  return t
}
const iso = (o: Record<string, unknown>, k: string, errs: Errs, required = false): string | undefined => {
  const v = o[k]
  if (v == null || v === '') { if (required) errs.push({ path: k, message: 'Required.' }); return undefined }
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) { errs.push({ path: k, message: 'Must be an ISO date-time.' }); return undefined }
  return new Date(v).toISOString()
}

// ---- needs ---------------------------------------------------------------------------------------------------------------
const NEED_KEYS = ['partySize', 'wheelchairUsers', 'mobilityAssistance', 'oxygenUsers', 'essentialMedication', 'infants', 'elderly', 'pregnant', 'keepFamilyTogether'] as const
export function parseNeeds(raw: unknown, errs: Errs, path = 'needs'): GroupNeeds | null {
  if (!isObj(raw)) { errs.push({ path, message: 'Required.' }); return null }
  strictKeys(raw, NEED_KEYS, errs, `${path}.`)
  if (!int(raw.partySize, 1, 5000)) { errs.push({ path: `${path}.partySize`, message: 'Whole number from 1 to 5000.' }); return null }
  const needs: GroupNeeds = { partySize: raw.partySize as number }
  for (const k of ['wheelchairUsers', 'mobilityAssistance', 'oxygenUsers', 'essentialMedication', 'infants', 'elderly', 'pregnant'] as const) {
    const v = raw[k]
    if (v == null) continue
    if (!int(v, 0, 5000) || (v as number) > needs.partySize) errs.push({ path: `${path}.${k}`, message: 'Whole number, not more than the party size.' })
    else needs[k] = v as number
  }
  if (raw.keepFamilyTogether != null) {
    if (typeof raw.keepFamilyTogether !== 'boolean') errs.push({ path: `${path}.keepFamilyTogether`, message: 'true or false.' })
    else needs.keepFamilyTogether = raw.keepFamilyTogether
  }
  return needs
}

// ---- recommend -----------------------------------------------------------------------------------------------------------
export interface RecommendBody { origin: LatLng; needs: GroupNeeds; vehicle: VehicleType; incidentId: string | null; floodScenarioZoneIds: string[]; useActiveFloodZones: boolean }
export function parseRecommend(raw: unknown): Parsed<RecommendBody> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(raw, ['origin', 'incidentId', 'needs', 'vehicle', 'floodScenarioZoneIds', 'useActiveFloodZones'], errs)
  const o = raw.origin
  let origin: LatLng | null = null
  if (isObj(o) && typeof o.lat === 'number' && typeof o.lng === 'number' && isValidLatLng([o.lat, o.lng])) origin = [o.lat, o.lng]
  else errs.push({ path: 'origin', message: 'Provide { lat, lng } within valid ranges.' })
  const needs = parseNeeds(raw.needs, errs)
  const vehicle = (raw.vehicle ?? 'car') as string
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle)) errs.push({ path: 'vehicle', message: `One of ${VEHICLE_TYPES.join(', ')}.` })
  let incidentId: string | null = null
  if (raw.incidentId != null) { if (typeof raw.incidentId !== 'string' || !UUID_RE.test(raw.incidentId)) errs.push({ path: 'incidentId', message: 'Must be an incident id.' }); else incidentId = raw.incidentId }
  const ids = raw.floodScenarioZoneIds ?? []
  if (!Array.isArray(ids) || ids.length > 50 || ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) errs.push({ path: 'floodScenarioZoneIds', message: 'Up to 50 zone ids.' })
  if (raw.useActiveFloodZones != null && typeof raw.useActiveFloodZones !== 'boolean') errs.push({ path: 'useActiveFloodZones', message: 'true or false.' })
  if (errs.length) return { ok: false, errors: errs }
  return { ok: true, value: { origin: origin!, needs: needs!, vehicle: vehicle as VehicleType, incidentId, floodScenarioZoneIds: ids as string[], useActiveFloodZones: raw.useActiveFloodZones === true } }
}

// ---- reservation ---------------------------------------------------------------------------------------------------------
export interface ReserveBody {
  shelterId: string; groupLabel: string; incidentId: string | null; dispatchId: string | null; needs: GroupNeeds
  expectedArrivalAt: string | null; holdMinutes: number; idempotencyKey: string
}
export function parseReserve(raw: unknown): Parsed<ReserveBody> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(raw, ['shelterId', 'groupLabel', 'incidentId', 'dispatchId', 'needs', 'expectedArrivalAt', 'holdMinutes', 'idempotencyKey'], errs)
  const shelterId = text(raw, 'shelterId', errs, { required: true, max: 64 })
  if (shelterId && !UUID_RE.test(shelterId)) errs.push({ path: 'shelterId', message: 'Must be a shelter id.' })
  const groupLabel = text(raw, 'groupLabel', errs, { required: true, min: 2, max: 60 })
  for (const k of ['incidentId', 'dispatchId'] as const) if (raw[k] != null && (typeof raw[k] !== 'string' || !UUID_RE.test(raw[k] as string))) errs.push({ path: k, message: 'Must be an id.' })
  const needs = parseNeeds(raw.needs, errs)
  const expectedArrivalAt = iso(raw, 'expectedArrivalAt', errs)
  const hold = raw.holdMinutes ?? 90
  if (!int(hold, 15, 1440)) errs.push({ path: 'holdMinutes', message: 'Whole minutes from 15 to 1440.' })
  const idem = text(raw, 'idempotencyKey', errs, { required: true, min: 8, max: 80 })
  if (idem && !/^[A-Za-z0-9._:-]+$/.test(idem)) errs.push({ path: 'idempotencyKey', message: 'Use letters, digits and . _ : -' })
  if (errs.length) return { ok: false, errors: errs }
  return { ok: true, value: { shelterId: shelterId!, groupLabel: groupLabel!, incidentId: (raw.incidentId as string) ?? null, dispatchId: (raw.dispatchId as string) ?? null, needs: needs!, expectedArrivalAt: expectedArrivalAt ?? null, holdMinutes: hold as number, idempotencyKey: idem! } }
}

export type ReservationAction =
  | { action: 'confirm_arrival'; arrivedCount: number | null }
  | { action: 'depart' }
  | { action: 'cancel'; reason: string }
  | { action: 'extend_hold'; minutes: number }
export function parseReservationAction(raw: unknown): Parsed<ReservationAction> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  const a = raw.action
  if (a === 'confirm_arrival') {
    strictKeys(raw, ['action', 'arrivedCount'], errs)
    if (raw.arrivedCount != null && !int(raw.arrivedCount, 1, 5000)) errs.push({ path: 'arrivedCount', message: 'Whole number of people who actually arrived (1 or more).' })
    return done(errs, { action: 'confirm_arrival', arrivedCount: (raw.arrivedCount as number) ?? null })
  }
  if (a === 'depart') { strictKeys(raw, ['action'], errs); return done(errs, { action: 'depart' }) }
  if (a === 'cancel') {
    strictKeys(raw, ['action', 'reason'], errs)
    const reason = text(raw, 'reason', errs, { required: true, min: 3, max: 200 })
    return done(errs, { action: 'cancel', reason: reason ?? '' })
  }
  if (a === 'extend_hold') {
    strictKeys(raw, ['action', 'minutes'], errs)
    if (!int(raw.minutes, 15, 360)) errs.push({ path: 'minutes', message: 'Whole minutes from 15 to 360.' })
    return done(errs, { action: 'extend_hold', minutes: raw.minutes as number })
  }
  return { ok: false, errors: [{ path: 'action', message: 'One of confirm_arrival, depart, cancel, extend_hold.' }] }
}

// ---- occupancy / registry ------------------------------------------------------------------------------------------------
export function parseOccupancy(raw: unknown): Parsed<{ count: number; basis: Exclude<OccupancyBasis, 'unknown'> }> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(raw, ['count', 'basis'], errs)
  if (!int(raw.count, 0, 200000)) errs.push({ path: 'count', message: 'Whole number of people currently inside.' })
  if (raw.basis !== 'counted' && raw.basis !== 'reported' && raw.basis !== 'estimated') errs.push({ path: 'basis', message: 'One of counted, reported, estimated.' })
  return done(errs, { count: raw.count as number, basis: raw.basis as 'counted' | 'reported' | 'estimated' })
}

export interface FacilityPatch { value: Tri; documented?: boolean; note?: string | null }
export interface RegistryPatch {
  name?: string; address?: string | null; area?: string | null; contact_number?: string | null
  location_lat?: number; location_lng?: number; location_verified?: boolean; location_source?: string | null
  capacity?: number; status?: 'open' | 'full' | 'closed'
  opening_hours?: OpeningHours | null; wheelchair_access?: WheelchairAccess
  facilities?: Partial<Record<FacilityKey, FacilityPatch>>
  infrastructure_dependencies?: string[]
  responsible_org?: string | null; data_source?: string | null
  verification_status?: 'verified' | 'unverified' | 'needs_review' | 'rejected'
}
const REGISTRY_KEYS = ['name', 'address', 'area', 'contact_number', 'location_lat', 'location_lng', 'location_verified', 'location_source', 'capacity', 'status', 'opening_hours', 'wheelchair_access', 'facilities', 'infrastructure_dependencies', 'responsible_org', 'data_source', 'verification_status']
export function parseRegistryPatch(raw: unknown, { creating = false } = {}): Parsed<RegistryPatch> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(raw, REGISTRY_KEYS, errs)
  const p: RegistryPatch = {}
  const name = text(raw, 'name', errs, { min: 2, max: 120, required: creating })
  if (name !== undefined) p.name = name
  for (const k of ['address', 'area', 'contact_number', 'location_source', 'responsible_org', 'data_source'] as const) if (k in raw) { const t = text(raw, k, errs, { max: 160 }); p[k] = t ?? null }
  const blank = (v: unknown) => v == null || v === ''
  if (!(blank(raw.location_lat) && blank(raw.location_lng))) {
    // A shelter may be created without coordinates (the existing Supplies form allows it); it just cannot be routed to or mapped.
    const lat = typeof raw.location_lat === 'string' ? Number(raw.location_lat) : raw.location_lat
    const lng = typeof raw.location_lng === 'string' ? Number(raw.location_lng) : raw.location_lng
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidLatLng([lat, lng])) errs.push({ path: 'location_lat', message: 'Provide valid location_lat and location_lng together.' })
    else { p.location_lat = lat; p.location_lng = lng }
  }
  if ('location_verified' in raw) { if (typeof raw.location_verified !== 'boolean') errs.push({ path: 'location_verified', message: 'true or false.' }); else p.location_verified = raw.location_verified }
  if ('capacity' in raw) { if (!int(raw.capacity, 1, 200000)) errs.push({ path: 'capacity', message: 'Whole number of 1 or more.' }); else p.capacity = raw.capacity as number }
  if ('status' in raw) { if (raw.status !== 'open' && raw.status !== 'full' && raw.status !== 'closed') errs.push({ path: 'status', message: 'open, full or closed.' }); else p.status = raw.status }
  if ('wheelchair_access' in raw) { if (!['full', 'partial', 'none', 'unknown'].includes(raw.wheelchair_access as string)) errs.push({ path: 'wheelchair_access', message: 'full, partial, none or unknown.' }); else p.wheelchair_access = raw.wheelchair_access as WheelchairAccess }
  if ('verification_status' in raw) { if (!['verified', 'unverified', 'needs_review', 'rejected'].includes(raw.verification_status as string)) errs.push({ path: 'verification_status', message: 'Invalid verification status.' }); else p.verification_status = raw.verification_status as RegistryPatch['verification_status'] }
  if ('infrastructure_dependencies' in raw) {
    const d = raw.infrastructure_dependencies
    if (!Array.isArray(d) || d.length > 10 || d.some((x) => typeof x !== 'string' || !/^[a-z_]{3,40}$/.test(x))) errs.push({ path: 'infrastructure_dependencies', message: 'Up to 10 lowercase_snake_case labels.' })
    else p.infrastructure_dependencies = d as string[]
  }
  if ('facilities' in raw) {
    const f = raw.facilities
    if (!isObj(f)) errs.push({ path: 'facilities', message: 'Must be an object.' })
    else {
      const out: Partial<Record<FacilityKey, FacilityPatch>> = {}
      for (const [k, v] of Object.entries(f)) {
        if (!(FACILITY_KEYS as readonly string[]).includes(k)) { errs.push({ path: `facilities.${k}`, message: 'Unknown facility.' }); continue }
        if (!isObj(v) || !['yes', 'no', 'unknown'].includes(v.value as string)) { errs.push({ path: `facilities.${k}`, message: 'Needs { value: yes | no | unknown }.' }); continue }
        strictKeys(v, ['value', 'documented', 'note'], errs, `facilities.${k}.`)
        out[k as FacilityKey] = { value: v.value as Tri, documented: v.documented === true, note: typeof v.note === 'string' ? v.note.slice(0, 160) : null }
      }
      p.facilities = out
    }
  }
  if ('opening_hours' in raw) {
    const h = raw.opening_hours
    if (h === null) p.opening_hours = null
    else if (!isObj(h)) errs.push({ path: 'opening_hours', message: 'Must be an object or null.' })
    else {
      strictKeys(h, ['open24h', 'timezone', 'weekly', 'note'], errs, 'opening_hours.')
      const weekly = h.weekly
      if (weekly != null) {
        if (!isObj(weekly)) errs.push({ path: 'opening_hours.weekly', message: 'Must be an object.' })
        else for (const [d, ranges] of Object.entries(weekly)) {
          if (!(WEEKDAYS as readonly string[]).includes(d) || !Array.isArray(ranges) || ranges.length > 6 || ranges.some((r) => !Array.isArray(r) || r.length !== 2 || !r.every((t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))) errs.push({ path: `opening_hours.weekly.${d}`, message: 'Use [["HH:MM","HH:MM"], ...] for sun..sat.' })
        }
      }
      if (h.timezone != null) { try { new Intl.DateTimeFormat('en', { timeZone: String(h.timezone) }) } catch { errs.push({ path: 'opening_hours.timezone', message: 'Unknown time zone.' }) } }
      p.opening_hours = { open24h: h.open24h === true, timezone: (h.timezone as string) || undefined, weekly: weekly as OpeningHours['weekly'], note: typeof h.note === 'string' ? h.note.slice(0, 160) : null }
    }
  }
  return done(errs, p)
}

export interface ExceptionBody { shelterId: string; kind: 'over_capacity' | 'closed_use'; extraCapacity: number; reason: string; expiresAt: string }
export function parseException(raw: unknown): Parsed<ExceptionBody> {
  const errs: Errs = []
  if (!isObj(raw)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(raw, ['shelterId', 'kind', 'extraCapacity', 'reason', 'expiresAt'], errs)
  if (typeof raw.shelterId !== 'string' || !UUID_RE.test(raw.shelterId)) errs.push({ path: 'shelterId', message: 'Must be a shelter id.' })
  if (raw.kind !== 'over_capacity' && raw.kind !== 'closed_use') errs.push({ path: 'kind', message: 'over_capacity or closed_use.' })
  const extra = raw.extraCapacity ?? 0
  if (raw.kind === 'over_capacity' && !int(extra, 1, 5000)) errs.push({ path: 'extraCapacity', message: 'Whole number of extra places (1-5000) for over_capacity.' })
  if (raw.kind === 'closed_use' && extra !== 0) errs.push({ path: 'extraCapacity', message: 'Not used for closed_use.' })
  const reason = text(raw, 'reason', errs, { required: true, min: 10, max: 300 })
  const expiresAt = iso(raw, 'expiresAt', errs, true)
  return done(errs, { shelterId: raw.shelterId as string, kind: raw.kind as ExceptionBody['kind'], extraCapacity: extra as number, reason: reason ?? '', expiresAt: expiresAt ?? '' })
}

// ---- coverage ------------------------------------------------------------------------------------------------------------
export interface CoverageBody { cellKm: number; reachMinutes: number; candidates: { id: string; name: string; lat: number; lng: number; capacity: number }[] }
export function parseCoverage(raw: unknown): Parsed<CoverageBody> {
  const errs: Errs = []
  const o = raw == null ? {} : raw
  if (!isObj(o)) return { ok: false, errors: [{ path: '', message: 'Body must be a JSON object.' }] }
  strictKeys(o, ['cellKm', 'reachMinutes', 'candidates'], errs)
  const cellKm = (o.cellKm ?? 1) as number
  if (typeof cellKm !== 'number' || !(cellKm >= 0.5 && cellKm <= 5)) errs.push({ path: 'cellKm', message: 'Between 0.5 and 5 km.' })
  const reach = (o.reachMinutes ?? 30) as number
  if (!int(reach, 5, 120)) errs.push({ path: 'reachMinutes', message: 'Whole minutes from 5 to 120.' })
  const cands: CoverageBody['candidates'] = []
  const list = o.candidates ?? []
  if (!Array.isArray(list) || list.length > 10) errs.push({ path: 'candidates', message: 'Up to 10 hypothetical sites.' })
  else list.forEach((c, i) => {
    if (!isObj(c) || typeof c.lat !== 'number' || typeof c.lng !== 'number' || !isValidLatLng([c.lat, c.lng]) || !int(c.capacity, 10, 100000) || typeof c.name !== 'string' || c.name.trim().length < 1 || c.name.length > 60) errs.push({ path: `candidates.${i}`, message: 'Needs name, valid lat/lng and a capacity of 10 or more.' })
    else cands.push({ id: `hyp-${i + 1}`, name: c.name.trim(), lat: c.lat, lng: c.lng, capacity: c.capacity as number })
  })
  return done(errs, { cellKm, reachMinutes: reach, candidates: cands })
}
