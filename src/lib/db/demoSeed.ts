// SIMULATED DATA ONLY - an urban flooding scenario in Karachi for demos and tests.
<<<<<<< HEAD
// Mirrors supabase/seed/vyra_full_seed.sql. Names and numbers are fictional.

import { AREAS, nearestArea } from '../constants'
import { hasLifeThreat } from '../triage'
import { SHELTER_DEFS, TEAM_DEFS } from './demoOpsSeed'
=======
// Mirrors supabase/migrations/003_demo_seed.sql. Names and numbers are fictional.

import { nearestArea } from '../constants'
import { hasLifeThreat } from '../triage'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import type { BlockedRoad, NewReport, RescueTeam, Shelter } from '../types'

type SeedReport = Partial<NewReport> & { minutesAgo: number; resolvedMinutesAgo?: number; location_lat: number; location_lng: number }

const reports: SeedReport[] = [
  {
    minutesAgo: 35, location_lat: 24.8702, location_lng: 66.9912, location_source: 'gps', location_accuracy_m: 12,
    location_address: 'Behind Chakiwara market, blue gate', people_count: 6,
    dangers: ['rising_water', 'trapped'], danger_details: 'Water at chest level on the ground floor. Family is on the roof and cannot get out.',
    injury_severity: 'none', can_evacuate: 'no', vulnerabilities: ['elderly', 'infants_children'],
    contact_info: 'Simulated - A. Baloch · +92 300 0000001', verified: true, status: 'investigating',
  },
  {
    minutesAgo: 20, location_lat: 24.8335, location_lng: 67.1352, location_source: 'manual',
    location_address: 'Korangi sector 5, near the school', people_count: 1, dangers: ['stranded'],
    injury_severity: 'none', medical_need_types: ['dialysis'], medical_needs: 'Missed dialysis yesterday, roads to the hospital are flooded.',
    can_evacuate: 'no', vulnerabilities: ['elderly'], contact_info: 'Simulated - R. Khan · +92 300 0000002',
  },
  {
    minutesAgo: 8, location_lat: 24.8212, location_lng: 66.9781, location_source: 'gps', location_accuracy_m: 25,
    location_address: 'Keamari, near the fish harbour wall', people_count: 3, dangers: ['building_collapse'],
    danger_details: 'Part of the wall collapsed, one man is unconscious under debris.',
    injury_severity: 'critical', injury_count: 1, injury_details: 'Unconscious, bleeding from the head', can_evacuate: 'unknown',
  },
  {
    minutesAgo: 95, location_lat: 24.9215, location_lng: 67.0981, location_source: 'gps', location_accuracy_m: 40,
    location_address: 'Gulshan block 13, apartment block C', people_count: 40, dangers: ['no_food_water', 'no_shelter'],
    danger_details: 'Power out for two days, no clean water for the building.', injury_severity: 'none',
    medical_need_types: ['insulin', 'chronic_illness'], can_evacuate: 'yes', vulnerabilities: ['elderly', 'infants_children'],
    contact_info: 'Simulated - Building committee · +92 300 0000003', verified: true,
  },
  {
    minutesAgo: 5, location_lat: 24.9488, location_lng: 66.9875, location_source: 'manual',
    location_address: 'Orangi town, near the nullah bridge', people_count: null, dangers: [],
    danger_details: 'Please help, water everywhere', injury_severity: 'unknown', can_evacuate: 'unknown',
  },
  {
    minutesAgo: 50, location_lat: 24.8581, location_lng: 67.0205, location_source: 'gps', location_accuracy_m: 8,
    location_address: 'Saddar, Empress market side road', people_count: 2, dangers: ['electrocution'],
    danger_details: 'Electric pole fallen into flood water next to the house.', injury_severity: 'minor', injury_count: 1,
    can_evacuate: 'yes', verified: true, status: 'assigned',
  },
  {
    minutesAgo: 140, location_lat: 24.896, location_lng: 67.201, location_source: 'gps', location_accuracy_m: 15,
    location_address: 'Malir, near the river embankment', people_count: 12, dangers: ['rising_water'],
    injury_severity: 'serious', injury_count: 2, injury_details: 'Two people with fractures from a fall',
    medical_need_types: ['pregnancy_labor'], medical_needs: 'One woman is in labour.', can_evacuate: 'no',
    vulnerabilities: ['pregnant', 'infants_children'], contact_info: 'Simulated - Z. Ahmed · +92 300 0000004',
  },
  {
    minutesAgo: 70, location_lat: 24.815, location_lng: 67.0322, location_source: 'manual',
    location_address: 'Clifton block 2', people_count: 4, dangers: ['none'], injury_severity: 'none',
    medical_need_types: ['essential_medication'], medical_needs: 'Blood pressure medication will run out tomorrow.',
    can_evacuate: 'yes', vulnerabilities: ['elderly'], verified: true,
  },
  {
    minutesAgo: 15, location_lat: 24.9433, location_lng: 67.0418, location_source: 'gps', location_accuracy_m: 350,
    location_address: 'North Nazimabad block H', people_count: 8, dangers: ['stranded'],
    danger_details: 'Car stuck in underpass, people standing on the roof of the car', injury_severity: 'none',
    can_evacuate: 'unknown', vulnerabilities: ['disability'],
  },
  {
    minutesAgo: 300, resolvedMinutesAgo: 120, location_lat: 24.847, location_lng: 67.1985, location_source: 'gps',
    location_accuracy_m: 20, location_address: 'Landhi, 89 stop', people_count: 5, dangers: ['no_shelter'],
    injury_severity: 'none', can_evacuate: 'yes', verified: true, status: 'resolved',
  },
]

<<<<<<< HEAD

// ---- Generated scenario data -------------------------------------------------------------
// A deterministic generator (same data every start) that widens the hand-written cases above
// into a realistic multi-day flood response: ~80 cases across all ten areas, every urgency
// level, and every status. All names, numbers and contacts are fictional.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLACES: Record<string, string[]> = {
  Saddar: ['Burns Road, above the sweet shop', 'Empress Market back lane', 'Zainab Market, second floor flats', 'Frere Town, near the old cinema'],
  Lyari: ['Chakiwara, lane 4', 'Kalri, near the football ground', 'Baghdadi, by the water tank', 'Agra Taj colony, green door'],
  Keamari: ['Baba Island jetty road', 'Maripur, near the truck stand', 'Sultanabad, behind the dispensary', 'Fish harbour, shed 6'],
  Clifton: ['Block 5, near the underpass', 'Boat Basin, side street', 'Defence phase 2, bungalow row', 'Seaview, beach road shacks'],
  Korangi: ['Sector 31, near the mosque', 'Korangi crossing, shop row', 'Qayyumabad, street 9', 'Industrial area, gate 3 workers camp'],
  Landhi: ['Landhi 6, near the park', 'Sherpao colony, lane 2', 'Muslimabad, behind the school', 'Model colony, canal side'],
  Malir: ['Malir Halt, by the railway line', 'Jafar-e-Tayyar, street 12', 'Saudabad, near the bridge', 'Model colony, block C'],
  'Gulshan-e-Iqbal': ['Block 7, apartment tower', 'Block 10, near the hospital', 'Safoora chowrangi, side road', 'Block 3, behind the petrol pump'],
  'North Nazimabad': ['Block A, near the graveyard wall', 'Block L, corner shop', 'Five Star, service road', 'Block N, double-storey houses'],
  Orangi: ['Sector 11, near the nullah', 'Qasba colony, lane 7', 'Pakistan Bazaar, upstairs rooms', 'Sector 5, behind the clinic'],
}
const AREA_WEIGHT: Record<string, number> = { Lyari: 10, Malir: 10, Korangi: 9, Orangi: 9, Keamari: 8, Landhi: 8, 'Gulshan-e-Iqbal': 7, 'North Nazimabad': 6, Saddar: 5, Clifton: 4 }
const NAMES = ['A. Baloch', 'R. Khan', 'Z. Ahmed', 'F. Siddiqui', 'M. Qureshi', 'S. Hussain', 'N. Ansari', 'T. Memon', 'H. Rizvi', 'K. Sheikh', 'Y. Chaudhry', 'B. Jamali', 'I. Soomro', 'L. Mirza', 'G. Panhwar']

type Scenario = Partial<NewReport> & { w: number; people: [number, number] }
const SCENARIOS: Scenario[] = [
  { w: 10, people: [3, 9], dangers: ['rising_water'], danger_details: 'Water is coming into the house, now above the knees.', injury_severity: 'none', can_evacuate: 'unknown' },
  { w: 8, people: [2, 7], dangers: ['rising_water', 'trapped'], danger_details: 'Stuck on the first floor, stairs are under water.', injury_severity: 'none', can_evacuate: 'no', vulnerabilities: ['elderly'] },
  { w: 6, people: [1, 4], dangers: ['stranded'], danger_details: 'Car stalled in flood water, people waiting on the roof.', injury_severity: 'none', can_evacuate: 'unknown' },
  { w: 5, people: [4, 20], dangers: ['no_food_water'], danger_details: 'No clean drinking water since yesterday. Children are getting sick.', injury_severity: 'none', can_evacuate: 'yes', vulnerabilities: ['infants_children'] },
  { w: 4, people: [1, 3], dangers: ['none'], injury_severity: 'none', medical_need_types: ['essential_medication'], medical_needs: 'Out of regular heart medication, pharmacy is cut off.', can_evacuate: 'yes', vulnerabilities: ['elderly'] },
  { w: 3, people: [1, 2], dangers: ['none'], injury_severity: 'none', medical_need_types: ['insulin'], medical_needs: 'Insulin needs refrigeration and power has been out for a day.', can_evacuate: 'yes' },
  { w: 3, people: [1, 1], dangers: ['stranded'], injury_severity: 'none', medical_need_types: ['oxygen'], medical_needs: 'Uses an oxygen concentrator, battery is almost empty.', can_evacuate: 'no', vulnerabilities: ['bedridden'] },
  { w: 3, people: [2, 6], dangers: ['building_collapse'], danger_details: 'Roof of a neighbouring house has fallen in. People may be inside.', injury_severity: 'serious', injury_count: 1, injury_details: 'Leg injury, cannot stand', can_evacuate: 'no' },
  { w: 3, people: [1, 5], dangers: ['electrocution'], danger_details: 'Sparking cable hanging over the flooded lane.', injury_severity: 'minor', injury_count: 1, can_evacuate: 'yes' },
  { w: 2, people: [3, 10], dangers: ['fire'], danger_details: 'Fire in a shop below the flats, smoke on the stairs.', injury_severity: 'minor', injury_count: 2, can_evacuate: 'unknown' },
  { w: 3, people: [5, 30], dangers: ['no_shelter'], danger_details: 'Families sleeping outside after their homes flooded.', injury_severity: 'none', can_evacuate: 'yes', vulnerabilities: ['infants_children', 'pregnant'] },
  { w: 2, people: [1, 2], dangers: ['drowning'], danger_details: 'A child fell into the drain channel and was pulled out, not breathing well.', injury_severity: 'critical', injury_count: 1, can_evacuate: 'no' },
  { w: 2, people: [1, 3], dangers: ['gas_leak'], danger_details: 'Strong gas smell after the pipe broke in the flood.', injury_severity: 'none', can_evacuate: 'yes' },
  { w: 2, people: [1, 1], dangers: ['none'], injury_severity: 'none', medical_need_types: ['dialysis'], medical_needs: 'Dialysis is due tomorrow, road to the hospital is under water.', can_evacuate: 'no', vulnerabilities: ['elderly'] },
  { w: 2, people: [1, 2], dangers: ['none'], injury_severity: 'none', medical_need_types: ['pregnancy_labor'], medical_needs: 'Contractions every ten minutes.', can_evacuate: 'no', vulnerabilities: ['pregnant'] },
  { w: 7, people: [1, 4], dangers: ['none'], danger_details: 'We are safe at home. Please check on us when someone is free.', injury_severity: 'none', can_evacuate: 'yes' },
  { w: 4, people: [2, 6], dangers: ['no_food_water'], danger_details: 'Can manage another day with what we have.', injury_severity: 'none', can_evacuate: 'yes' },
  { w: 2, people: [null as unknown as number, null as unknown as number], dangers: [], danger_details: 'Water everywhere, please send someone', injury_severity: 'unknown', can_evacuate: 'unknown' },
]

function pickWeighted<T extends { w: number }>(items: T[], r: () => number): T {
  let t = r() * items.reduce((a, b) => a + b.w, 0)
  for (const it of items) if ((t -= it.w) <= 0) return it
  return items[items.length - 1]
}

// How many generated cases, and how their statuses are spread. Exported for tests.
export const GENERATED_COUNT = 70
const ASSIGNED_GENERATED = 7

let cache: SeedReport[] | null = null
function generatedReports(): SeedReport[] {
  if (cache) return cache.map((r) => ({ ...r }))
  const r = rng(20241017)
  const areas = AREAS.map((a) => ({ ...a, w: AREA_WEIGHT[a.name] ?? 5 }))
  const out: SeedReport[] = []
  for (let i = 0; i < GENERATED_COUNT; i++) {
    const area = pickWeighted(areas, r)
    const sc = pickWeighted(SCENARIOS, r)
    const { w, people, ...fields } = sc
    void w
    const lat = +(area.center[0] + (r() - 0.5) * 0.03).toFixed(5)
    const lng = +(area.center[1] + (r() - 0.5) * 0.03).toFixed(5)
    const gps = r() < 0.6
    // Status: the first few are active missions, a third are finished, the rest are waiting.
    let status: NewReport['status'] = 'pending'
    let minutesAgo = 5 + Math.floor(r() * 240)
    let resolvedMinutesAgo: number | undefined
    if (i < ASSIGNED_GENERATED) status = 'assigned'
    else if (i < ASSIGNED_GENERATED + 9) status = 'investigating'
    else if (i < ASSIGNED_GENERATED + 9 + 22) {
      status = 'resolved'
      minutesAgo = 300 + Math.floor(r() * 2400)
      resolvedMinutesAgo = Math.max(10, minutesAgo - (60 + Math.floor(r() * 240)))
    } else if (i < ASSIGNED_GENERATED + 9 + 22 + 3) {
      status = 'cancelled'
      minutesAgo = 200 + Math.floor(r() * 900)
    }
    const named = r() < 0.5
    out.push({
      ...fields,
      minutesAgo,
      resolvedMinutesAgo,
      location_lat: lat,
      location_lng: lng,
      location_source: gps ? 'gps' : 'manual',
      location_accuracy_m: gps ? 8 + Math.floor(r() * 90) : null,
      location_address: `${area.name}: ${PLACES[area.name][Math.floor(r() * 4)]}`,
      people_count: people[0] == null ? null : people[0] + Math.floor(r() * (people[1] - people[0] + 1)),
      contact_info: named ? `Simulated - ${NAMES[Math.floor(r() * NAMES.length)]} · +92 300 0${String(1000 + i * 7).padStart(6, '0')}` : null,
      verified: status !== 'pending' ? r() < 0.9 : r() < 0.3,
      status,
    })
  }
  cache = out
  return out.map((x) => ({ ...x }))
}

const ago = (min: number, now: number) => new Date(now - min * 60_000).toISOString()

export function demoReports(now = Date.now()) {
  return [...reports, ...generatedReports()].map(({ minutesAgo, resolvedMinutesAgo, ...r }, i) => {
=======
const ago = (min: number, now: number) => new Date(now - min * 60_000).toISOString()

export function demoReports(now = Date.now()) {
  return reports.map(({ minutesAgo, resolvedMinutesAgo, ...r }, i) => {
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    const created = ago(minutesAgo, now)
    const row = {
      reporter_id: null,
      client_id: `demo-seed-${i + 1}`,
      location_source: 'manual' as const,
      location_accuracy_m: null,
      location_address: null,
      people_count: null,
      dangers: [],
      danger_details: null,
      injury_severity: 'unknown' as const,
      injury_count: null,
      injury_details: null,
      medical_need_types: [],
      medical_needs: null,
      can_evacuate: 'unknown' as const,
      vulnerabilities: [],
      contact_info: null,
      status: 'pending' as const,
      verified: false,
      triage_override: null,
      priority_score: 0,
      priority_explanation: null,
      ...r,
      area: nearestArea(r.location_lat, r.location_lng),
      immediate_danger: hasLifeThreat(r.dangers),
      resolved_at: resolvedMinutesAgo != null ? ago(resolvedMinutesAgo, now) : null,
    }
    return { ...row, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, created_at: created, updated_at: created }
  })
}

<<<<<<< HEAD

export const demoShelters: Shelter[] = SHELTER_DEFS.map((s) => ({
  id: s.id, name: s.name, location_lat: s.location_lat, location_lng: s.location_lng, address: s.address, area: s.area,
  capacity: s.capacity, current_occupancy: s.current_occupancy, services: s.services, status: s.status, verified: s.verified,
}))

export const demoTeams: RescueTeam[] = TEAM_DEFS.map((t) => ({
  id: t.id, team_name: t.team_name, team_type: t.team_type, capabilities: t.capability_labels, current_location_lat: t.lat, current_location_lng: t.lng,
  area: t.area, status: t.map_status, verified: true,
}))

let n = 0
const id = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

// Simulated report times (minutes before the server started), so route analysis can show real data ages.
const roadAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
export const demoRoadBlocks: BlockedRoad[] = [
  { id: id(), description: 'Lyari Expressway underpass flooded', reason: 'flooding', area: 'Lyari', path: [[24.862, 66.988], [24.866, 66.995], [24.87, 67.001]], verified: true, created_at: roadAgo(95) },
  { id: id(), description: 'Korangi Road submerged near Qayyumabad', reason: 'flooding', area: 'Korangi', path: [[24.836, 67.088], [24.834, 67.1], [24.832, 67.11]], verified: true, created_at: roadAgo(140) },
  { id: id(), description: 'Debris on Malir River bridge approach', reason: 'debris', area: 'Malir', path: [[24.885, 67.18], [24.888, 67.186]], verified: true, created_at: roadAgo(60) },
  { id: id(), description: 'Landhi 89 stop road under 1 m of water', reason: 'flooding', area: 'Landhi', path: [[24.846, 67.19], [24.848, 67.202]], verified: true, created_at: roadAgo(200) },
  { id: id(), description: 'Orangi nullah bridge closed, structure cracked', reason: 'structural', area: 'Orangi', path: [[24.947, 66.985], [24.949, 66.992]], verified: true, created_at: roadAgo(45) },
  { id: id(), description: 'Fallen trees on Sharae Faisal service lane', reason: 'debris', area: 'Saddar', path: [[24.858, 67.03], [24.862, 67.036]], verified: true, created_at: roadAgo(180) },
  { id: id(), description: 'Keamari Port Road waterlogged', reason: 'flooding', area: 'Keamari', path: [[24.82, 66.97], [24.826, 66.98]], verified: true, created_at: roadAgo(75) },
  { id: id(), description: 'Gulshan Block 7 underpass flooded', reason: 'flooding', area: 'Gulshan-e-Iqbal', path: [[24.918, 67.085], [24.922, 67.092]], verified: true, created_at: roadAgo(110) },
  // Unverified - hidden from the map.
  { id: id(), description: 'Possible block on University Road', reason: 'other', area: 'Gulshan-e-Iqbal', path: [[24.93, 67.1], [24.935, 67.11]], verified: false, created_at: roadAgo(30) },
=======
let n = 0
const id = () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

export const demoShelters: Shelter[] = [
  { id: id(), name: 'Govt. Boys School Shelter (Lyari)', location_lat: 24.874, location_lng: 66.999, address: null, area: 'Lyari', capacity: 300, current_occupancy: 210, services: ['food', 'water', 'medical'], status: 'open', verified: true },
  { id: id(), name: 'Community Hall Gulshan', location_lat: 24.918, location_lng: 67.089, address: null, area: 'Gulshan-e-Iqbal', capacity: 150, current_occupancy: 150, services: ['food', 'water'], status: 'full', verified: true },
  { id: id(), name: 'Malir Relief Camp', location_lat: 24.901, location_lng: 67.19, address: null, area: 'Malir', capacity: 500, current_occupancy: 180, services: ['food', 'water', 'medical', 'power'], status: 'open', verified: true },
  { id: id(), name: 'Korangi Sports Complex', location_lat: 24.827, location_lng: 67.122, address: null, area: 'Korangi', capacity: 400, current_occupancy: 90, services: ['water', 'power'], status: 'open', verified: true },
  // Unverified - must NOT appear on the responder map.
  { id: id(), name: 'Rumoured shelter at mosque', location_lat: 24.945, location_lng: 66.995, address: null, area: 'Orangi', capacity: null, current_occupancy: 0, services: [], status: 'open', verified: false },
]

export const demoTeams: RescueTeam[] = [
  { id: id(), team_name: 'Boat Team Alpha', team_type: 'boat', capabilities: ['water rescue'], current_location_lat: 24.865, current_location_lng: 66.998, area: 'Lyari', status: 'assigned', verified: true },
  { id: id(), team_name: 'Medical Unit 3', team_type: 'medical', capabilities: ['first aid', 'ambulance'], current_location_lat: 24.86, current_location_lng: 67.025, area: 'Saddar', status: 'available', verified: true },
  { id: id(), team_name: 'Search & Rescue Bravo', team_type: 'search_rescue', capabilities: ['collapse rescue'], current_location_lat: 24.83, current_location_lng: 67.125, area: 'Korangi', status: 'available', verified: true },
  { id: id(), team_name: 'Boat Team Charlie', team_type: 'boat', capabilities: ['water rescue'], current_location_lat: 24.892, current_location_lng: 67.195, area: 'Malir', status: 'available', verified: true },
  { id: id(), team_name: 'Logistics Truck 7', team_type: 'logistics', capabilities: ['supplies'], current_location_lat: 24.923, current_location_lng: 67.09, area: 'Gulshan-e-Iqbal', status: 'unavailable', verified: true },
]

export const demoRoadBlocks: BlockedRoad[] = [
  { id: id(), description: 'Lyari Expressway underpass flooded', reason: 'flooding', area: 'Lyari', path: [[24.862, 66.988], [24.866, 66.995], [24.87, 67.001]], verified: true },
  { id: id(), description: 'Korangi Road submerged near Qayyumabad', reason: 'flooding', area: 'Korangi', path: [[24.836, 67.088], [24.834, 67.1], [24.832, 67.11]], verified: true },
  { id: id(), description: 'Debris on Malir River bridge approach', reason: 'debris', area: 'Malir', path: [[24.885, 67.18], [24.888, 67.186]], verified: true },
  // Unverified - hidden from the map.
  { id: id(), description: 'Possible block on University Road', reason: 'other', area: 'Gulshan-e-Iqbal', path: [[24.93, 67.1], [24.935, 67.11]], verified: false },
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
]
