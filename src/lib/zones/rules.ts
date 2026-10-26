// Zone rules: labels and accessible styles, validation, who may do what, lifecycle, freshness, filters.
// Pure functions only, so the browser, the API and the tests all apply the exact same rules.
import { bboxOfGeometry, circleBBox, geometryErrors, isValidRadius } from './geometry'
import {
  BOUNDARY_KINDS, BOUNDARY_QUALITIES, EVACUATION_STATUSES, HAZARD_TYPES, LIFECYCLES, SEVERITIES, SOURCE_TYPES, VERIFICATIONS, ZONE_TYPES,
  type AnyRole, type BBox, type DisasterZone, type DisplayState, type FeedStatus, type ZoneGeometry, type ZoneInput, type ZoneType,
} from './types'

const HOUR = 3_600_000
export const GRACE_MS = 24 * HOUR // cancelled / expired zones stay visible (labelled) for a day so people see the change

// ---- presentation: never colour alone ------------------------------------------------------------
// Every type has a colour AND a fill pattern AND an outline style AND a text label with a glyph.
export type PatternId = 'crosshatch' | 'diagonal' | 'dots' | 'horizontal' | 'plus' | 'grid'
export interface ZoneStyle {
  label: string
  short: string // the word printed on the map
  glyph: string
  colour: string // outline + legend swatch
  fill: string
  pattern: PatternId
  dash: string | null // SVG dash array for the outline
  meaning: string
}

export const ZONE_STYLES: Record<ZoneType, ZoneStyle> = {
  danger: { label: 'High danger zone', short: 'DANGER', glyph: '!', colour: '#B3261E', fill: '#E5484D', pattern: 'crosshatch', dash: null, meaning: 'Verified or official high-severity hazard. Stay out and follow official instructions.' },
  elevated: { label: 'Elevated risk zone', short: 'ELEVATED', glyph: '▲', colour: '#C2570C', fill: '#F08A24', pattern: 'diagonal', dash: null, meaning: 'Credible reports of a hazard or elevated risk. Avoid if you can.' },
  caution: { label: 'Caution zone', short: 'CAUTION', glyph: '•', colour: '#8A6A00', fill: '#F2C94C', pattern: 'dots', dash: '8 5', meaning: 'Limited or developing information. Take care and check again soon.' },
  evacuation: { label: 'Evacuation zone', short: 'EVACUATION', glyph: '→', colour: '#1A5FB4', fill: '#4C8DF6', pattern: 'horizontal', dash: '12 4 2 4', meaning: 'Area designated for evacuation or evacuation planning. See whether it is an official order or a proposed plan.' },
  shelter: { label: 'Designated shelter zone', short: 'SHELTER', glyph: '+', colour: '#1E7B4F', fill: '#47B881', pattern: 'plus', dash: null, meaning: 'A verified shelter or assistance point. This does NOT mean the surrounding area is free of hazards.' },
  restricted: { label: 'Restricted or unverified zone', short: 'RESTRICTED', glyph: '?', colour: '#4B5563', fill: '#9CA3AF', pattern: 'grid', dash: '2 6', meaning: 'Access is restricted, or information or the boundary is incomplete. Read the zone details for the exact status.' },
}

export const SEVERITY_LABELS: Record<string, string> = { extreme: 'Extreme', high: 'High', moderate: 'Moderate', low: 'Low', unknown: 'Severity unknown' }
// Outline weight grows with severity: a second, non-colour cue.
export const SEVERITY_WEIGHT: Record<string, number> = { extreme: 5, high: 4, moderate: 3, low: 2, unknown: 2 }
export const HAZARD_LABELS: Record<string, string> = {
  flood: 'Flood', fire: 'Fire', storm: 'Storm', landslide: 'Landslide', earthquake: 'Earthquake', heat: 'Extreme heat',
  chemical: 'Chemical / gas', structural: 'Structural damage', infrastructure: 'Infrastructure / road', other: 'Other hazard',
}
export const VERIFICATION_INFO: Record<string, { label: string; short: string; desc: string }> = {
  official: { label: 'Official', short: 'OFFICIAL', desc: 'Issued by a responsible authority.' },
  human_verified: { label: 'Verified by a person', short: 'VERIFIED', desc: 'A responder checked this report. It is not an official warning.' },
  unverified: { label: 'Not verified', short: 'UNVERIFIED', desc: 'Reported but not yet checked. Treat as a possibility, not a fact.' },
  ai_suggested: { label: 'AI suggestion (not published)', short: 'AI SUGGESTION', desc: 'Suggested by software. Only a person can turn this into a zone.' },
}
export const SOURCE_LABELS: Record<string, string> = {
  official_feed: 'Official warning feed', official_manual: 'Official, entered by an administrator', responder: 'Responder report',
  citizen_report: 'Resident report', ai_suggestion: 'AI suggestion',
}
export const EVACUATION_LABELS: Record<string, string> = { order: 'OFFICIAL EVACUATION ORDER', proposed: 'PROPOSED EVACUATION PLAN - not an order' }

export const MAP_DISCLAIMER =
  'Zones may be incomplete or delayed. An area with no zone is NOT confirmed safe. Always follow official instructions, and call emergency services if you are in danger.'

export const zoneLabel = (z: Pick<DisasterZone, 'zone_type' | 'evacuation_status'>) =>
  z.zone_type === 'evacuation' && z.evacuation_status ? EVACUATION_LABELS[z.evacuation_status] : ZONE_STYLES[z.zone_type].label

export const isVerifiedLevel = (v: string) => v === 'official' || v === 'human_verified'

// ---- lifecycle -------------------------------------------------------------------------------------
export function displayState(z: Pick<DisasterZone, 'lifecycle' | 'valid_from' | 'valid_until'>, now = Date.now()): DisplayState {
  if (z.lifecycle === 'draft') return 'draft'
  if (z.lifecycle === 'cancelled') return 'cancelled'
  if (z.lifecycle === 'deactivated') return 'deactivated'
  if (z.valid_from && Date.parse(z.valid_from) > now) return 'upcoming'
  if (z.valid_until && Date.parse(z.valid_until) <= now) return 'expired'
  return 'active'
}

export const STATE_LABELS: Record<DisplayState, string> = {
  active: 'In effect', upcoming: 'Not started yet', expired: 'EXPIRED - no longer in effect', cancelled: 'CANCELLED', deactivated: 'Deactivated', draft: 'Draft (not published)',
}

/** When did this zone stop being in effect? Used for the 24 h "recently ended" window. */
function endedAt(z: DisasterZone, state: DisplayState): number | null {
  if (state === 'expired') return z.valid_until ? Date.parse(z.valid_until) : null
  if (state === 'cancelled' || state === 'deactivated') return Date.parse(z.updated_at)
  return null
}

/** What the public map may show. AI suggestions and drafts are never public. */
export function isPubliclyVisible(z: DisasterZone, now = Date.now()): boolean {
  if (z.verification_status === 'ai_suggested') return false
  const s = displayState(z, now)
  if (s === 'draft') return false
  if (s === 'active' || s === 'upcoming') return true
  const ended = endedAt(z, s)
  return ended != null && now - ended <= GRACE_MS
}

// ---- freshness: never imply old data is current ----------------------------------------------------
export type Freshness = { level: 'fresh' | 'aging' | 'stale'; label: string }
export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'unknown'
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} days ago`
}

export function freshnessOf(z: DisasterZone, feed: FeedStatus | undefined, now = Date.now()): Freshness {
  if (z.feed_id && feed) {
    const since = feed.last_success_at ? now - Date.parse(feed.last_success_at) : Infinity
    if (since > feed.stale_after_minutes * 60_000) return { level: 'stale', label: `Source feed not refreshed since ${feed.last_success_at ? ageLabel(feed.last_success_at, now) : 'ever'}` }
    if (feed.last_error) return { level: 'aging', label: `Last feed refresh failed; showing data from ${ageLabel(feed.last_success_at, now)}` }
  }
  const age = now - Date.parse(z.updated_at)
  if (age > 24 * HOUR) return { level: 'stale', label: `Not updated for ${ageLabel(z.updated_at, now).replace(' ago', '')}` }
  if (age > 6 * HOUR) return { level: 'aging', label: `Updated ${ageLabel(z.updated_at, now)}` }
  return { level: 'fresh', label: `Updated ${ageLabel(z.updated_at, now)}` }
}

// ---- filters -----------------------------------------------------------------------------------------
export const ZONE_VIEWS = ['all', 'hazard', 'floodfire', 'evacuation', 'shelters', 'roads'] as const
export type ZoneView = (typeof ZONE_VIEWS)[number]
export const VERIFY_FILTERS = ['all', 'verified', 'unverified'] as const
export type VerifyFilter = (typeof VERIFY_FILTERS)[number]
export const VIEW_LABELS: Record<ZoneView, string> = { all: 'All zones', hazard: 'Danger and hazard zones', floodfire: 'Flood and fire zones', evacuation: 'Evacuation zones', shelters: 'Shelters and assistance points', roads: 'Blocked roads' }

const HAZARD_ZONE_TYPES: ZoneType[] = ['danger', 'elevated', 'caution']
export const isRoadZone = (z: Pick<DisasterZone, 'boundary_kind' | 'geometry'>) => z.boundary_kind === 'road' || z.geometry.type === 'LineString'

export function matchesView(z: DisasterZone, view: ZoneView): boolean {
  switch (view) {
    case 'all': return true
    case 'hazard': return HAZARD_ZONE_TYPES.includes(z.zone_type) || z.zone_type === 'restricted'
    case 'floodfire': return (z.hazard_type === 'flood' || z.hazard_type === 'fire') && z.zone_type !== 'shelter'
    case 'evacuation': return z.zone_type === 'evacuation'
    case 'shelters': return z.zone_type === 'shelter'
    case 'roads': return isRoadZone(z)
  }
}
export const matchesVerify = (z: DisasterZone, f: VerifyFilter) => f === 'all' || (f === 'verified' ? isVerifiedLevel(z.verification_status) : !isVerifiedLevel(z.verification_status))
export function matchesSearch(z: DisasterZone, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [z.name, z.description, z.source_name, HAZARD_LABELS[z.hazard_type], ZONE_STYLES[z.zone_type].label, z.id].some((s) => (s ?? '').toLowerCase().includes(needle))
}

// ---- validation --------------------------------------------------------------------------------------
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const optStr = (v: unknown) => (str(v) ? str(v) : null)
const isoOrNull = (v: unknown): string | null | 'bad' => {
  if (v == null || v === '') return null
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) return 'bad'
  return new Date(v).toISOString()
}
const idList = (v: unknown): string[] | 'bad' => (v == null ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64) && v.length <= 200 ? [...new Set(v as string[])] : 'bad')
const isHttpUrl = (u: string) => { try { return /^https?:$/.test(new URL(u).protocol) } catch { return false } }

export interface ValidationResult { ok: boolean; errors: string[]; value: ZoneInput | null }

/** Validates a complete zone. Every consistency rule from the safety spec lives here. */
export function validateZoneInput(raw: unknown, now = Date.now()): ValidationResult {
  const errors: string[] = []
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  const name = str(r.name)
  if (name.length < 3 || name.length > 120) errors.push('Name must be 3 to 120 characters.')
  const description = str(r.description)
  if (description.length < 10 || description.length > 4000) errors.push('Describe the hazard or situation (10 to 4000 characters).')
  const precautions = optStr(r.precautions)
  if (precautions && precautions.length > 4000) errors.push('Precautions are too long (4000 characters max).')

  if (!oneOf(ZONE_TYPES, r.zone_type)) errors.push('Choose a zone type.')
  if (!oneOf(SEVERITIES, r.severity)) errors.push('Choose a severity.')
  if (!oneOf(HAZARD_TYPES, r.hazard_type)) errors.push('Choose a hazard type.')
  if (!oneOf(SOURCE_TYPES, r.source_type)) errors.push('Choose a source type.')
  if (!oneOf(VERIFICATIONS, r.verification_status)) errors.push('Choose a verification status.')
  const lifecycle = r.lifecycle == null ? 'active' : r.lifecycle
  if (!oneOf(LIFECYCLES, lifecycle)) errors.push('Invalid lifecycle status.')
  const quality = r.boundary_quality == null ? 'approximate' : r.boundary_quality
  if (!oneOf(BOUNDARY_QUALITIES, quality)) errors.push('Invalid boundary quality.')

  const gErr = geometryErrors(r.geometry)
  errors.push(...gErr)
  const geometry = gErr.length ? null : (r.geometry as ZoneGeometry)

  // Boundary kind must match the geometry. Circles need a documented radius; nothing is invented.
  let boundary = r.boundary_kind
  if (boundary == null && geometry) boundary = geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'road' : 'drawn'
  if (!oneOf(BOUNDARY_KINDS, boundary)) errors.push('Invalid boundary kind.')
  const radius_m = r.radius_m == null || r.radius_m === '' ? null : Number(r.radius_m)
  const radius_basis = optStr(r.radius_basis)
  if (boundary === 'circle') {
    if (geometry && geometry.type !== 'Point') errors.push('A circle is stored as one centre point.')
    if (!isValidRadius(radius_m)) errors.push('A circle needs a radius between 1 m and 200 km.')
    if (!radius_basis || radius_basis.length < 10) errors.push('A circle needs a documented basis for its radius (for example "official 5 km warning radius"). Otherwise draw a polygon or use a marker.')
  } else {
    if (radius_m != null) errors.push('A radius is only allowed for circle zones.')
    if (boundary === 'point' && geometry && geometry.type !== 'Point') errors.push('A point zone must use a Point geometry.')
    if (boundary === 'road' && geometry && geometry.type !== 'LineString') errors.push('A road segment must use a line.')
    if ((boundary === 'drawn' || boundary === 'administrative') && geometry && geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') errors.push('An area needs a polygon boundary.')
  }
  if (boundary === 'point' && quality !== 'approximate') errors.push('A single point cannot be an exact boundary.')

  const vf = isoOrNull(r.valid_from), vu = isoOrNull(r.valid_until)
  if (vf === 'bad') errors.push('Start time is not a valid date.')
  if (vu === 'bad') errors.push('Expiry time is not a valid date.')
  if (typeof vf === 'string' && typeof vu === 'string' && Date.parse(vu) <= Date.parse(vf)) errors.push('Expiry must be after the start time.')

  const source_url = optStr(r.source_url)
  if (source_url && !isHttpUrl(source_url)) errors.push('Source link must start with http:// or https://')
  const source_name = optStr(r.source_name)

  const reports = idList(r.related_report_ids), shelters = idList(r.related_shelter_ids), roads = idList(r.related_road_ids)
  if (reports === 'bad' || shelters === 'bad' || roads === 'bad') errors.push('Related record lists are invalid.')

  // ---- consistency rules ----
  const zt = r.zone_type, ver = r.verification_status, src = r.source_type
  const status_detail = optStr(r.status_detail)
  const evac = r.evacuation_status == null || r.evacuation_status === '' ? null : r.evacuation_status

  if (zt === 'danger' && ver !== 'official' && ver !== 'human_verified') errors.push('A red High Danger zone must be official or verified by a person. Use Elevated or Caution for unverified reports.')
  if (zt === 'shelter' && ver !== 'official' && ver !== 'human_verified') errors.push('A green Shelter zone must be a verified shelter or assistance point.')
  if (zt === 'restricted' && (!status_detail || status_detail.length < 10)) errors.push('Explain the exact status of a gray zone (restricted access, incomplete information, uncertain boundary...).')
  if (zt === 'evacuation') {
    if (!oneOf(EVACUATION_STATUSES, evac)) errors.push('Say whether this is an official evacuation order or a proposed plan.')
    if (evac === 'order' && ver !== 'official') errors.push('Only official information can be an evacuation order. Mark it as a proposed plan instead.')
  } else if (evac != null) errors.push('Evacuation status only applies to evacuation zones.')
  if (ver === 'official' && !source_name) errors.push('Name the authority that issued an official zone.')
  if ((src === 'official_feed' || src === 'official_manual') && ver !== 'official') errors.push('An official source must have the Official verification status.')
  if (ver === 'official' && src !== 'official_feed' && src !== 'official_manual') errors.push('Official status needs an official source.')
  if (src === 'ai_suggestion' || ver === 'ai_suggested') {
    if (src !== 'ai_suggestion' || ver !== 'ai_suggested') errors.push('AI suggestions must use the AI source and the AI-suggested status together.')
    if (lifecycle !== 'draft') errors.push('AI suggestions stay drafts until a person reviews them. AI cannot declare a danger, evacuation or safe zone.')
  }
  if (geometry && quality === 'official' && src !== 'official_feed' && src !== 'official_manual') errors.push('Only official sources can supply an official boundary.')

  if (errors.length) return { ok: false, errors, value: null }

  // Normalised, whitelisted value (unknown client fields are dropped).
  const value: ZoneInput = {
    name, zone_type: zt as ZoneType, severity: r.severity as ZoneInput['severity'], hazard_type: r.hazard_type as ZoneInput['hazard_type'],
    geometry: geometry!, boundary_kind: boundary as ZoneInput['boundary_kind'], boundary_quality: quality as ZoneInput['boundary_quality'],
    radius_m: boundary === 'circle' ? radius_m : null, radius_basis: boundary === 'circle' ? radius_basis : null,
    description, precautions, status_detail, evacuation_status: (evac as ZoneInput['evacuation_status']) ?? null,
    source_type: src as ZoneInput['source_type'], source_name, source_url, verification_status: ver as ZoneInput['verification_status'],
    lifecycle: lifecycle as ZoneInput['lifecycle'], valid_from: vf === 'bad' ? null : vf ?? new Date(now).toISOString(), valid_until: vu === 'bad' ? null : vu,
    related_report_ids: reports as string[], related_shelter_ids: shelters as string[], related_road_ids: roads as string[], change_reason: optStr(r.change_reason),
  }
  return { ok: true, errors: [], value }
}

export function zoneBBox(z: Pick<ZoneInput, 'geometry' | 'radius_m' | 'boundary_kind'>): BBox {
  return z.boundary_kind === 'circle' && z.geometry.type === 'Point' && z.radius_m ? circleBBox(z.geometry.coordinates, z.radius_m) : bboxOfGeometry(z.geometry)
}

// ---- permissions -------------------------------------------------------------------------------------
export class ZoneAuthError extends Error {
  constructor(message: string, public status = 403) { super(message) }
}

const OFFICIAL_SOURCES = ['official_feed', 'official_manual']

/**
 * Who may write which zone. Returns a message when NOT allowed, otherwise null.
 *  - citizens never write zones
 *  - responders write unverified / human-verified, non-official zones (and may propose, never order, evacuations)
 *  - only administrators publish official warnings and evacuation orders
 * `existing` is the stored zone when editing. The database repeats these checks with RLS and triggers.
 */
export function writeDenial(role: AnyRole | null, next: Pick<ZoneInput, 'verification_status' | 'source_type' | 'evacuation_status' | 'zone_type'>, existing?: Pick<DisasterZone, 'verification_status' | 'source_type' | 'evacuation_status'> | null): string | null {
  if (!role) return 'Sign in to manage zones.'
  if (role === 'citizen') return 'Only responders and administrators can manage zones.'
  if (role === 'admin') return null
  if (existing && (existing.verification_status === 'official' || OFFICIAL_SOURCES.includes(existing.source_type) || existing.evacuation_status === 'order'))
    return 'Only an administrator can change an official warning or evacuation order.'
  if (next.verification_status === 'official' || OFFICIAL_SOURCES.includes(next.source_type)) return 'Only an administrator can publish official warnings.'
  if (next.evacuation_status === 'order') return 'Only an administrator can publish an evacuation order. You can propose an evacuation plan instead.'
  return null
}

const IMPORTANT: (keyof DisasterZone)[] = ['zone_type', 'severity', 'verification_status', 'lifecycle', 'geometry', 'radius_m', 'valid_until', 'valid_from', 'evacuation_status', 'source_type']
export function diffZone(before: Partial<DisasterZone>, after: Partial<DisasterZone>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of keys) {
    if (['updated_at', 'updated_by', 'revision', 'created_at', 'bbox', 'change_reason'].includes(k)) continue
    if (JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((after as Record<string, unknown>)[k])) out[k] = { from: (before as Record<string, unknown>)[k] ?? null, to: (after as Record<string, unknown>)[k] ?? null }
  }
  return out
}
/** Important changes (type, severity, boundary, verification, timing, cancelling) must record a reason. */
export const needsReason = (changes: Record<string, unknown>) => Object.keys(changes).some((k) => (IMPORTANT as string[]).includes(k))
