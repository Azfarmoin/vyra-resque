// SIMULATED DATA ONLY. A large, fully generated flood-response dataset for Karachi: thousands of cases, hundreds of
// teams and shelters, with missions, supplies and audit history. Everything is fictional and deterministic
// (same seed -> same data), and none of it comes from the older small demo set.
//
// Used by:
//   * scripts/generate-seed-large.mts  -> supabase/seed/vyra_large_seed.sql (cloud Supabase)
//   * demo mode when VYRA_DEMO_DATASET=large (in-memory; `npm run dev:demo:large`)
//
// Locations are APPROXIMATE points scattered around each operational area; they are not surveyed addresses.
import { AREAS, distanceKm, nearestArea } from '../constants'
import { hasLifeThreat, triageReport } from '../triage'

type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LargeSizes { admins: number; responders: number; citizens: number; reports: number; teams: number; shelters: number; hazards: number; roads: number }
export const LARGE_SIZES: LargeSizes = { admins: 5, responders: 80, citizens: 600, reports: 6000, teams: 520, shelters: 350, hazards: 600, roads: 450 }

// ---------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]
  const chance = (p: number) => next() < p
  const weighted = <T,>(xs: readonly [T, number][]): T => {
    const total = xs.reduce((s, [, w]) => s + w, 0)
    let r = next() * total
    for (const [v, w] of xs) { r -= w; if (r <= 0) return v }
    return xs[xs.length - 1][0]
  }
  const jitter = (c: number, spread: number) => c + (next() - 0.5) * 2 * spread
  return { next, int, pick, chance, weighted, jitter }
}

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------
const LOCALITIES: Record<string, string[]> = {
  Saddar: ['Saddar Bazaar', 'Frere Town', 'Garden East', 'Civil Lines', 'Soldier Bazaar', 'Ranchore Line', 'PIB Colony', 'Lines Area', 'Tariq Road side'],
  Lyari: ['Chakiwara', 'Baghdadi', 'Kalakot', 'Agra Taj Colony', 'Shah Baig Lane', 'Bihar Colony', 'Nawa Lane', 'Singo Lane', 'Allama Iqbal Road'],
  Keamari: ['Baba Island', 'Maripur', 'Fish Harbour', 'Machar Colony', 'Sultanabad', 'Native Jetty', 'Port Trust area', 'Shireen Jinnah side', 'Bhit Island'],
  Clifton: ['Block 5', 'Boat Basin', 'Defence Phase 2', 'Zamzama', 'Sea View', 'Bath Island', 'Block 2', 'Block 8', 'Clifton beach road'],
  Korangi: ['Korangi Industrial Area', 'Qayyumabad', 'Shah Faisal Colony', 'Zaman Town', 'Chakra Goth', 'Korangi Crossing', 'Mehran Town', 'Sector 33', 'Sector 6'],
  Landhi: ['Landhi 36B', 'Landhi 89', 'Sharafi Goth', 'Awami Colony', 'Muzaffarabad Colony', 'Bhains Colony', 'Landhi 6', 'Landhi Industrial Area', 'Quaidabad side'],
  Malir: ['Saudabad', 'Malir City', 'Model Colony', 'Jinnah Square', 'Shah Latif Town', 'Quaidabad', 'Ibrahim Hyderi', 'Memon Goth', 'Malir Halt'],
  'Gulshan-e-Iqbal': ['Block 13-D', 'Block 7', 'Block 10-A', 'Gulistan-e-Jauhar', 'Safoora Chowrangi', 'University Road', 'Pehlwan Goth', 'Johar Mor', 'Nipa Chowrangi'],
  'North Nazimabad': ['Block A', 'Block H', 'Block L', 'Buffer Zone', 'Sakhi Hasan', 'Hyderi Market', 'Paposh Nagar', 'Five Star Chowrangi', 'Nazimabad No. 3'],
  Orangi: ['Sector 11½', 'Mominabad', 'Qasba Colony', 'Banaras Chowk', 'Pakhtun Abad', 'Hanifabad', 'Ghaziabad', 'Orangi Sector 5', 'Baldia side'],
}
const LANDMARKS = ['near the nullah bridge', 'behind the main market', 'next to the mosque', 'opposite the petrol pump', 'near the primary school', 'by the water tank', 'on the service road', 'near the bus stop', 'above the pharmacy', 'beside the community hall', 'near the graveyard wall', 'at the end of the lane', 'behind the transformer', 'near the dispensary']
const FIRST_M = ['Ahmed', 'Bilal', 'Danish', 'Faisal', 'Hamza', 'Imran', 'Junaid', 'Kamran', 'Luqman', 'Mustafa', 'Nadeem', 'Omar', 'Qasim', 'Rashid', 'Saad', 'Tariq', 'Umair', 'Waqas', 'Yasir', 'Zeeshan', 'Arslan', 'Babar', 'Fahad', 'Ghazanfar', 'Haris', 'Irfan', 'Jawad', 'Khalid', 'Latif', 'Moiz', 'Noman', 'Owais', 'Pervez', 'Raheel', 'Shahid', 'Talha', 'Usman', 'Wasim', 'Zubair', 'Adeel']
const FIRST_F = ['Aisha', 'Bushra', 'Dua', 'Eman', 'Fatima', 'Gulnaz', 'Hina', 'Iqra', 'Javeria', 'Kiran', 'Laiba', 'Mahnoor', 'Nazia', 'Rabia', 'Sana', 'Tahira', 'Uzma', 'Warda', 'Zainab', 'Amna', 'Bisma', 'Farah', 'Humaira', 'Mehreen', 'Nimra', 'Rukhsana', 'Saima', 'Shazia', 'Sumbul', 'Yusra']
const LAST = ['Khan', 'Ahmed', 'Ali', 'Hussain', 'Shah', 'Malik', 'Qureshi', 'Siddiqui', 'Baloch', 'Memon', 'Ansari', 'Chaudhry', 'Sheikh', 'Rizvi', 'Abbasi', 'Jamali', 'Mirza', 'Pirzada', 'Soomro', 'Bhatti', 'Lodhi', 'Hashmi', 'Zaidi', 'Farooqui', 'Mughal', 'Raza', 'Naqvi', 'Kazmi', 'Junejo', 'Panhwar']
const NATO = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango']

type Scenario = {
  key: string; weight: number
  dangers: string[]; extra?: string[]
  text: string[]
  people: [number, number]
  injury: [string, number][]
  medical?: { types: string[]; text: string[]; p: number }
  evac: [string, number][]
  vuln: number
  noPeople?: number
}
const SCENARIOS: Scenario[] = [
  { key: 'flood_trapped', weight: 8, dangers: ['rising_water', 'trapped'], extra: ['stranded', 'no_food_water'], people: [2, 11], injury: [['none', 70], ['minor', 22], ['serious', 8]], evac: [['no', 70], ['unknown', 22], ['yes', 8]], vuln: 0.55,
    text: ['Water is up to the first floor and still rising. We are on the roof.', 'Ground floor is under water. The stairs are blocked, we cannot get out.', 'Flood water entered the house at night. Family is on the terrace, no boat can reach the lane.', 'Water at chest height in the lane. Children are with us upstairs and the door is jammed.'] },
  { key: 'flood_stranded', weight: 20, dangers: ['stranded', 'no_shelter'], extra: ['no_food_water'], people: [1, 14], injury: [['none', 85], ['minor', 15]], evac: [['yes', 45], ['no', 30], ['unknown', 25]], vuln: 0.4,
    text: ['Roads are flooded around us and we cannot leave. No immediate danger but no way out.', 'Our street is a river. We are safe upstairs but cut off since this morning.', 'Water has surrounded the building. We need to be taken to a shelter.', 'Home flooded, we have moved to a neighbour\'s roof and need shelter for the night.'] },
  { key: 'medical_flood', weight: 7, dangers: ['stranded', 'medical_emergency'], people: [1, 4], injury: [['none', 55], ['minor', 20], ['serious', 20], ['critical', 5]], evac: [['no', 80], ['unknown', 20]], vuln: 0.8,
    medical: { types: ['dialysis', 'insulin', 'oxygen', 'essential_medication', 'heart_condition', 'pregnancy_labor', 'chronic_illness'], p: 1, text: ['Missed dialysis and roads to the hospital are flooded.', 'Insulin is running out and the fridge has no power.', 'Oxygen cylinder will last a few more hours.', 'Heart patient, chest pain on and off, cannot reach the clinic.', 'Wife is in labour and the ambulance cannot get through.', 'Out of blood-pressure medication for two days.'] },
    text: ['Medical need and the road is flooded.', 'Patient needs hospital care and we cannot move on our own.', 'Elderly patient at home, medicine finished, water in the lane.'] },
  { key: 'collapse', weight: 3, dangers: ['building_collapse', 'trapped'], extra: ['fire'], people: [1, 9], injury: [['minor', 25], ['serious', 40], ['critical', 28], ['unknown', 7]], evac: [['no', 75], ['unknown', 25]], vuln: 0.3,
    text: ['A wall and part of the roof came down after the rain. Someone is under the debris.', 'Old building collapsed on one side, we can hear people calling.', 'Boundary wall fell on a shed with workers inside.', 'Ceiling of the upper floor collapsed, two people are trapped under it.'] },
  { key: 'fire', weight: 3, dangers: ['fire'], extra: ['trapped', 'gas_leak'], people: [1, 30], injury: [['none', 40], ['minor', 35], ['serious', 20], ['critical', 5]], evac: [['yes', 40], ['no', 35], ['unknown', 25]], vuln: 0.25,
    text: ['Fire in a shop below the flats, smoke on the stairs.', 'Short circuit started a fire in the wiring, the lane is full of water so the fire truck cannot come.', 'Fire in a godown, we are worried it will spread to the houses.', 'Kitchen fire after the gas cylinder leaked, neighbours are trying to put it out.'] },
  { key: 'electrical', weight: 4, dangers: ['electrocution'], extra: ['rising_water', 'stranded'], people: [1, 12], injury: [['none', 70], ['minor', 15], ['serious', 10], ['critical', 5]], evac: [['unknown', 40], ['yes', 30], ['no', 30]], vuln: 0.2,
    text: ['A live wire is lying in the flood water in our lane. Nobody can pass.', 'The transformer is sparking and water is around its base.', 'Electric pole leaning with wires in the water, children play nearby.', 'Someone got a shock touching the iron gate in the water.'] },
  { key: 'no_food_water', weight: 16, dangers: ['no_food_water'], extra: ['no_shelter', 'stranded'], people: [3, 60], injury: [['none', 92], ['minor', 8]], evac: [['yes', 60], ['no', 15], ['unknown', 25]], vuln: 0.6,
    text: ['No clean water and no food since yesterday for the whole building.', 'Power is out and the water supply is cut. We have infants and elderly people here.', 'Neighbourhood is cut off, shops closed, children are hungry.', 'Our water storage is contaminated by flood water. We need drinking water.'] },
  { key: 'blocked_road', weight: 12, dangers: ['blocked_road'], extra: ['stranded'], people: [1, 25], injury: [['none', 90], ['minor', 10]], evac: [['yes', 55], ['unknown', 35], ['no', 10]], vuln: 0.25,
    text: ['The only road out is blocked by fallen trees and debris.', 'A bus is stuck in the underpass and passengers are waiting.', 'Road washed out near the culvert, vehicles cannot pass.', 'Heavy vehicle broke down in the flooded road and blocks both lanes.'] },
  { key: 'drowning', weight: 1.5, dangers: ['drowning', 'rising_water'], people: [1, 5], injury: [['serious', 35], ['critical', 45], ['unknown', 20]], evac: [['no', 60], ['unknown', 40]], vuln: 0.2,
    text: ['A child fell in the open drain and has not come out.', 'Someone was swept off their feet crossing the flooded road.', 'Man fell into the nullah water, people are trying to reach him.'] },
  { key: 'gas_leak', weight: 1.5, dangers: ['gas_leak'], extra: ['fire'], people: [2, 20], injury: [['none', 60], ['minor', 30], ['serious', 10]], evac: [['yes', 50], ['unknown', 50]], vuln: 0.3,
    text: ['Strong smell of gas in the building after the flooding.', 'Gas pipeline damaged in the lane, hissing sound.'] },
  { key: 'earthquake', weight: 1, dangers: ['earthquake', 'building_collapse'], extra: ['trapped'], people: [2, 15], injury: [['minor', 40], ['serious', 40], ['critical', 20]], evac: [['unknown', 50], ['no', 30], ['yes', 20]], vuln: 0.35,
    text: ['Cracks in the walls after the tremor and part of the staircase fell.', 'Aftershock felt, the building leans and we are outside but afraid to go back.'] },
  { key: 'heat', weight: 8, dangers: ['extreme_heat'], extra: ['no_food_water', 'no_shelter'], people: [1, 20], injury: [['none', 50], ['minor', 35], ['serious', 15]], evac: [['yes', 50], ['no', 25], ['unknown', 25]], vuln: 0.7,
    text: ['Extreme heat and no power. An elderly person is dizzy and not drinking.', 'Several people feel faint, no fans or water in the room.', 'Workers collapsed in the heat at the yard and need cooling and water.'] },
  { key: 'landslide', weight: 1, dangers: ['landslide'], extra: ['trapped', 'blocked_road'], people: [1, 10], injury: [['none', 40], ['minor', 30], ['serious', 30]], evac: [['no', 50], ['unknown', 50]], vuln: 0.3,
    text: ['Soil slid from the embankment behind the houses after the rain.', 'Mud and rocks came down on the lane, one house is half buried.'] },
  { key: 'vague', weight: 8, dangers: [], people: [0, 0], injury: [['unknown', 100]], evac: [['unknown', 100]], vuln: 0, noPeople: 1,
    text: ['Please help, water everywhere.', 'Help needed. Not sure what to do.', 'Flooding here, please send someone.', 'There is a problem in our area.', 'Emergency, please come.'] },
  { key: 'medical', weight: 4, dangers: ['medical_emergency'], extra: ['stranded'], people: [1, 3], injury: [['serious', 40], ['critical', 20], ['minor', 25], ['unknown', 15]], evac: [['no', 70], ['unknown', 30]], vuln: 0.5,
    medical: { types: ['heart_condition', 'pregnancy_labor', 'essential_medication', 'oxygen', 'chronic_illness', 'mental_health'], p: 0.9, text: ['Possible heart attack, needs an ambulance.', 'Pregnant woman with severe pain.', 'Asthma attack, inhaler empty.', 'Seizure patient, medication washed away.'] },
    text: ['Someone is seriously unwell and cannot be moved.', 'Patient collapsed at home, hospital road is flooded.'] },
]

const VULNS = ['elderly', 'infants_children', 'disability', 'bedridden', 'pregnant']
const SERVICES = ['food', 'water', 'medical', 'bedding', 'sanitation', 'power', 'childcare']

const pad = (n: number, w: number) => String(n).padStart(w, '0')
// Each kind has its own id prefix (a1..a9) so seed rows never collide with the older seed (0, 1-7, 9).
const uid = (kind: number, n: number) => `a${kind}000000-0000-4000-8000-${pad(n, 12)}`

export interface LargeDataset {
  accounts: { id: string; email: string; full_name: string; role: 'admin' | 'responder' | 'citizen' }[]
  reports: Row[]
  report_events: Row[]
  rescue_teams: Row[]
  resources: Row[]
  shelters: Row[]
  route_hazards: Row[]
  blocked_roads: Row[]
  dispatches: Row[]
  dispatch_resources: Row[]
}

export function buildLargeDataset(now = Date.now(), sizes: LargeSizes = LARGE_SIZES, opts: { withUsers?: boolean } = {}): LargeDataset {
  const R = rng(20261026)
  const { int, pick, chance, weighted, jitter } = R
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  const minutes = (m: number) => m * 60_000
  const phone = () => `+92 3${int(0, 4)}${int(0, 9)} ${pad(int(0, 9999999), 7)}`
  const person = () => `${chance(0.55) ? pick(FIRST_M) : pick(FIRST_F)} ${pick(LAST)}`
  const areaNames = AREAS.map((a) => a.name)
  const pointIn = (area: string, spread = 0.04): [number, number] => {
    const c = AREAS.find((a) => a.name === area)!.center
    return [+jitter(c[0], spread).toFixed(5), +jitter(c[1], spread * 1.1).toFixed(5)]
  }
  const areaWeights: [string, number][] = [['Lyari', 12], ['Korangi', 11], ['Malir', 11], ['Orangi', 12], ['Landhi', 9], ['Keamari', 8], ['Gulshan-e-Iqbal', 10], ['Saddar', 6], ['North Nazimabad', 8], ['Clifton', 5]]

  // ---- accounts ------------------------------------------------------------------------------
  const accounts: LargeDataset['accounts'] = []
  const usedNames = new Set<string>()
  const uniqueName = () => { for (let i = 0; i < 50; i++) { const n = person(); if (!usedNames.has(n)) { usedNames.add(n); return n } } return `${person()} ${usedNames.size}` }
  accounts.push({ id: uid(9, 1), email: 'admin@seed.vyra', full_name: 'Maryam Hashmi', role: 'admin' })
  for (let i = 2; i <= sizes.admins; i++) accounts.push({ id: uid(9, i), email: `admin${i}@seed.vyra`, full_name: uniqueName(), role: 'admin' })
  for (let i = 1; i <= sizes.responders; i++) accounts.push({ id: uid(9, 100 + i), email: `responder${pad(i, 2)}@seed.vyra`, full_name: uniqueName(), role: 'responder' })
  for (let i = 1; i <= sizes.citizens; i++) accounts.push({ id: uid(9, 1000 + i), email: `citizen${pad(i, 3)}@seed.vyra`, full_name: uniqueName(), role: 'citizen' })
  const responderIds = accounts.filter((a) => a.role !== 'citizen').map((a) => a.id)
  const citizenIds = accounts.filter((a) => a.role === 'citizen').map((a) => a.id)

  // ---- teams ---------------------------------------------------------------------------------
  const TEAM_KINDS: { type: string; label: string; caps: string[]; size: [number, number]; w: number }[] = [
    { type: 'boat', label: 'Boat Team', caps: ['water_rescue', 'evacuation'], size: [4, 8], w: 20 },
    { type: 'medical', label: 'Medical Unit', caps: ['medical', 'evacuation'], size: [3, 6], w: 20 },
    { type: 'search_rescue', label: 'Search & Rescue', caps: ['search_rescue', 'evacuation'], size: [5, 10], w: 18 },
    { type: 'fire', label: 'Fire Response', caps: ['fire', 'search_rescue'], size: [5, 8], w: 8 },
    { type: 'transport', label: 'Evacuation Crew', caps: ['evacuation'], size: [3, 6], w: 14 },
    { type: 'logistics', label: 'Relief Truck', caps: ['logistics'], size: [2, 4], w: 12 },
    { type: 'volunteers', label: 'Volunteer Group', caps: ['evacuation', 'logistics'], size: [6, 20], w: 8 },
  ]
  const teams: Row[] = []
  const teamCounter: Record<string, number> = {}
  for (let i = 0; i < sizes.teams; i++) {
    const kind = weighted(TEAM_KINDS.map((k) => [k, k.w] as [typeof k, number]))
    const area = weighted(areaWeights)
    const loc = pick(LOCALITIES[area])
    teamCounter[kind.type] = (teamCounter[kind.type] ?? 0) + 1
    const n = teamCounter[kind.type]
    const [lat, lng] = pointIn(area, 0.035)
    const caps = chance(0.25) && kind.type !== 'boat' ? [...kind.caps, pick(['logistics', 'medical', 'evacuation'])].filter((c, j, a) => a.indexOf(c) === j) : kind.caps
    teams.push({
      id: uid(2, i + 1), team_name: `${kind.label} ${NATO[(n - 1) % NATO.length]}${n > NATO.length ? ' ' + Math.ceil(n / NATO.length) : ''} (${area})`,
      team_leader: person(), contact_number: phone(), base_location: `${loc}, ${area}`, team_size: int(kind.size[0], kind.size[1]),
      capabilities: caps, current_location_lat: lat, current_location_lng: lng, team_type: kind.type, area, status: 'available', verified: chance(0.93),
      created_at: iso(minutes(int(60 * 24 * 10, 60 * 24 * 40))), updated_at: iso(minutes(int(5, 600))),
    })
  }

  // ---- reports -------------------------------------------------------------------------------
  const reports: Row[] = []
  const events: Row[] = []
  const ageMinutes = (): number => {
    const r = R.next()
    if (r < 0.12) return r < 0.05 ? int(1, 180) : int(180, 1440)
    if (r < 0.42) return int(1440, 5 * 1440)
    return int(5 * 1440, 21 * 1440)
  }
  const statusFor = (age: number) => {
    if (age < 180) return weighted([['pending', 55], ['investigating', 20], ['assigned', 20], ['resolved', 3], ['cancelled', 2]] as [string, number][])
    if (age < 1440) return weighted([['pending', 22], ['investigating', 18], ['assigned', 25], ['resolved', 30], ['cancelled', 5]] as [string, number][])
    if (age < 5 * 1440) return weighted([['pending', 4], ['investigating', 4], ['assigned', 6], ['resolved', 80], ['cancelled', 6]] as [string, number][])
    return weighted([['pending', 1], ['investigating', 1], ['assigned', 2], ['resolved', 87], ['cancelled', 9]] as [string, number][])
  }
  const sortedAges = Array.from({ length: sizes.reports }, ageMinutes).sort((a, b) => b - a) // oldest first -> stable numbering
  for (let i = 0; i < sizes.reports; i++) {
    const age = sortedAges[i]
    const sc = weighted(SCENARIOS.map((s) => [s, s.weight] as [Scenario, number]))
    const area = weighted(areaWeights)
    const loc = pick(LOCALITIES[area])
    const [lat, lng] = pointIn(area, 0.04)
    const noCoords = chance(0.012) // typed landmark only (offline-first reports can arrive without coordinates)
    const status = statusFor(age) as string
    const source = chance(0.72) ? 'gps' : 'manual'
    const dangers = [...sc.dangers]
    if (sc.extra && chance(0.45)) dangers.push(pick(sc.extra))
    const people = sc.noPeople || chance(0.07) ? null : int(sc.people[0], sc.people[1])
    const injury = weighted(sc.injury as [string, number][])
    const injuryCount = injury === 'none' || injury === 'unknown' ? null : Math.max(1, Math.min(people ?? 3, int(1, 3)))
    const medTypes = sc.medical && chance(sc.medical.p) ? [...new Set([pick(sc.medical.types), ...(chance(0.2) ? [pick(sc.medical.types)] : [])])] : []
    const vulns = chance(sc.vuln) ? [...new Set([pick(VULNS), ...(chance(0.3) ? [pick(VULNS)] : [])])] : []
    const created = iso(minutes(age))
    const verified = status === 'pending' ? chance(0.2) : status === 'cancelled' ? chance(0.1) : chance(0.78)
    const resolvedAgeMin = status === 'resolved' ? Math.max(0, age - int(35, 2400)) : null
    const base: Row = {
      id: uid(0, i + 1), reporter_id: null, client_id: `seed-large-${i + 1}`,
      location_lat: noCoords ? null : lat, location_lng: noCoords ? null : lng,
      location_address: `${loc}, ${area} (${pick(LANDMARKS)})`, location_source: source, location_accuracy_m: source === 'gps' ? int(5, 60) : null,
      area: noCoords ? null : nearestArea(lat, lng), people_count: people, dangers,
      danger_details: pick(sc.text), injury_severity: injury, injury_count: injuryCount,
      injury_details: injury === 'critical' ? pick(['Unconscious', 'Not responding', 'Heavy bleeding']) : injury === 'serious' ? pick(['Suspected fracture', 'Deep cut, bleeding', 'Chest pain']) : null,
      medical_need_types: medTypes, medical_needs: medTypes.length && sc.medical ? pick(sc.medical.text) : null,
      can_evacuate: weighted(sc.evac as [string, number][]), vulnerabilities: vulns,
      contact_info: chance(0.66) ? `Simulated - ${person()} · ${phone()}` : null,
      status, verified, triage_override: null, priority_explanation: null,
      resolved_at: resolvedAgeMin == null ? null : iso(minutes(resolvedAgeMin)), created_at: created, updated_at: resolvedAgeMin == null ? created : iso(minutes(resolvedAgeMin)),
    }
    base.immediate_danger = hasLifeThreat(base.dangers)
    base.priority_score = triageReport(base as never, { now: new Date(now) }).score
    reports.push(base)

    // audit history
    const at = (min: number) => new Date(Date.parse(created) + min * 60_000).toISOString()
    events.push({ report_id: base.id, action: 'created', actor: 'seed', from_value: null, to_value: null, note: 'Simulated report', created_at: created })
    if (verified) events.push({ report_id: base.id, action: 'verify', actor: 'Dispatcher (seed)', from_value: 'false', to_value: 'true', note: null, created_at: at(int(2, 20)) })
    const path = status === 'pending' ? [] : status === 'investigating' ? ['investigating'] : status === 'assigned' ? ['investigating', 'assigned'] : status === 'resolved' ? ['investigating', 'assigned', 'resolved'] : ['cancelled']
    let prev = 'pending'; let t = int(3, 25)
    for (const s of path) {
      const when = s === 'resolved' && base.resolved_at ? base.resolved_at : at(t)
      events.push({ report_id: base.id, action: 'status', actor: 'Dispatcher (seed)', from_value: prev, to_value: s, note: s === 'cancelled' ? pick(['Duplicate of an earlier report', 'Caller said they were rescued by neighbours', 'Could not be located']) : null, created_at: when })
      prev = s; t += int(8, 90)
    }
  }
  // Ownership: about a third of the reports belong to a citizen account (cloud seed only; demo mode keeps them anonymous).
  if (opts.withUsers) for (const r of reports) if (chance(0.33)) r.reporter_id = pick(citizenIds)

  // ---- missions ------------------------------------------------------------------------------
  const teamsByArea = new Map<string, Row[]>()
  for (const t of teams) { const k = t.area as string; if (!teamsByArea.has(k)) teamsByArea.set(k, []); teamsByArea.get(k)!.push(t) }
  const busy = new Set<string>()
  const dispatches: Row[] = []
  const dispatchResources: Row[] = []
  const resources: Row[] = []
  const addRes = (resource_type: string, name: string, quantity: number, team_id: string | null, status = 'available', notes: string | null = null) => {
    const row = { id: uid(4, resources.length + 1), resource_type, name, quantity, team_id, status, notes, created_at: iso(minutes(int(60 * 24 * 8, 60 * 24 * 35))), updated_at: iso(minutes(int(5, 900))) }
    resources.push(row); return row
  }
  const teamBoatsAndVehicles = new Map<string, Row[]>()
  for (const t of teams) {
    const mine: Row[] = []
    const caps = t.capabilities as string[]
    if (caps.includes('water_rescue')) { mine.push(addRes('boat', `${t.team_name} rescue boat`, 1, t.id)); addRes('first_aid', `${t.team_name} first aid kits`, int(1, 6), t.id) }
    if (caps.includes('medical')) { mine.push(addRes('vehicle', `${t.team_name} ambulance`, 1, t.id)); addRes('medical_supplies', `${t.team_name} trauma bags`, int(2, 12), t.id) }
    if (['search_rescue', 'fire', 'transport', 'logistics'].includes(t.team_type)) mine.push(addRes('vehicle', `${t.team_name} ${t.team_type === 'logistics' ? 'truck' : t.team_type === 'transport' ? 'transport' : 'utility truck'}`, 1, t.id))
    if (t.team_type === 'logistics') { addRes('food', `${t.team_name} ration packs`, int(40, 400), t.id); addRes('water', `${t.team_name} water crates`, int(20, 200), t.id) }
    teamBoatsAndVehicles.set(t.id, mine)
  }
  const nearestTeam = (lat: number, lng: number, area: string | null, avoidBusy: boolean) => {
    const pool = (area && teamsByArea.get(area)) || teams
    const scored = pool.filter((t) => t.status !== 'unavailable' && (!avoidBusy || !busy.has(t.id)))
      .map((t) => ({ t, d: distanceKm([lat, lng], [t.current_location_lat, t.current_location_lng]) })).sort((a, b) => a.d - b.d)
    if (!scored.length) return null
    const top = scored.slice(0, 5)
    return pick(top)
  }
  const stages = ['pending', 'en_route', 'on_scene'] as const
  let dispCount = 0
  const addDispatch = (r: Row, status: string, assignedMinAgo: number, completedIso: string | null, note: string | null) => {
    const hit = nearestTeam(r.location_lat, r.location_lng, r.area, status !== 'completed' && status !== 'cancelled')
    if (!hit) return
    const id = uid(6, ++dispCount)
    const dist = +hit.d.toFixed(1)
    dispatches.push({
      id, report_id: r.id, team_id: hit.t.id, assigned_by: null, assigned_at: iso(minutes(assignedMinAgo)), status, notes: note,
      match_score: Math.max(35, Math.min(98, Math.round(96 - dist * 4 + int(-6, 6)))), distance_km: dist,
      match_explanation: { breakdown: {}, warnings: dist > 8 ? ['Long distance: expect a slower arrival'] : [] },
      completed_at: completedIso, created_at: iso(minutes(assignedMinAgo)), updated_at: completedIso ?? iso(minutes(Math.max(1, assignedMinAgo - int(1, 30)))),
    })
    if (status === 'pending' || status === 'en_route' || status === 'on_scene') busy.add(hit.t.id)
    const gear = teamBoatsAndVehicles.get(hit.t.id) ?? []
    if (gear.length) {
      const used = gear.slice(0, int(1, Math.min(2, gear.length)))
      for (const g of used) {
        dispatchResources.push({ id: uid(7, dispatchResources.length + 1), dispatch_id: id, resource_id: g.id, quantity: 1 })
        if (status === 'pending' || status === 'en_route' || status === 'on_scene') g.status = 'in_use'
      }
    }
  }
  const NOTES = ['Access road is partly flooded, approach from the north side.', 'Family moved to the nearest shelter.', 'Patient handed to the ambulance at the main road.', 'Two trips needed because of the boat capacity.', null, null, null]
  for (const r of reports) {
    if (r.location_lat == null) continue
    const ageMin = (now - Date.parse(r.created_at)) / 60000
    if (chance(0.1) && (r.status === 'assigned' || r.status === 'resolved')) addDispatch(r, 'cancelled', ageMin - int(2, 12), null, pick(['Team diverted to a higher-priority case.', 'Boat needed elsewhere, reassigning.', 'Road became impassable, team turned back.']))
    if (r.status === 'assigned') addDispatch(r, pick([...stages]), Math.max(2, ageMin - int(3, 40)), null, pick(NOTES))
    else if (r.status === 'resolved' && chance(0.88)) addDispatch(r, 'completed', ageMin - int(5, 60), r.resolved_at, pick(NOTES))
  }
  for (const t of teams) {
    if (busy.has(t.id)) t.status = 'assigned'
    else if (chance(0.07)) t.status = 'unavailable'
  }
  // shared stock: three depots per area
  for (const area of areaNames) for (const depot of LOCALITIES[area].slice(0, 3)) {
    const where = `${depot}, ${area}`
    addRes('food', `Dry ration packs, ${where} store`, int(150, 1800), null, 'available')
    addRes('food', `Cooked meals, ${where} camps`, int(40, 500), null, chance(0.5) ? 'in_use' : 'available')
    addRes('water', `Bottled water crates, ${where}`, int(40, 600), null, chance(0.4) ? 'in_use' : 'available')
    addRes('water', `Water tanker, ${where}`, int(1, 4), null, chance(0.2) ? 'maintenance' : 'available', chance(0.2) ? 'Pump being repaired' : null)
    addRes('first_aid', `First aid kits, ${where} warehouse`, int(20, 160), null, 'available')
    addRes('medical_supplies', `IV fluids and dressings, ${where}`, int(10, 120), null, 'available')
    addRes('medical_supplies', `Insulin cooler packs, ${where}`, int(2, 14), null, chance(0.4) ? 'in_use' : 'available')
    addRes('boat', `Reserve inflatable boats, ${where}`, int(1, 5), null, chance(0.15) ? 'maintenance' : 'available', chance(0.15) ? 'Outboard motor being repaired' : null)
    addRes('vehicle', `Reserve pickup trucks, ${where}`, int(1, 6), null, 'available')
  }

  // ---- shelters ------------------------------------------------------------------------------
  const SHELTER_KINDS = ['Government Primary School', 'Girls High School', 'Boys High School', 'Community Hall', 'Relief Camp', 'Sports Complex', 'Madrasa Hall', 'Union Council Office', 'College Hostel', 'Marriage Hall', 'Church Hall', 'Youth Centre', 'Dispensary Annex']
  const shelters: Row[] = []
  for (let i = 0; i < sizes.shelters; i++) {
    const area = weighted(areaWeights); const loc = pick(LOCALITIES[area]); const [lat, lng] = pointIn(area, 0.04)
    const capacity = pick([60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 800, 1200])
    const status = weighted([['open', 62], ['full', 24], ['closed', 14]] as [string, number][])
    const occ = status === 'closed' ? 0 : status === 'full' ? capacity : Math.round(capacity * (0.05 + R.next() * 0.85))
    shelters.push({
      id: uid(3, i + 1), name: `${pick(SHELTER_KINDS)}, ${loc}`, address: `${loc}, ${area}`, area, location_lat: lat, location_lng: lng, capacity, current_occupancy: occ,
      contact_number: `+92 21 ${pad(int(3000000, 3999999), 7)}`, services: [...new Set(Array.from({ length: int(1, 5) }, () => pick(SERVICES)))], status, verified: chance(0.86), created_at: iso(minutes(int(60 * 24 * 6, 60 * 24 * 30))),
    })
  }

  // ---- route hazards and blocked roads --------------------------------------------------------
  const HAZARD_TEXT: [string, string, number, number][] = [
    ['underpass flooded', 'high', 0.5, 1.2], ['road submerged', 'high', 0.6, 1.5], ['fallen trees across the road', 'medium', 0.2, 0.5], ['debris on the bridge approach', 'medium', 0.2, 0.6],
    ['open manhole under flood water', 'high', 0.1, 0.3], ['live wire in the water', 'high', 0.15, 0.4], ['deep standing water, small vehicles stall', 'medium', 0.3, 0.9], ['landslip on the embankment', 'high', 0.2, 0.6],
    ['crowd at a relief point blocking the lane', 'low', 0.1, 0.3], ['road surface washed out', 'high', 0.2, 0.5], ['water 30 cm deep, passable with care', 'low', 0.3, 0.8], ['stalled bus blocking both lanes', 'low', 0.1, 0.3],
  ]
  const route_hazards: Row[] = []
  for (let i = 0; i < sizes.hazards; i++) {
    const area = weighted(areaWeights); const loc = pick(LOCALITIES[area]); const [lat, lng] = pointIn(area, 0.04); const h = pick(HAZARD_TEXT)
    route_hazards.push({ id: uid(5, i + 1), description: `${loc}: ${h[0]}`, location_lat: lat, location_lng: lng, radius_km: +(h[2] + R.next() * (h[3] - h[2])).toFixed(2), severity: h[1], active: chance(0.72), created_at: iso(minutes(int(30, 60 * 24 * 14))) })
  }
  const ROAD_TEXT: [string, string][] = [['road under water', 'flooding'], ['underpass flooded', 'flooding'], ['bridge approach flooded', 'flooding'], ['debris across the road', 'debris'], ['fallen trees on the service road', 'debris'], ['wall collapsed onto the road', 'collapse'], ['bridge cracked, closed to traffic', 'structural'], ['culvert washed out', 'structural'], ['road closed by the police for a rescue operation', 'other']]
  const blocked_roads: Row[] = []
  for (let i = 0; i < sizes.roads; i++) {
    const area = weighted(areaWeights); const loc = pick(LOCALITIES[area]); const [lat, lng] = pointIn(area, 0.04); const r = pick(ROAD_TEXT)
    const heading = R.next() * Math.PI * 2; const pts: [number, number][] = [[lat, lng]]
    for (let k = 0, n = int(2, 4); k < n; k++) { const prev = pts[pts.length - 1]; const step = 0.0015 + R.next() * 0.0025; const h = heading + (R.next() - 0.5) * 0.7; pts.push([+(prev[0] + Math.sin(h) * step).toFixed(5), +(prev[1] + Math.cos(h) * step).toFixed(5)]) }
    blocked_roads.push({ id: uid(1, i + 1), description: `${loc}: ${r[0]}`, reason: r[1], area, path: pts, verified: chance(0.76), created_at: iso(minutes(int(30, 60 * 24 * 14))), updated_at: iso(minutes(int(5, 600))) })
  }

  return { accounts, reports, report_events: events, rescue_teams: teams, resources, shelters, route_hazards, blocked_roads, dispatches, dispatch_resources: dispatchResources }
}

let cache: { key: number; data: LargeDataset } | null = null
/** The dataset used by demo mode (cached for the life of the server process). */
export function largeDemoDataset(): LargeDataset {
  if (!cache) cache = { key: 0, data: buildLargeDataset(Date.now()) }
  return cache.data
}
export const useLargeDemoDataset = () => process.env.VYRA_DEMO_DATASET === 'large'
