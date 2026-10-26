// Shared vocabularies for emergency reports (Stages 4-6).
// Keys are stored in the database; labels are what people see.

export const DANGERS = {
  trapped: 'Trapped / cannot get out',
  drowning: 'Person in water / drowning',
  rising_water: 'Rising flood water',
  building_collapse: 'Building collapse',
  fire: 'Fire',
  electrocution: 'Live electrical hazard',
  landslide: 'Landslide / mudslide',
  gas_leak: 'Gas leak',
  extreme_heat: 'Extreme heat exposure',
  stranded: 'Stranded (no immediate threat)',
  no_shelter: 'No shelter',
  no_food_water: 'No food or clean water',
<<<<<<< HEAD
  earthquake: 'Earthquake damage or aftershocks',
  blocked_road: 'Blocked road or route',
  medical_emergency: 'Medical emergency',
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  other: 'Other danger',
  none: 'No immediate danger',
} as const

export const INJURY_SEVERITIES = {
  none: 'No injuries',
  minor: 'Minor (cuts, bruises)',
  serious: 'Serious (fractures, heavy bleeding)',
  critical: 'Critical (unconscious, not breathing)',
  unknown: 'Not sure',
} as const

export const MEDICAL_NEEDS = {
  essential_medication: 'Essential medication running out',
  insulin: 'Insulin / diabetes',
  dialysis: 'Dialysis',
  oxygen: 'Oxygen / breathing support',
  pregnancy_labor: 'Pregnancy / in labour',
  heart_condition: 'Heart condition',
  chronic_illness: 'Other chronic illness',
  mental_health: 'Mental health crisis',
  other: 'Other medical need',
} as const

export const VULNERABILITIES = {
  elderly: 'Elderly people',
  infants_children: 'Infants or young children',
  disability: 'Person with disability',
  bedridden: 'Bedridden / cannot walk',
  pregnant: 'Pregnant',
} as const

export const EVACUATION_ABILITY = {
  yes: 'Can evacuate on their own',
  no: 'Cannot evacuate without help',
  unknown: 'Not sure',
} as const

// Matches the report_status enum in supabase/schema.sql (+ 'cancelled' from migration 002).
export const STATUSES = {
  pending: 'New',
  investigating: 'Investigating',
  assigned: 'Team assigned',
  resolved: 'Resolved',
  cancelled: 'Cancelled / duplicate',
} as const

<<<<<<< HEAD
// What the reporter believes about urgency. Always shown as unverified; it never changes the
// computed triage score and never dispatches anyone (responders decide).
export const REPORTER_URGENCY = {
  low: 'Low: no one is in immediate danger',
  medium: 'Medium: help is needed soon',
  high: 'High: help is needed urgently',
  critical: 'Critical: life is in danger now',
} as const
export type ReporterUrgency = keyof typeof REPORTER_URGENCY

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
export const OPEN_STATUSES: Status[] = ['pending', 'investigating', 'assigned']

export const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export type Danger = keyof typeof DANGERS
export type InjurySeverity = keyof typeof INJURY_SEVERITIES
export type MedicalNeed = keyof typeof MEDICAL_NEEDS
export type Vulnerability = keyof typeof VULNERABILITIES
export type EvacuationAbility = keyof typeof EVACUATION_ABILITY
export type Status = keyof typeof STATUSES
export type Priority = (typeof PRIORITIES)[number]

// Operational areas for filtering and auto-assignment.
// Simulated demo set for Karachi; replace with real response zones for a deployment.
export const AREAS: { name: string; center: [number, number] }[] = [
  { name: 'Saddar', center: [24.8556, 67.0228] },
  { name: 'Lyari', center: [24.868, 66.993] },
  { name: 'Keamari', center: [24.825, 66.975] },
  { name: 'Clifton', center: [24.814, 67.03] },
  { name: 'Korangi', center: [24.83, 67.13] },
  { name: 'Landhi', center: [24.845, 67.2] },
  { name: 'Malir', center: [24.893, 67.205] },
  { name: 'Gulshan-e-Iqbal', center: [24.92, 67.095] },
  { name: 'North Nazimabad', center: [24.942, 67.04] },
  { name: 'Orangi', center: [24.95, 66.99] },
]

export const DEFAULT_CENTER: [number, number] = [24.88, 67.07]
const MAX_ASSIGN_KM = 12

export function distanceKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Nearest operational area, or 'Unassigned' when the point is far from all of them.
export function nearestArea(lat: number, lng: number): string {
  let best: { name: string; d: number } | null = null
  for (const area of AREAS) {
    const d = distanceKm([lat, lng], area.center)
    if (!best || d < best.d) best = { name: area.name, d }
  }
  return best && best.d <= MAX_ASSIGN_KM ? best.name : 'Unassigned'
}
