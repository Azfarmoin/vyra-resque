// Intelligent Shelter Placement Assistant: shared types.
//
// This module EXTENDS the existing `shelters` table / `Shelter` type (src/lib/types.ts). It does not introduce a second
// shelter registry. Every new field is optional on the wire and defaulted by `normaliseShelter` so rows written before
// migration 012 (and the demo seed) keep working.
//
// Design rule, same as src/lib/routing/types.ts: nothing here may turn "no data" into "safe" or "available".
import type { LatLng } from '../routing/types'

export type Tri = 'yes' | 'no' | 'unknown'

export const FACILITY_KEYS = [
  'drinking_water', 'sanitation', 'electricity', 'backup_power', 'food', 'medical_support', 'oxygen_support',
  'medication_refrigeration', 'family_accommodation', 'infant_supplies', 'step_free_entry', 'accessible_toilets',
  'mobility_assistance', 'maternal_support',
] as const
export type FacilityKey = (typeof FACILITY_KEYS)[number]

export const FACILITY_LABELS: Record<FacilityKey, string> = {
  drinking_water: 'Drinking water', sanitation: 'Sanitation / toilets', electricity: 'Electricity', backup_power: 'Backup power',
  food: 'Food', medical_support: 'Medical support', oxygen_support: 'Oxygen support', medication_refrigeration: 'Medication refrigeration',
  family_accommodation: 'Family accommodation', infant_supplies: 'Infant supplies', step_free_entry: 'Step-free entry',
  accessible_toilets: 'Accessible toilets', mobility_assistance: 'Mobility assistance', maternal_support: 'Maternal / pregnancy support',
}

/** A facility claim. It only counts as DOCUMENTED when value is 'yes' AND documented_at is set (someone recorded it). */
export interface FacilityClaim { value: Tri; documented_at?: string | null; note?: string | null }
export type FacilityMap = Partial<Record<FacilityKey, FacilityClaim>>

export type WheelchairAccess = 'full' | 'partial' | 'none' | 'unknown'
export type OccupancyBasis = 'counted' | 'reported' | 'estimated' | 'unknown'
export type ShelterVerification = 'verified' | 'unverified' | 'needs_review' | 'rejected'
export type ShelterStatus = 'open' | 'full' | 'closed'

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export interface OpeningHours {
  open24h?: boolean
  timezone?: string // IANA zone; defaults to DEFAULT_TIMEZONE
  weekly?: Partial<Record<(typeof WEEKDAYS)[number], [string, string][]>> // 'HH:MM' pairs
  note?: string | null
}

export interface ShelterRecord {
  // ---- existing columns (unchanged meaning) ----
  id: string
  name: string
  location_lat: number | null
  location_lng: number | null
  address: string | null
  area: string | null
  capacity: number | null // MAXIMUM capacity
  current_occupancy: number | null
  services: string[] | null // legacy free list; mapped into `facilities` as UNDOCUMENTED claims
  status: ShelterStatus
  verified: boolean
  contact_number?: string | null
  // ---- added by migration 012 ----
  reserved_capacity: number // seats held by active reservations (maintained inside the reservation functions)
  authorized_overflow: number // extra seats allowed by an active authorized exception (0 normally)
  auto_full: boolean // status 'full' was set by the system when occupancy reached capacity (so it may reopen)
  location_verified: boolean
  location_verified_at: string | null
  location_source: string | null
  opening_hours: OpeningHours | null
  last_verified_at: string | null
  verified_by: string | null
  verification_status: ShelterVerification
  responsible_org: string | null
  data_source: string | null
  occupancy_updated_at: string | null
  occupancy_basis: OccupancyBasis
  wheelchair_access: WheelchairAccess
  facilities: FacilityMap
  infrastructure_dependencies: string[] // e.g. 'grid_power', 'municipal_water', 'single_access_road'
  created_at?: string | null
  updated_at?: string | null
}

// ---- needs of an evacuation group (counts only: no names, no diagnoses) ----
export interface GroupNeeds {
  partySize: number
  wheelchairUsers?: number
  mobilityAssistance?: number
  oxygenUsers?: number
  essentialMedication?: number // people who need their medication kept/accessible
  infants?: number
  elderly?: number
  pregnant?: number
  keepFamilyTogether?: boolean
}

export type ReservationStatus = 'reserved' | 'arrived' | 'departed' | 'cancelled' | 'expired'
export const ACTIVE_RESERVATION: ReservationStatus[] = ['reserved', 'arrived']

export interface ReservationRecord {
  id: string
  shelter_id: string
  group_key: string // unique while active: prevents double-booking one group at two shelters
  group_label: string // short dispatcher label, NOT a person's name
  incident_id: string | null // emergency_reports.id
  dispatch_id: string | null // dispatches.id (existing mission)
  party_size: number
  needs: Omit<GroupNeeds, 'partySize'>
  status: ReservationStatus
  expected_arrival_at: string | null
  hold_expires_at: string
  confirmed_arrival_at: string | null
  confirmed_by: string | null
  arrived_count: number
  departed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  exception_id: string | null
  idempotency_key: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type ExceptionKind = 'over_capacity' | 'closed_use'
export interface ShelterException {
  id: string
  shelter_id: string
  kind: ExceptionKind
  extra_capacity: number // over_capacity only
  reason: string
  authorized_by: string // admin user id
  authorized_by_name: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface ShelterAuditEntry {
  id: string
  shelter_id: string | null
  reservation_id: string | null
  action: string
  actor_id: string
  actor_role: string
  detail: Record<string, unknown>
  created_at: string
}

export interface Actor { id: string; name: string; role: 'citizen' | 'responder' | 'admin' | null }

export class ShelterError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message)
  }
}

export type { LatLng }
