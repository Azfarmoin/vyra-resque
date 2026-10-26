// Early-warning system: shared vocabularies and types.
// Pure data, no imports from the rest of the app, so it is safe on server and client.

export const HAZARD_TYPES = {
  heavy_rain: 'Heavy rainfall / urban flooding',
  river_flood: 'River flooding',
  cyclone: 'Tropical cyclone / severe storm',
  heatwave: 'Extreme heat',
  thunderstorm_wind: 'Thunderstorm / severe wind',
  landslide: 'Landslide',
  wildfire: 'Wildfire',
  earthquake: 'Earthquake',
  other: 'Other hazard',
} as const
export type HazardType = keyof typeof HAZARD_TYPES

// Information < Watch < Warning < Emergency. Always taken from the source where one is supplied.
export const SEVERITIES = ['information', 'watch', 'warning', 'emergency'] as const
export type Severity = (typeof SEVERITIES)[number]
export const SEVERITY_LABELS: Record<Severity, string> = {
  information: 'Information',
  watch: 'Watch',
  warning: 'Warning',
  emergency: 'Emergency',
}
export const SEVERITY_MEANING: Record<Severity, string> = {
  information: 'General preparedness information.',
  watch: 'Conditions could become hazardous.',
  warning: 'An authoritative source reports a significant threat.',
  emergency: 'An authoritative source indicates immediate danger or directs urgent protective action.',
}
export const severityRank = (s: Severity) => SEVERITIES.indexOf(s)

// Where the content of an alert comes from. The UI must always show this.
//  official           imported from an official alerting authority's feed
//  observation        an official record of something that already happened (e.g. a recorded earthquake)
//  internal_estimate  VYRA's own rule-based estimate from forecast data - never an official warning
//  manual             a human-authored announcement published by an authorised administrator
export const ORIGINS = ['official', 'observation', 'internal_estimate', 'manual'] as const
export type Origin = (typeof ORIGINS)[number]
export const ORIGIN_LABELS: Record<Origin, string> = {
  official: 'Official alert',
  observation: 'Official observation (after the event)',
  internal_estimate: 'VYRA estimate - not an official warning',
  manual: 'Announcement by VYRA administrators',
}

// active    in force
// cancelled the source withdrew it
// superseded replaced by a newer message from the source
// expired   past its expiry time (computed; see effectiveStatus)
export type AlertStatus = 'active' | 'cancelled' | 'superseded' | 'expired'

// Geographic reference. Coordinates are [lat, lng] everywhere in this module.
export type LatLng = [number, number]
export type AlertGeometry =
  | { type: 'polygon'; rings: LatLng[][] } // rings[0] outer ring; further rings are separate polygons (multipolygon)
  | { type: 'circle'; center: LatLng; radiusKm: number }
  | { type: 'point'; center: LatLng; displayRadiusKm: number } // point event; radius is a documented display heuristic
  | { type: 'bbox'; south: number; west: number; north: number; east: number }

export interface AlertArea {
  description: string // human-readable area text exactly as supplied by the source
  geometry: AlertGeometry[] // may be empty when the source gives names/codes only
  geocodes: { name: string; value: string }[]
}

export interface SourceSeverity {
  severity?: string
  urgency?: string
  certainty?: string
  responseType?: string[]
}

export interface AlertAiSummary {
  text: string
  language: string
  method: 'template' | 'llm'
  model?: string
  generatedAt: string
  // Set when an LLM summary was produced but rejected by the safeguards (we then show the template text).
  rejectedReason?: string
}

export interface AlertRecord {
  id: string
  provider: string
  external_alert_id: string
  origin: Origin
  hazard_type: HazardType
  severity: Severity
  status: AlertStatus
  title: string
  description: string
  instruction: string | null // protective-action text from the source, shown verbatim
  affected_area: string
  areas: AlertArea[]
  source_url: string | null
  source_name: string
  issued_at: string
  starts_at: string | null
  expires_at: string | null
  last_updated_at: string
  first_seen_at: string
  last_seen_at: string
  revision: number
  content_hash: string
  source_severity: SourceSeverity | null
  ai_summary: AlertAiSummary | null
  review_flags: string[]
  raw_source_metadata: Record<string, unknown> | null
  // Per-alert internal limitations text (e.g. "approximate area, matched by name only").
  limitations: string[]
  created_by: string | null // set for manual announcements
}

export type AlertCandidate = Omit<
  AlertRecord,
  'id' | 'first_seen_at' | 'last_seen_at' | 'revision' | 'content_hash' | 'ai_summary' | 'review_flags'
> & {
  // For CAP Update / Cancel: identifiers of earlier messages this one replaces (same provider).
  supersedes?: string[]
}

export interface ProviderHealth {
  provider: string
  enabled: boolean
  configured: boolean
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null // already sanitised: never contains URLs with secrets
  consecutive_failures: number
  last_item_count: number | null
  rejected_last_run: number
}

export interface IngestIssue {
  id: string
  provider: string
  kind: 'malformed' | 'invalid_timestamp' | 'conflict' | 'provider_error' | 'other'
  detail: string
  external_alert_id: string | null
  created_at: string
}

export interface AuditEntry {
  id: string
  at: string
  actor: string // 'system:<provider>' or an admin email
  action: string
  alert_id: string | null
  detail: string
}

export interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  user_id: string | null
  locations: SavedLocation[]
  hazard_types: HazardType[]
  minimum_severity: Severity
  language: string
  created_at: string
  updated_at: string
  failure_count: number
}

export interface NotificationRow {
  id: string
  alert_id: string
  revision: number
  subscription_id: string
  kind: 'new' | 'update' | 'cancel'
  outcome: 'pending' | 'sent' | 'failed' | 'gone'
  detail: string | null
  created_at: string
}

// A place the person wants warnings for.
export interface SavedLocation {
  id: string
  label: string
  lat: number
  lng: number
  // How exactly we know the place: gps (with accuracy), area_centre (a named area's centre point), manual_point.
  source: 'gps' | 'area_centre' | 'manual_point'
  accuracyM: number | null
}

export type MatchPrecision = 'polygon' | 'circle' | 'point_radius' | 'bbox' | 'area_name' | 'none'
export interface LocationMatch {
  // yes       the location lies inside the alert's published boundary
  // possible  close to the boundary, imprecise location, or matched by area name only
  // no        outside the published boundary
  // unknown   the alert has no boundary we can test
  result: 'yes' | 'possible' | 'no' | 'unknown'
  precision: MatchPrecision
  note: string
  distanceKm?: number
}

export interface Conflict {
  hazard_type: HazardType
  alert_ids: string[]
  reason: string
  // The alert from the most authoritative provider; the UI shows all of them but leads with this one.
  prioritised_id: string
}
