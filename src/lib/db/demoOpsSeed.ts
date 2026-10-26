// SIMULATED DATA ONLY - the response operation behind the demo cases: teams, supplies,
// shelters, route hazards and the missions that link them to reports. Fictional throughout.
import { distanceKm } from '../constants'
import { demoShelterExtras } from '../shelters/demoData'

const uid = (kind: number, n: number) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export interface TeamDef {
  id: string
  team_name: string
  team_leader: string
  contact_number: string
  base_location: string
  team_size: number
  capabilities: string[] // matching.ts values
  capability_labels: string[] // map layer wording
  team_type: string
  area: string
  lat: number
  lng: number
  active: boolean // has a live mission in the seed
  map_status: 'available' | 'assigned' | 'unavailable'
}

type TeamInput = Omit<TeamDef, 'id' | 'map_status' | 'capability_labels'>
const LABEL: Record<string, string> = { water_rescue: 'water rescue', medical: 'first aid', search_rescue: 'collapse rescue', evacuation: 'evacuation', fire: 'fire response', logistics: 'supplies' }

const teamInputs: (TeamInput & { off?: boolean })[] = [
  { team_name: 'Boat Team Alpha', team_leader: 'Imran Shah', contact_number: '+92 300 1000001', base_location: 'Lyari river jetty', team_size: 6, capabilities: ['water_rescue', 'evacuation'], team_type: 'boat', area: 'Lyari', lat: 24.865, lng: 66.998, active: true },
  { team_name: 'Boat Team Bravo', team_leader: 'Saira Noor', contact_number: '+92 300 1000002', base_location: 'Korangi creek station', team_size: 5, capabilities: ['water_rescue'], team_type: 'boat', area: 'Korangi', lat: 24.832, lng: 67.12, active: true },
  { team_name: 'Boat Team Charlie', team_leader: 'Danish Raza', contact_number: '+92 300 1000003', base_location: 'Malir embankment', team_size: 5, capabilities: ['water_rescue', 'evacuation'], team_type: 'boat', area: 'Malir', lat: 24.892, lng: 67.195, active: true },
  { team_name: 'Boat Team Delta', team_leader: 'Kamran Ali', contact_number: '+92 300 1000004', base_location: 'Keamari harbour', team_size: 4, capabilities: ['water_rescue'], team_type: 'boat', area: 'Keamari', lat: 24.828, lng: 66.978, active: false },
  { team_name: 'Medical Unit 3', team_leader: 'Dr. Hina Farooq', contact_number: '+92 300 1000005', base_location: 'Saddar dispensary', team_size: 4, capabilities: ['medical', 'evacuation'], team_type: 'medical', area: 'Saddar', lat: 24.86, lng: 67.025, active: true },
  { team_name: 'Medical Unit 5', team_leader: 'Dr. Owais Tariq', contact_number: '+92 300 1000006', base_location: 'Gulshan clinic', team_size: 4, capabilities: ['medical'], team_type: 'medical', area: 'Gulshan-e-Iqbal', lat: 24.915, lng: 67.09, active: true },
  { team_name: 'Medical Unit 8', team_leader: 'Dr. Mariam Zaidi', contact_number: '+92 300 1000007', base_location: 'Landhi health centre', team_size: 3, capabilities: ['medical'], team_type: 'medical', area: 'Landhi', lat: 24.85, lng: 67.195, active: false },
  { team_name: 'Search & Rescue Bravo', team_leader: 'Faisal Mehmood', contact_number: '+92 300 1000008', base_location: 'Korangi fire station', team_size: 8, capabilities: ['search_rescue', 'fire'], team_type: 'search_rescue', area: 'Korangi', lat: 24.83, lng: 67.125, active: false },
  { team_name: 'Search & Rescue Echo', team_leader: 'Adeel Bukhari', contact_number: '+92 300 1000009', base_location: 'Orangi civil defence post', team_size: 7, capabilities: ['search_rescue'], team_type: 'search_rescue', area: 'Orangi', lat: 24.948, lng: 66.992, active: true },
  { team_name: 'Search & Rescue Foxtrot', team_leader: 'Rizwan Qadir', contact_number: '+92 300 1000010', base_location: 'North Nazimabad depot', team_size: 6, capabilities: ['search_rescue', 'evacuation'], team_type: 'search_rescue', area: 'North Nazimabad', lat: 24.94, lng: 67.04, active: true },
  { team_name: 'Fire Response Kilo', team_leader: 'Tahir Anwar', contact_number: '+92 300 1000011', base_location: 'Clifton fire station', team_size: 6, capabilities: ['fire', 'search_rescue'], team_type: 'fire', area: 'Clifton', lat: 24.816, lng: 67.032, active: false },
  { team_name: 'Evacuation Bus Crew 2', team_leader: 'Nasir Hameed', contact_number: '+92 300 1000012', base_location: 'Saddar bus depot', team_size: 3, capabilities: ['evacuation'], team_type: 'transport', area: 'Saddar', lat: 24.854, lng: 67.019, active: false },
  { team_name: 'Evacuation Truck Crew 4', team_leader: 'Junaid Lakhani', contact_number: '+92 300 1000013', base_location: 'Landhi truck yard', team_size: 4, capabilities: ['evacuation', 'logistics'], team_type: 'transport', area: 'Landhi', lat: 24.843, lng: 67.205, active: true },
  { team_name: 'Logistics Truck 7', team_leader: 'Shoaib Rehman', contact_number: '+92 300 1000014', base_location: 'Gulshan relief store', team_size: 3, capabilities: ['logistics'], team_type: 'logistics', area: 'Gulshan-e-Iqbal', lat: 24.923, lng: 67.09, active: false, off: true },
  { team_name: 'Logistics Truck 9', team_leader: 'Waleed Khokhar', contact_number: '+92 300 1000015', base_location: 'Malir relief store', team_size: 3, capabilities: ['logistics'], team_type: 'logistics', area: 'Malir', lat: 24.9, lng: 67.2, active: false },
  { team_name: 'Community Volunteers Orangi', team_leader: 'Parveen Akhtar', contact_number: '+92 300 1000016', base_location: 'Orangi community hall', team_size: 12, capabilities: ['evacuation', 'logistics'], team_type: 'volunteer', area: 'Orangi', lat: 24.953, lng: 66.988, active: false, off: true },
]

export const TEAM_DEFS: TeamDef[] = teamInputs.map(({ off, ...t }, i) => ({
  ...t,
  id: uid(2, i + 1),
  capability_labels: t.capabilities.map((c) => LABEL[c] ?? c),
  map_status: t.active ? 'assigned' : off ? 'unavailable' : 'available',
}))

export interface ShelterDef {
  id: string
  name: string
  address: string
  area: string
  location_lat: number
  location_lng: number
  capacity: number | null
  current_occupancy: number
  contact_number: string
  services: string[]
  status: 'open' | 'full' | 'closed'
  verified: boolean
}

const sh = (n: number, d: Omit<ShelterDef, 'id'>): ShelterDef => ({ id: uid(3, n), ...d })
export const SHELTER_DEFS: ShelterDef[] = [
  sh(1, { name: 'Govt. Boys School Shelter (Lyari)', address: 'Chakiwara road, Lyari', area: 'Lyari', location_lat: 24.874, location_lng: 66.999, capacity: 300, current_occupancy: 210, contact_number: '+92 21 5550101', services: ['food', 'water', 'medical'], status: 'open', verified: true }),
  sh(2, { name: 'Community Hall Gulshan', address: 'Block 7, Gulshan-e-Iqbal', area: 'Gulshan-e-Iqbal', location_lat: 24.918, location_lng: 67.089, capacity: 150, current_occupancy: 150, contact_number: '+92 21 5550102', services: ['food', 'water'], status: 'full', verified: true }),
  sh(3, { name: 'Malir Relief Camp', address: 'Malir cantonment road', area: 'Malir', location_lat: 24.901, location_lng: 67.19, capacity: 500, current_occupancy: 180, contact_number: '+92 21 5550103', services: ['food', 'water', 'medical', 'power'], status: 'open', verified: true }),
  sh(4, { name: 'Korangi Sports Complex', address: 'Sector 33, Korangi', area: 'Korangi', location_lat: 24.827, location_lng: 67.122, capacity: 400, current_occupancy: 90, contact_number: '+92 21 5550104', services: ['water', 'power'], status: 'open', verified: true }),
  sh(5, { name: 'Landhi Girls College Shelter', address: 'Landhi 6', area: 'Landhi', location_lat: 24.848, location_lng: 67.198, capacity: 250, current_occupancy: 240, contact_number: '+92 21 5550105', services: ['food', 'water'], status: 'open', verified: true }),
  sh(6, { name: 'Keamari Port Trust Hall', address: 'Port Trust road, Keamari', area: 'Keamari', location_lat: 24.826, location_lng: 66.979, capacity: 200, current_occupancy: 64, contact_number: '+92 21 5550106', services: ['water', 'medical'], status: 'open', verified: true }),
  sh(7, { name: 'Orangi Community Centre', address: 'Sector 11, Orangi', area: 'Orangi', location_lat: 24.951, location_lng: 66.994, capacity: 180, current_occupancy: 180, contact_number: '+92 21 5550107', services: ['food', 'water'], status: 'full', verified: true }),
  sh(8, { name: 'North Nazimabad Girls School', address: 'Block H, North Nazimabad', area: 'North Nazimabad', location_lat: 24.944, location_lng: 67.043, capacity: 220, current_occupancy: 35, contact_number: '+92 21 5550108', services: ['food', 'water', 'power'], status: 'open', verified: true }),
  sh(9, { name: 'Saddar Church Hall', address: 'Zaibunnisa street, Saddar', area: 'Saddar', location_lat: 24.855, location_lng: 67.026, capacity: 120, current_occupancy: 0, contact_number: '+92 21 5550109', services: ['water'], status: 'closed', verified: true }),
  sh(10, { name: 'Clifton Youth Centre', address: 'Block 2, Clifton', area: 'Clifton', location_lat: 24.816, location_lng: 67.029, capacity: 140, current_occupancy: 22, contact_number: '+92 21 5550110', services: ['food', 'water', 'medical'], status: 'open', verified: true }),
  // Unverified - must NOT appear on the responder map.
  sh(11, { name: 'Rumoured shelter at mosque', address: 'Orangi, unconfirmed', area: 'Orangi', location_lat: 24.945, location_lng: 66.995, capacity: null, current_occupancy: 0, contact_number: '', services: [], status: 'open', verified: false }),
]

const HAZARDS = [
  ['Lyari Expressway underpass flooded', 24.866, 66.995, 0.8, 'high'],
  ['Korangi Road submerged near Qayyumabad', 24.834, 67.1, 1.2, 'high'],
  ['Debris on Malir River bridge approach', 24.887, 67.184, 0.5, 'medium'],
  ['Landhi 89 stop road under 1 m of water', 24.847, 67.196, 1, 'high'],
  ['Orangi nullah bridge closed, cracked structure', 24.948, 66.988, 0.6, 'high'],
  ['Fallen trees on Sharae Faisal service lane', 24.86, 67.033, 0.4, 'low'],
  ['Keamari Port Road waterlogged', 24.823, 66.975, 0.9, 'medium'],
  ['Gulshan Block 7 underpass flooded', 24.92, 67.088, 0.7, 'high'],
  ['Slow traffic and mud on University Road (cleared)', 24.932, 67.105, 0.5, 'low', false],
] as const

type Row = Record<string, unknown>
interface Report {
  id: string
  status: string
  created_at: string
  resolved_at: string | null
  location_lat: number
  location_lng: number
}

/** Rows for every operations table, built from the same reports the demo store holds. */
export function buildOps(reports: Report[], now = Date.now()) {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString()
  const minAgo = (iso: string) => (now - Date.parse(iso)) / 60_000
  let hex = 0
  const rid = (kind: number) => uid(kind, ++hex)

  const rescue_teams: Row[] = TEAM_DEFS.map((t, i) => ({
    id: t.id, team_name: t.team_name, team_leader: t.team_leader, contact_number: t.contact_number,
    capabilities: t.capabilities, current_location_lat: t.lat, current_location_lng: t.lng,
    base_location: t.base_location, team_size: t.team_size,
    status: t.map_status, created_at: ago(5000 - i * 40), updated_at: ago(60),
  }))

  const resources: Row[] = []
  const addRes = (resource_type: string, name: string, quantity: number, team_id: string | null, status = 'available', notes: string | null = null) =>
    resources.push({ id: uid(4, resources.length + 1), resource_type, name, quantity, team_id, status, notes, created_at: ago(4800 - resources.length * 25), updated_at: ago(90) })
  for (const t of TEAM_DEFS) {
    const st = t.active ? 'in_use' : 'available'
    if (t.capabilities.includes('water_rescue')) {
      addRes('boat', `${t.team_name} rescue boat`, 1, t.id, st)
      addRes('first_aid', `${t.team_name} first aid kit`, 2, t.id, 'available')
    }
    if (t.capabilities.includes('medical')) {
      addRes('vehicle', `${t.team_name} ambulance`, 1, t.id, st)
      addRes('medical_supplies', `${t.team_name} trauma bags`, 6, t.id, 'available')
    }
    if (t.team_type === 'search_rescue' || t.team_type === 'fire') addRes('vehicle', `${t.team_name} utility truck`, 1, t.id, st)
    if (t.team_type === 'transport') addRes('vehicle', `${t.team_name} transport`, 1, t.id, st)
  }
  addRes('boat', 'Spare inflatable boat', 2, null, 'available')
  addRes('boat', 'Reserve boat (engine fault)', 1, null, 'maintenance', 'Outboard motor being repaired')
  addRes('vehicle', 'Reserve pickup truck', 2, null, 'available')
  addRes('first_aid', 'First aid kits, warehouse A', 24, null, 'available')
  addRes('first_aid', 'First aid kits, mobile stock', 4, null, 'in_use')
  addRes('medical_supplies', 'IV fluids and dressings', 18, null, 'available')
  addRes('medical_supplies', 'Insulin cooler packs', 3, null, 'in_use')
  addRes('medical_supplies', 'Expired ORS (set aside)', 10, null, 'maintenance', 'Past date, awaiting disposal')
  addRes('food', 'Dry ration packs, Malir store', 120, null, 'available')
  addRes('food', 'Dry ration packs, Gulshan store', 2, null, 'available', 'Almost gone, restock needed')
  addRes('food', 'Cooked meals, camps', 40, null, 'in_use')
  addRes('water', 'Bottled water crates, Lyari', 6, null, 'in_use')
  addRes('water', 'Bottled water crates, Korangi', 4, null, 'in_use')
  addRes('water', 'Water tanker (leaking)', 1, null, 'maintenance')

  const route_hazards: Row[] = HAZARDS.map((h, i) => ({
    id: uid(5, i + 1), description: h[0], location_lat: h[1], location_lng: h[2], radius_km: h[3], severity: h[4],
    active: h.length > 5 ? h[5] : true, created_at: ago(1500 - i * 90),
  }))

  const shelters: Row[] = SHELTER_DEFS.map((s, i) => ({ ...s, ...demoShelterExtras(i), created_at: ago(3000 - i * 60) }))

  // Missions: each live team takes the nearest unassigned "assigned" case; finished cases get a completed mission.
  const dispatches: Row[] = []
  const dispatch_resources: Row[] = []
  const activeTeams = TEAM_DEFS.filter((t) => t.active)
  const assigned = reports.filter((r) => r.status === 'assigned')
  const stages = ['pending', 'en_route', 'on_scene', 'en_route', 'on_scene', 'pending', 'en_route', 'on_scene']
  // Pair live teams with the cases they are closest to (smallest distances first), so seeded missions are plausible.
  const pairs = activeTeams
    .flatMap((t) => assigned.map((r) => ({ t, r, d: distanceKm([t.lat, t.lng], [r.location_lat, r.location_lng]) })))
    .sort((x, y) => x.d - y.d)
  const usedTeams = new Set<string>()
  const usedReports = new Set<string>()
  const chosen: typeof pairs = []
  for (const p of pairs) {
    if (usedTeams.has(p.t.id) || usedReports.has(p.r.id)) continue
    usedTeams.add(p.t.id)
    usedReports.add(p.r.id)
    chosen.push(p)
  }
  chosen.forEach(({ t: team, r, d: dist }, i) => {
    const when = Math.max(3, Math.min(minAgo(r.created_at) - 2, 8 + i * 5))
    const id = rid(6)
    dispatches.push({
      id, report_id: r.id, team_id: team.id, assigned_by: null, assigned_at: ago(when), status: stages[i % stages.length],
      notes: i % 3 === 0 ? 'Access road is partly flooded, approach from the north side.' : null,
      match_score: 62 + ((i * 11) % 34), distance_km: +dist.toFixed(1),
      match_explanation: { breakdown: {}, warnings: dist > 8 ? ['Long distance: expect a slower arrival'] : [] },
      completed_at: null, created_at: ago(when), updated_at: ago(Math.max(1, when - 2)),
    })
    for (const res of resources.filter((x) => x.team_id === team.id && x.status === 'in_use' && ['boat', 'vehicle'].includes(x.resource_type as string)))
      dispatch_resources.push({ id: rid(7), dispatch_id: id, resource_id: res.id, quantity: res.quantity })
  })
  // The in-use shared stock is referenced by the first mission so allocations are traceable.
  const done = reports.filter((r) => r.status === 'resolved' && r.resolved_at)
  done.forEach((r, i) => {
    const team = [...TEAM_DEFS].sort((a, b) => distanceKm([a.lat, a.lng], [r.location_lat, r.location_lng]) - distanceKm([b.lat, b.lng], [r.location_lat, r.location_lng]))[i % 3]
    const resolvedAgo = minAgo(r.resolved_at!)
    const start = Math.max(resolvedAgo + 5, Math.min(resolvedAgo + 25 + (i % 7) * 6, minAgo(r.created_at) - 5))
    dispatches.push({
      id: rid(6), report_id: r.id, team_id: team.id, assigned_by: null, assigned_at: ago(start), status: 'completed', notes: i % 4 === 0 ? 'Family moved to the nearest shelter.' : null,
      match_score: 58 + ((i * 7) % 38), distance_km: +distanceKm([team.lat, team.lng], [r.location_lat, r.location_lng]).toFixed(1),
      match_explanation: { breakdown: {}, warnings: [] }, completed_at: r.resolved_at, created_at: ago(start), updated_at: r.resolved_at,
    })
  })
  dispatches.sort((a, b) => String(b.assigned_at).localeCompare(String(a.assigned_at)))

  const profiles: Row[] = []
  return { rescue_teams, resources, route_hazards, shelters, dispatches, dispatch_resources, profiles }
}
