import type {
  Danger,
  EvacuationAbility,
  InjurySeverity,
  MedicalNeed,
  Priority,
<<<<<<< HEAD
  ReporterUrgency,
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  Status,
  Vulnerability,
} from './constants'

export interface TriageOverride {
  priority: Priority
  reason: string
  by: string
  at: string
}

// One row of public.emergency_reports (schema.sql + migration 002).
export interface ReportRow {
  id: string
  reporter_id: string | null
  client_id: string | null
<<<<<<< HEAD
  location_lat: number | null // null = reporter gave only a landmark / address (unverified text)
  location_lng: number | null
  location_address: string | null
  location_source: 'gps' | 'manual'
  location_accuracy_m: number | null
  location_captured_at?: string | null // when the device produced the GPS fix (device clock)
  incident_time?: string | null // when the reporter says it happened (unverified)
  reporter_urgency?: ReporterUrgency | null // the reporter's own view, unverified
  submitted_offline?: boolean // created without a connection and synced later
  client_created_at?: string | null // device clock when the report was queued
  ingest_channel?: 'internet' | 'radio' | 'sms' | 'bluetooth' | 'manual' | null // how the FIRST copy reached VYRA (migration 016); empty = internet
  partial?: boolean // only the short emergency message has arrived; the full report and photos are still pending (migration 016)
=======
  location_lat: number
  location_lng: number
  location_address: string | null
  location_source: 'gps' | 'manual'
  location_accuracy_m: number | null
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  area: string | null
  people_count: number | null // null = unknown
  immediate_danger: boolean
  dangers: Danger[]
  danger_details: string | null
  injury_severity: InjurySeverity
  injury_count: number | null
  injury_details: string | null
  medical_need_types: MedicalNeed[]
  medical_needs: string | null // free-text details
  can_evacuate: EvacuationAbility
  vulnerabilities: Vulnerability[]
  contact_info: string | null
  status: Status
  verified: boolean
  resolved_at: string | null
  triage_override: TriageOverride | null
  priority_score: number
  priority_explanation: unknown
  created_at: string
  updated_at: string
}

export type NewReport = Omit<ReportRow, 'id' | 'created_at' | 'updated_at'>

export interface ReportEvent {
  id: string
  report_id: string
  action: 'created' | 'status' | 'verify' | 'override' | 'override_cleared'
  actor: string
  from_value: string | null
  to_value: string | null
  note: string | null
  created_at: string
}

export interface TriageFactor {
  key: string
  category: string
  points: number
  detail: string
}

export interface TriageResult {
  version: string
  computedAt: string
  score: number
  scorePriority: Priority
  suggestedPriority: Priority
  factors: TriageFactor[]
  safetyRules: string[]
  flags: string[]
  unknowns: string[]
  waitingMinutes: number
  summary: string
}

// A report as the dashboard and map see it.
export interface TriagedReport extends ReportRow {
  triage: TriageResult
  overridden: boolean
  priority: Priority // effective: the override if present, else the suggestion
}

export interface Shelter {
  id: string
  name: string
  location_lat: number
  location_lng: number
  address: string | null
  area: string | null
  capacity: number | null
  current_occupancy: number | null
  services: string[] | null
  status: 'open' | 'full' | 'closed'
  verified: boolean
<<<<<<< HEAD
  // Optional registry details added by migration 017 (see src/lib/shelters/types.ts for the full record). Absent on older rows.
  verification_status?: 'verified' | 'unverified' | 'needs_review' | 'rejected'
  last_verified_at?: string | null
  occupancy_updated_at?: string | null
  occupancy_basis?: 'counted' | 'reported' | 'estimated' | 'unknown'
  reserved_capacity?: number
  wheelchair_access?: 'full' | 'partial' | 'none' | 'unknown'
  responsible_org?: string | null
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

export interface RescueTeam {
  id: string
  team_name: string
  team_type: string | null
  capabilities: string[] | null
  current_location_lat: number
  current_location_lng: number
  area: string | null
  status: 'available' | 'assigned' | 'unavailable'
  verified: boolean
}

export interface BlockedRoad {
  id: string
  description: string
  reason: string
  area: string | null
  path: [number, number][] // [lat, lng] points
  verified: boolean
<<<<<<< HEAD
  // Present on real rows (timestamps default to NOW()) and on the seeded demo roads.
  created_at?: string | null
  updated_at?: string | null
  // Optional columns added by migration 006; absent until it is applied.
  verification_status?: string | null
  last_verified_at?: string | null
  expires_at?: string | null
  evidence?: unknown
  source?: string | null
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

export interface ReportSummary {
  total: number
  byPriority: Record<Priority, number>
  byStatus: Partial<Record<Status, number>>
  overridden: number
  unverified: number
}
<<<<<<< HEAD

// Metadata for a photo kept in the private `report-attachments` storage bucket.
export interface AttachmentRow {
  id: string
  report_id: string
  client_id: string // generated on the device; idempotency key for uploads
  storage_path: string
  mime_type: string
  size_bytes: number
  created_at: string
}
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
