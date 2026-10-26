// Shared fixtures for the shelter tests. Everything here is fictional.
import type { Hazard } from '../../src/lib/routing/types'
import type { DisasterZone } from '../../src/lib/zones/types'
import type { ShelterRecord } from '../../src/lib/shelters/types'
import { normaliseShelter } from '../../src/lib/shelters/facilities'

export const NOW = new Date('2026-10-25T10:00:00.000Z')
export const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
export const daysAgo = (d: number) => minsAgo(d * 1440)
export const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

export const ORIGIN: [number, number] = [24.9, 67.0]
// ~1.1 km per 0.01 degrees of latitude.
export const at = (dLat: number, dLng = 0): [number, number] => [ORIGIN[0] + dLat, ORIGIN[1] + dLng]

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
export const documented = (when = minsAgo(60 * 24 * 3)) => ({ value: 'yes' as const, documented_at: when, note: null })

/** A healthy verified shelter ~4.4 km north of ORIGIN, with fresh counted occupancy. Override anything. */
export function shelter(over: Record<string, unknown> = {}): ShelterRecord {
  const loc = (over.loc as [number, number] | undefined) ?? at(0.04)
  const { loc: _l, ...rest } = over
  return normaliseShelter({
    id: uuid(), name: 'Test Shelter', location_lat: loc[0], location_lng: loc[1], address: 'Somewhere', area: 'Test', capacity: 200, current_occupancy: 50,
    services: [], status: 'open', verified: true, verification_status: 'verified', last_verified_at: daysAgo(2), verified_by: 'u', location_verified: true,
    occupancy_updated_at: minsAgo(20), occupancy_basis: 'counted', wheelchair_access: 'unknown', facilities: {
      drinking_water: documented(), sanitation: documented(), food: documented(),
    }, responsible_org: 'Test Org', data_source: 'Site visit', reserved_capacity: 0, authorized_overflow: 0, ...rest,
  })
}

export const hazard = (over: Partial<Hazard> & { at?: [number, number] } = {}): Hazard => ({
  id: uuid(), sourceTable: 'route_hazards', kind: 'flooding', description: 'Test flooding', source: 'Test', geometry: { type: 'point', point: over.at ?? at(0.04), radiusM: 200 },
  reportedAt: minsAgo(30), lastVerifiedAt: minsAgo(30), verification: 'confirmed', severity: 'high', evidence: [], expiresAt: null, blocksRoad: null, ...over,
}) as Hazard

export const zone = (over: Partial<DisasterZone> & { around?: [number, number]; sizeDeg?: number } = {}): DisasterZone => {
  const c = over.around ?? at(0.04)
  const d = over.sizeDeg ?? 0.01
  const ring: [number, number][] = [[c[1] - d, c[0] - d], [c[1] + d, c[0] - d], [c[1] + d, c[0] + d], [c[1] - d, c[0] + d], [c[1] - d, c[0] - d]]
  const { around: _a, sizeDeg: _s, ...rest } = over
  return {
    id: uuid(), name: 'Test zone', zone_type: 'danger', severity: 'high', hazard_type: 'flood', geometry: { type: 'Polygon', coordinates: [ring] }, boundary_kind: 'drawn', boundary_quality: 'official',
    radius_m: null, radius_basis: null, description: '', precautions: null, status_detail: null, evacuation_status: null, source_type: 'official_manual', source_name: 'Test', source_url: null,
    external_id: null, feed_id: null, verification_status: 'official', lifecycle: 'active', valid_from: null, valid_until: null, related_report_ids: [], related_shelter_ids: [], related_road_ids: [],
    bbox: [0, 0, 0, 0], revision: 1, change_reason: null, source_updated_at: null, created_by: null, created_by_name: null, updated_by: null, created_at: minsAgo(500), updated_at: minsAgo(500), ...rest,
  } as DisasterZone
}
