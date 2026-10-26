// SIMULATED registry details for the demo shelters (fictional, like the rest of the demo seed). Applied on top of the existing
// SHELTER_DEFS rows by demoOpsSeed.ts so there is still ONE demo shelter table. Indexed in SHELTER_DEFS order.
// The mix is deliberate: fresh and stale records, documented and undocumented facilities, one unverified and one closed shelter,
// so every flag and exclusion in the shelter tools can be seen on the demo.
type Row = Record<string, unknown>
const doc = (ago: number) => (now: number) => ({ value: 'yes', documented_at: new Date(now - ago * 60_000).toISOString(), note: null })
const D = doc(60 * 24 * 4)
const iso = (now: number, minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
const ALL_DAY = { open24h: true }

export function demoShelterExtras(index: number, now = Date.now()): Row {
  const base = { reserved_capacity: 0, authorized_overflow: 0, auto_full: false, location_source: 'Simulated survey' }
  const d = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, D(now)]))
  const verified = (days: number) => ({ verification_status: 'verified', last_verified_at: iso(now, days * 1440), verified_by: null, location_verified: true, location_verified_at: iso(now, days * 1440) })
  switch (index) {
    case 0: return { ...base, ...verified(3), responsible_org: 'Simulated Education Department', data_source: 'Simulated site visit', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 25), occupancy_basis: 'counted', wheelchair_access: 'partial', facilities: d('drinking_water', 'food', 'sanitation', 'medical_support'), infrastructure_dependencies: ['grid_power'] }
    case 1: return { ...base, ...verified(2), responsible_org: 'Simulated Community Association', data_source: 'Simulated phone call', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 15), occupancy_basis: 'counted', wheelchair_access: 'full', facilities: d('drinking_water', 'food', 'sanitation', 'step_free_entry') }
    case 2: return { ...base, ...verified(5), responsible_org: 'Simulated District Administration', data_source: 'Simulated site visit', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 40), occupancy_basis: 'counted', wheelchair_access: 'full', facilities: d('drinking_water', 'food', 'sanitation', 'electricity', 'backup_power', 'medical_support', 'oxygen_support', 'family_accommodation', 'step_free_entry', 'accessible_toilets', 'maternal_support', 'mobility_assistance'), infrastructure_dependencies: [] }
    case 3: return { ...base, ...verified(9), responsible_org: 'Simulated Sports Board', data_source: 'Simulated site visit', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 60 * 7), occupancy_basis: 'reported', wheelchair_access: 'full', facilities: d('drinking_water', 'sanitation', 'electricity', 'step_free_entry', 'family_accommodation'), infrastructure_dependencies: ['grid_power', 'single_access_road'] }
    case 4: return { ...base, ...verified(4), responsible_org: 'Simulated College Administration', data_source: 'Simulated phone call', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 90), occupancy_basis: 'estimated', wheelchair_access: 'none', facilities: d('drinking_water', 'food') }
    case 5: return { ...base, ...verified(60), responsible_org: 'Simulated Port Authority', data_source: 'Simulated site visit', opening_hours: { weekly: Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((x) => [x, [['06:00', '22:00']]])), timezone: 'Asia/Karachi' }, occupancy_updated_at: iso(now, 200), occupancy_basis: 'reported', wheelchair_access: 'unknown', facilities: d('drinking_water', 'medical_support') }
    case 6: return { ...base, ...verified(2), responsible_org: 'Simulated Municipal Office', data_source: 'Simulated phone call', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 30), occupancy_basis: 'counted', wheelchair_access: 'partial', facilities: d('drinking_water', 'food', 'sanitation') }
    case 7: return { ...base, ...verified(6), responsible_org: 'Simulated Education Department', data_source: 'Simulated site visit', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 20), occupancy_basis: 'counted', wheelchair_access: 'none', facilities: d('drinking_water', 'food', 'sanitation', 'electricity', 'family_accommodation', 'maternal_support'), infrastructure_dependencies: ['grid_power'] }
    case 8: return { ...base, ...verified(14), responsible_org: 'Simulated Church Council', data_source: 'Simulated phone call', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 600), occupancy_basis: 'reported', wheelchair_access: 'unknown', facilities: d('drinking_water') }
    case 9: return { ...base, ...verified(1), responsible_org: 'Simulated Youth Services', data_source: 'Simulated site visit', opening_hours: ALL_DAY, occupancy_updated_at: iso(now, 10), occupancy_basis: 'counted', wheelchair_access: 'full', facilities: d('drinking_water', 'food', 'sanitation', 'medical_support', 'oxygen_support', 'backup_power', 'electricity', 'step_free_entry', 'accessible_toilets', 'family_accommodation') }
    default: return { ...base, verification_status: 'unverified', last_verified_at: null, verified_by: null, location_verified: false, location_verified_at: null, responsible_org: null, data_source: 'Unconfirmed rumour', opening_hours: null, occupancy_updated_at: null, occupancy_basis: 'unknown', wheelchair_access: 'unknown', facilities: {} }
  }
}
