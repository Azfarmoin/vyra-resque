// Interactive disaster zones: shared types. Pure (no React / Next / Supabase imports) so the same
// rules run in the browser, the API routes and the tests.

export const ZONE_TYPES = ['danger', 'elevated', 'caution', 'evacuation', 'shelter', 'restricted'] as const
export type ZoneType = (typeof ZONE_TYPES)[number]

export const SEVERITIES = ['extreme', 'high', 'moderate', 'low', 'unknown'] as const
export type ZoneSeverity = (typeof SEVERITIES)[number]

export const HAZARD_TYPES = ['flood', 'fire', 'storm', 'landslide', 'earthquake', 'heat', 'chemical', 'structural', 'infrastructure', 'other'] as const
export type HazardType = (typeof HAZARD_TYPES)[number]

export const SOURCE_TYPES = ['official_feed', 'official_manual', 'responder', 'citizen_report', 'ai_suggestion'] as const
export type SourceType = (typeof SOURCE_TYPES)[number]

// official: issued by an authority | human_verified: a responder checked it | unverified: reported, not checked
// ai_suggested: produced by software - a hint for a human, never shown to the public as a zone.
export const VERIFICATIONS = ['official', 'human_verified', 'unverified', 'ai_suggested'] as const
export type Verification = (typeof VERIFICATIONS)[number]

// "expired" is not stored: it is derived from valid_until (see displayState).
export const LIFECYCLES = ['draft', 'active', 'deactivated', 'cancelled'] as const
export type Lifecycle = (typeof LIFECYCLES)[number]

export const EVACUATION_STATUSES = ['order', 'proposed'] as const
export type EvacuationStatus = (typeof EVACUATION_STATUSES)[number]

export const BOUNDARY_KINDS = ['drawn', 'circle', 'administrative', 'road', 'point'] as const
export type BoundaryKind = (typeof BOUNDARY_KINDS)[number]

export const BOUNDARY_QUALITIES = ['official', 'surveyed', 'approximate'] as const
export type BoundaryQuality = (typeof BOUNDARY_QUALITIES)[number]

// GeoJSON order is [longitude, latitude]. Leaflet wants [lat, lng]; convert at the map boundary only.
export type Position = [number, number]
export type ZoneGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }
export type BBox = [number, number, number, number] // minLng, minLat, maxLng, maxLat

export type StaffRole = 'responder' | 'admin'
export type AnyRole = StaffRole | 'citizen'

export interface DisasterZone {
  id: string
  name: string
  zone_type: ZoneType
  severity: ZoneSeverity
  hazard_type: HazardType
  geometry: ZoneGeometry
  boundary_kind: BoundaryKind
  boundary_quality: BoundaryQuality
  radius_m: number | null // only for circles
  radius_basis: string | null // why this radius is justified (required with radius_m)
  description: string
  precautions: string | null
  status_detail: string | null // gray zones: the exact status (restricted access, boundary unknown, ...)
  evacuation_status: EvacuationStatus | null // blue zones: official order vs proposed plan
  source_type: SourceType
  source_name: string | null
  source_url: string | null
  external_id: string | null // id in the source system (feed imports dedupe on feed_id + external_id)
  feed_id: string | null
  verification_status: Verification
  lifecycle: Lifecycle
  valid_from: string | null
  valid_until: string | null
  related_report_ids: string[]
  related_shelter_ids: string[]
  related_road_ids: string[]
  bbox: BBox
  revision: number
  change_reason: string | null
  source_updated_at: string | null
  created_by: string | null
  created_by_name: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

// What a client may send. Server-owned fields (id, bbox, revision, timestamps, actors) are not in here.
export type ZoneInput = Omit<
  DisasterZone,
  'id' | 'bbox' | 'revision' | 'created_by' | 'created_by_name' | 'updated_by' | 'created_at' | 'updated_at' | 'external_id' | 'feed_id' | 'source_updated_at'
>

export type ZoneRecord = DisasterZone

export interface ZoneAuditEntry {
  id: string
  zone_id: string
  action: 'create' | 'update' | 'deactivate' | 'cancel' | 'reactivate' | 'import' | 'import_update' | 'expire' | 'delete'
  actor: string // email / user id; 'feed:<id>' for imports
  actor_role: string | null
  reason: string | null
  changes: Record<string, { from: unknown; to: unknown }>
  created_at: string
}

export interface FeedStatus {
  feed_id: string
  name: string
  last_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
  zones_seen: number
  stale_after_minutes: number
}

export type DisplayState = 'active' | 'upcoming' | 'expired' | 'cancelled' | 'deactivated' | 'draft'
