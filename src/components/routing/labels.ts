import type { HazardKind, Proximity, RouteFinding, RouteStatus, Verification } from '@/lib/routing/types'

export const KIND_LABEL: Record<HazardKind, string> = {
  road_closure: 'Road closure', flooding: 'Flooding', damaged_infrastructure: 'Damaged infrastructure', structural_collapse: 'Structural collapse',
  debris: 'Debris / obstruction', fire: 'Fire', landslide: 'Landslide', electrical: 'Electrical hazard', gas_leak: 'Gas leak', other: 'Hazard (type not recorded)',
}
export const VERIFY_LABEL: Record<Verification, string> = { confirmed: 'Confirmed', unverified: 'Unverified', resolved: 'Resolved (not current)', expired: 'Expired (not current)' }
export const SEVERITY_LABEL = { low: 'Low severity', medium: 'Medium severity', high: 'High severity', critical: 'Critical severity' } as const
export const PROXIMITY_LABEL: Record<Proximity, string> = { on_route: 'On the route', near_route: 'Near the route' }

// Shape + word carry the meaning, colour only reinforces it.
export const STATUS_STYLE: Record<RouteStatus, { icon: 'alert' | 'flame' | 'info' | 'eye'; cls: string }> = {
  known_blockage: { icon: 'alert', cls: 'bg-critical-100 text-critical-700 border-critical-700' },
  hazard_reported: { icon: 'flame', cls: 'bg-warning-100 text-warning-700 border-warning-700' },
  limited_information: { icon: 'info', cls: 'bg-sand-200 text-ink-800 border-ink-600' },
  no_hazards_found: { icon: 'eye', cls: 'bg-ink-50 text-ink-900 border-ink-700' },
}

export function formatAge(min: number | null): string {
  if (min === null) return 'age unknown'
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''} ago`
}

export function ageLine(f: RouteFinding): string {
  const reported = f.reportedAt ? `reported ${formatAge(Math.max(0, Math.round((Date.now() - Date.parse(f.reportedAt)) / 60000)))}` : 'report time unknown'
  const verified = f.lastVerifiedAt ? `last verified ${formatAge(Math.max(0, Math.round((Date.now() - Date.parse(f.lastVerifiedAt)) / 60000)))}` : 'never verified'
  return `${reported}; ${verified}${f.freshness === 'stale' ? ' - STALE' : f.freshness === 'unknown' ? ' - age cannot be judged' : ''}`
}

export const km = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
export const mins = (s: number) => (s < 90 ? `${Math.max(1, Math.round(s / 60))} min` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`)
