// Shared types for AI Route and Hazard Analysis.
//
// Design rule that runs through every file here: nothing in this module family may turn "no data"
// into "safe". Statuses describe what the AVAILABLE data says; they are never safety guarantees.

export type LatLng = [number, number] // [lat, lng], same order as the rest of VYRA

export const VEHICLE_TYPES = ['car', 'ambulance', 'rescue_truck', 'fire_truck'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]
// Recognised but not routable on a road network. Rejected with a clear message, never silently rerouted.
export const UNSUPPORTED_VEHICLES = ['boat', 'helicopter'] as const

export type HazardKind =
  | 'road_closure'
  | 'flooding'
  | 'damaged_infrastructure'
  | 'structural_collapse'
  | 'debris'
  | 'fire'
  | 'landslide'
  | 'electrical'
  | 'gas_leak'
  | 'other'

export type Verification = 'unverified' | 'confirmed' | 'resolved' | 'expired'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type HazardSourceTable = 'route_hazards' | 'blocked_roads' | 'emergency_reports'

export type HazardGeometry =
  | { type: 'point'; point: LatLng; radiusM: number }
  | { type: 'line'; path: LatLng[] }

// One normalised hazard, whichever table it came from. Fields that the source cannot supply are null,
// never invented.
export interface Hazard {
  id: string
  sourceTable: HazardSourceTable
  kind: HazardKind
  description: string
  source: string // human-readable origin, e.g. "Blocked-road register"
  geometry: HazardGeometry
  reportedAt: string | null
  lastVerifiedAt: string | null
  verification: Verification
  severity: Severity
  evidence: string[]
  expiresAt: string | null
  // true  = the record itself says the road is closed/impassable
  // null  = unknown whether the road can still be used
  blocksRoad: boolean | null
}

export interface SkippedHazard {
  id: string
  sourceTable: HazardSourceTable
  reason: string
}

export interface SourceStatus {
  name: string
  table: HazardSourceTable
  ok: boolean
  count: number
  newestAt: string | null
  error?: string
}

export interface HazardDataset {
  hazards: Hazard[]
  skipped: SkippedHazard[]
  sources: SourceStatus[]
  loadedAt: string
}

export type Proximity = 'on_route' | 'near_route'
export type Freshness = 'fresh' | 'stale' | 'unknown'

export interface RouteFinding {
  hazardId: string
  sourceTable: HazardSourceTable
  kind: HazardKind
  description: string
  source: string
  severity: Severity
  verification: Verification
  proximity: Proximity
  distanceM: number
  alongRouteM: number | null
  reportedAt: string | null
  lastVerifiedAt: string | null
  ageMinutes: number | null
  freshness: Freshness
  blocksRoad: boolean | null
  // 'active' hazards count toward the route's status. 'inactive' (resolved / expired) are shown for
  // transparency only: resolved is not "current", and it is not proof the road is clear either.
  state: 'active' | 'inactive'
  duplicateOf: string | null
  duplicateIds: string[]
  location: LatLng // where to draw the marker
  path: LatLng[] | null // affected road segment, for line hazards
  evidence: string[]
}

export type RouteStatus = 'known_blockage' | 'hazard_reported' | 'limited_information' | 'no_hazards_found'
export type Recommendation = 'candidate_for_dispatcher_review' | 'review_required' | 'not_recommended'

export interface Limitation {
  code:
    | 'source_unavailable'
    | 'dataset_empty'
    | 'no_local_data'
    | 'stale_local_data'
    | 'unlocatable_records'
    | 'coverage_partial'
    | 'unusual_detour'
    | 'stale_hazard'
    | 'unknown_age_hazard'
    | 'exclusions_unsupported'
    | 'vehicle_restrictions_unknown'
    | 'road_access_unverified'
  message: string
  // true = this limitation alone prevents the route from being called "no hazards found".
  blocksCandidate: boolean
}

export interface RouteAiNotes {
  summary: string
  whyUnsuitable: string | null
  uncertainties: string[]
  verifyBeforeApproval: string[]
}

export interface CandidateRoute {
  id: string
  rank: number
  distanceM: number
  durationS: number
  geometry: LatLng[] // simplified for display only; matching used the full geometry
  status: RouteStatus
  statusLabel: string
  recommendation: Recommendation
  findings: RouteFinding[]
  limitations: Limitation[]
  rankReasons: string[]
  exposure: {
    // Weighted count of hazards, used only to order candidates. NOT a probability and NOT a safety rating.
    score: number
    closures: number
    activeOnRoute: number
    confirmedOnRoute: number
    unverifiedOnRoute: number
    nearRoute: number
    inactiveOnRoute: number
  }
  coverage: { state: 'complete' | 'partial'; originSnapM: number; destinationSnapM: number }
  roadAccess: { verified: false; vehicle: VehicleType; note: string }
  recalculated: boolean
  avoidedHazardIds: string[]
  ai: RouteAiNotes | null
}

export type AiStatus =
  | { state: 'ok'; model: string }
  | { state: 'not_configured' }
  | { state: 'skipped' }
  | { state: 'unavailable'; reason: string }
  | { state: 'invalid_output'; reason: string }

export interface AnalysisResult {
  analysisId: string | null // null = the audit record could not be saved, so decisions cannot be recorded
  auditSaved: boolean
  analyzedAt: string
  vehicle: VehicleType
  origin: LatLng
  destination: LatLng
  provider: { id: string; name: string; supportsExclusions: boolean; note: string | null }
  recalculation: { attempted: boolean; usedExclusions: boolean; note: string }
  candidates: CandidateRoute[]
  notices: string[]
  dataFreshness: { sources: SourceStatus[]; newestRecordAt: string | null; skippedRecords: number; recordsConsidered: number }
  aiDuplicateGroups: { hazardIds: string[]; reason: string }[]
  aiExtractions: { hazardId: string; affectsRoadway: 'yes' | 'no' | 'unclear'; vehicleRestrictions: string[] }[]
  ai: AiStatus
  disclaimer: string
}

export const DISCLAIMER =
  'VYRA provides decision support, not a guarantee of road safety. A dispatcher must approve any route using current, authoritative information. If there is an immediate emergency, contact emergency services now; do not wait for this analysis.'

export const STATUS_LABELS: Record<RouteStatus, string> = {
  known_blockage: 'Known blockage',
  hazard_reported: 'Hazard reported',
  limited_information: 'Limited information',
  no_hazards_found: 'No hazards found in available data',
}
