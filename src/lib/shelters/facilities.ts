// Normalising a stored shelter row, documented-capability checks, data-quality labels and opening hours.
// Pure: no framework imports.
import {
  FACILITY_KEYS, WEEKDAYS,
  type FacilityClaim, type FacilityKey, type FacilityMap, type OccupancyBasis, type OpeningHours, type ShelterRecord, type ShelterVerification, type Tri,
} from './types'

export const DEFAULT_TIMEZONE = 'Asia/Karachi' // the demo deployment region; override per shelter via opening_hours.timezone
export const STALE_OCCUPANCY_MIN = 180 // occupancy older than 3 h is "stale" during an active response
export const STALE_VERIFICATION_DAYS = 30
export const STALE_OCCUPANCY_MARGIN = 0.75 // only 75% of "available" is trusted when occupancy is stale or estimated

const LEGACY_SERVICE_TO_FACILITY: Record<string, FacilityKey> = {
  food: 'food', water: 'drinking_water', medical: 'medical_support', power: 'electricity',
}

const num = (v: unknown, fallback = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? fallback : Number(v))
const numOrNull = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Turn any stored row (Supabase, demo seed, pre-migration) into a ShelterRecord.
 * Legacy `services` entries become claims with NO documented_at, so they never satisfy a required capability by themselves.
 */
export function normaliseShelter(row: Record<string, unknown>): ShelterRecord {
  const facilities: FacilityMap = {}
  for (const s of (Array.isArray(row.services) ? (row.services as string[]) : [])) {
    const key = LEGACY_SERVICE_TO_FACILITY[String(s).toLowerCase()]
    if (key) facilities[key] = { value: 'yes', documented_at: null, note: 'Listed in the legacy services field; not documented.' }
  }
  const stored = (row.facilities && typeof row.facilities === 'object' ? row.facilities : {}) as Record<string, FacilityClaim>
  for (const key of FACILITY_KEYS) {
    const c = stored[key]
    if (c && (c.value === 'yes' || c.value === 'no' || c.value === 'unknown')) facilities[key] = { value: c.value, documented_at: c.documented_at ?? null, note: c.note ?? null }
  }
  const verifiedFlag = row.verified === true
  const vs = row.verification_status as ShelterVerification | undefined
  const verification_status: ShelterVerification =
    vs === 'verified' || vs === 'unverified' || vs === 'needs_review' || vs === 'rejected' ? vs : verifiedFlag ? 'verified' : 'unverified'
  const wa = row.wheelchair_access
  const basis = row.occupancy_basis as OccupancyBasis | undefined
  const status = row.status === 'full' || row.status === 'closed' ? row.status : 'open'
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    location_lat: numOrNull(row.location_lat),
    location_lng: numOrNull(row.location_lng),
    address: (row.address as string) ?? null,
    area: (row.area as string) ?? null,
    capacity: numOrNull(row.capacity),
    current_occupancy: numOrNull(row.current_occupancy),
    services: (row.services as string[]) ?? null,
    status,
    verified: verification_status === 'verified',
    contact_number: (row.contact_number as string) ?? null,
    reserved_capacity: Math.max(0, num(row.reserved_capacity)),
    authorized_overflow: Math.max(0, num(row.authorized_overflow)),
    auto_full: row.auto_full === true,
    location_verified: row.location_verified === true,
    location_verified_at: (row.location_verified_at as string) ?? null,
    location_source: (row.location_source as string) ?? null,
    opening_hours: (row.opening_hours as OpeningHours) ?? null,
    last_verified_at: (row.last_verified_at as string) ?? null,
    verified_by: (row.verified_by as string) ?? null,
    verification_status,
    responsible_org: (row.responsible_org as string) ?? null,
    data_source: (row.data_source as string) ?? null,
    occupancy_updated_at: (row.occupancy_updated_at as string) ?? null,
    occupancy_basis: basis === 'counted' || basis === 'reported' || basis === 'estimated' ? basis : 'unknown',
    wheelchair_access: wa === 'full' || wa === 'partial' || wa === 'none' ? wa : 'unknown',
    facilities,
    infrastructure_dependencies: Array.isArray(row.infrastructure_dependencies) ? (row.infrastructure_dependencies as string[]) : [],
    created_at: (row.created_at as string) ?? null,
    updated_at: (row.updated_at as string) ?? null,
  }
}

/** Documented = recorded as available AND someone recorded when. A shelter that is not verified documents nothing. */
export function isDocumented(s: ShelterRecord, key: FacilityKey): boolean {
  const c = s.facilities[key]
  return !!c && c.value === 'yes' && !!c.documented_at && s.verification_status !== 'rejected'
}

export const facilityState = (s: ShelterRecord, key: FacilityKey): 'documented' | 'claimed_undocumented' | 'no' | 'unknown' => {
  const c = s.facilities[key]
  if (!c || c.value === 'unknown') return 'unknown'
  if (c.value === 'no') return 'no'
  return c.documented_at ? 'documented' : 'claimed_undocumented'
}

// ---- data quality ---------------------------------------------------------------------------------------------------
export type Freshness = 'fresh' | 'stale' | 'unknown'
export interface DataQuality {
  occupancy: { freshness: Freshness; basis: OccupancyBasis; ageMinutes: number | null; label: string }
  verification: { status: ShelterVerification; stale: boolean; ageDays: number | null; label: string }
  locationVerified: boolean
}

const minutesSince = (iso: string | null, now: Date) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.round((now.getTime() - t) / 60_000)) : null
}
const human = (min: number) => (min < 90 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`)

export function dataQuality(s: ShelterRecord, now: Date): DataQuality {
  const age = minutesSince(s.occupancy_updated_at, now)
  const freshness: Freshness = age == null ? 'unknown' : age <= STALE_OCCUPANCY_MIN ? 'fresh' : 'stale'
  const basisWord = s.occupancy_basis === 'unknown' ? 'source unknown' : s.occupancy_basis
  const occLabel =
    s.occupancy_basis === 'estimated' ? `ESTIMATED occupancy${age == null ? '' : `, updated ${human(age)} ago`}`
    : freshness === 'unknown' ? 'Occupancy time unknown - treat as unconfirmed'
    : freshness === 'stale' ? `STALE: occupancy last updated ${human(age!)} ago (${basisWord})`
    : `Occupancy ${basisWord}, updated ${human(age!)} ago`
  const vAge = minutesSince(s.last_verified_at, now)
  const vDays = vAge == null ? null : Math.floor(vAge / 1440)
  const vStale = vDays == null || vDays > STALE_VERIFICATION_DAYS
  const vLabel =
    s.verification_status === 'rejected' ? 'Rejected: do not use'
    : s.verification_status === 'unverified' ? 'UNVERIFIED record'
    : s.verification_status === 'needs_review' ? 'Needs re-verification'
    : vDays == null ? 'Verified, but no verification date recorded'
    : vStale ? `Verification is STALE (${vDays} days old)` : `Verified ${vDays === 0 ? 'today' : `${vDays} days ago`}`
  return {
    occupancy: { freshness, basis: s.occupancy_basis, ageMinutes: age, label: occLabel },
    verification: { status: s.verification_status, stale: vStale, ageDays: vDays, label: vLabel },
    locationVerified: s.location_verified,
  }
}

// ---- capacity ---------------------------------------------------------------------------------------------------------
export interface Availability {
  max: number | null
  occupied: number
  reserved: number
  overflow: number
  available: number | null // seats not occupied and not held, including authorized overflow; never negative
  usable: number | null // what we are willing to rely on: `available`, reduced when occupancy is stale/estimated/unknown
  trusted: boolean
  overAllocatedBy: number // > 0 means more people are recorded than the (authorized) capacity: needs human reconciliation
}

export function availability(s: ShelterRecord, q: DataQuality): Availability {
  const occupied = s.current_occupancy ?? 0
  const reserved = s.reserved_capacity
  if (s.capacity == null) return { max: null, occupied, reserved, overflow: 0, available: null, usable: null, trusted: false, overAllocatedBy: 0 }
  const ceiling = s.capacity + s.authorized_overflow
  const raw = ceiling - occupied - reserved
  const available = Math.max(0, raw)
  const trusted = q.occupancy.freshness === 'fresh' && (q.occupancy.basis === 'counted' || q.occupancy.basis === 'reported') && s.current_occupancy != null
  const usable = trusted ? available : Math.floor(available * STALE_OCCUPANCY_MARGIN)
  return { max: s.capacity, occupied, reserved, overflow: s.authorized_overflow, available, usable, trusted, overAllocatedBy: Math.max(0, -raw) }
}

// ---- opening hours ----------------------------------------------------------------------------------------------------
export function openNow(hours: OpeningHours | null, now: Date): 'open' | 'closed' | 'unknown' {
  if (!hours) return 'unknown'
  if (hours.open24h) return 'open'
  if (!hours.weekly) return 'unknown'
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: hours.timezone || DEFAULT_TIMEZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  } catch {
    return 'unknown' // unknown time zone name
  }
  const wd = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3)
  const day = WEEKDAYS.find((d) => d === wd)
  if (!day) return 'unknown'
  const hh = Number(parts.find((p) => p.type === 'hour')?.value)
  const mm = Number(parts.find((p) => p.type === 'minute')?.value)
  const cur = hh * 60 + mm
  const ranges = hours.weekly[day]
  if (!ranges) return 'unknown'
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  for (const [a, b] of ranges) {
    const s = toMin(a), e = toMin(b)
    if (Number.isNaN(s) || Number.isNaN(e)) return 'unknown'
    if (s <= e ? cur >= s && cur < e : cur >= s || cur < e) return 'open' // overnight ranges (22:00-06:00) wrap
  }
  return 'closed'
}

export const triLabel = (t: Tri) => (t === 'yes' ? 'Yes' : t === 'no' ? 'No' : 'Unknown')
