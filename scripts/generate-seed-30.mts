// Generates vyra_seed_30.sql: exactly 30 rows for every seeded table.
// Reuses the project's own demo data (demoSeed.ts / demoOpsSeed.ts) and extends it where it has fewer than 30.
// Generates supabase/seed/vyra_full_seed.sql (exactly 30 rows for every seeded table) and the one-file
// supabase/vyra_complete_setup.sql (schema + migration + seed, paste-and-run in the SQL Editor).
// Reuses the project's own demo data (demoSeed.ts / demoOpsSeed.ts) and extends it where it has fewer than 30.
// Usage: npm run db:seed:generate
import { readFileSync, writeFileSync } from 'node:fs'
// (dynamic imports: the demo data files are TypeScript modules without a "type": "module" package)
const { demoReports } = await import('../src/lib/db/demoSeed.ts')
const { TEAM_DEFS, SHELTER_DEFS } = await import('../src/lib/db/demoOpsSeed.ts')
const { triageReport } = await import('../src/lib/triage.ts')
const { distanceKm } = await import('../src/lib/constants.ts')

const SEED_OUT = new URL('../supabase/seed/vyra_full_seed.sql', import.meta.url)
const SETUP_OUT = new URL('../supabase/vyra_complete_setup.sql', import.meta.url)

type Row = Record<string, any>
const N = 30
const now = Date.now()

const lit = (v: unknown): string => {
  if (v == null) return 'NULL'
  if (Array.isArray(v) && v.length === 0) return "'{}'"
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return `ARRAY[${v.map(lit).join(', ')}]::TEXT[]`
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::JSONB`
  return `'${String(v).replace(/'/g, "''")}'`
}
const minsAgo = (iso: string | null) => (iso == null ? null : Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)))
const agoM = (m: number | null) => (m == null ? 'NULL' : `NOW() - INTERVAL '${Math.max(0, Math.round(m))} minutes'`)
const ago = (iso: string | null) => agoM(minsAgo(iso))
const values = (rows: string[]) => rows.map((r) => `  ${r}`).join(',\n')
const uid = (kind: number, n: number) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const assertN = (what: string, n: number) => { if (n !== N) throw new Error(`${what}: expected ${N}, got ${n}`) }

// ---------------------------------------------------------------------------------------------
// 1. Accounts: the 6 originals + 24 more = 30 (1 admin, 9 responders, 20 citizens)
// ---------------------------------------------------------------------------------------------
const accounts: [string, string, string][] = [
  ['admin@demo.vyra', 'Amina Farooqui', 'admin'],
  ['dispatcher@demo.vyra', 'Hamza Siddiqui', 'responder'],
  ['fieldlead@demo.vyra', 'Sana Qureshi', 'responder'],
  ['logistics@demo.vyra', 'Waleed Khokhar', 'responder'],
  ['citizen@demo.vyra', 'Bilal Ahmed', 'citizen'],
  ['neighbour@demo.vyra', 'Nida Hussain', 'citizen'],
  ['responder4@demo.vyra', 'Talha Mansoor', 'responder'],
  ['responder5@demo.vyra', 'Rabia Anjum', 'responder'],
  ['responder6@demo.vyra', 'Salman Butt', 'responder'],
  ['responder7@demo.vyra', 'Mehwish Kamal', 'responder'],
  ['responder8@demo.vyra', 'Arsalan Memon', 'responder'],
  ['responder9@demo.vyra', 'Hira Javed', 'responder'],
  ['citizen3@demo.vyra', 'Usman Ghani', 'citizen'],
  ['citizen4@demo.vyra', 'Farah Naeem', 'citizen'],
  ['citizen5@demo.vyra', 'Zain Abbasi', 'citizen'],
  ['citizen6@demo.vyra', 'Maryam Siddiqui', 'citizen'],
  ['citizen7@demo.vyra', 'Hassan Raza', 'citizen'],
  ['citizen8@demo.vyra', 'Ayesha Tariq', 'citizen'],
  ['citizen9@demo.vyra', 'Daniyal Shaikh', 'citizen'],
  ['citizen10@demo.vyra', 'Sidra Bashir', 'citizen'],
  ['citizen11@demo.vyra', 'Owais Pirzada', 'citizen'],
  ['citizen12@demo.vyra', 'Komal Rajput', 'citizen'],
  ['citizen13@demo.vyra', 'Adnan Lodhi', 'citizen'],
  ['citizen14@demo.vyra', 'Iqra Fatima', 'citizen'],
  ['citizen15@demo.vyra', 'Fahad Mughal', 'citizen'],
  ['citizen16@demo.vyra', 'Noor Jahan', 'citizen'],
  ['citizen17@demo.vyra', 'Shahzaib Khan', 'citizen'],
  ['citizen18@demo.vyra', 'Laiba Zubair', 'citizen'],
  ['citizen19@demo.vyra', 'Murtaza Ali', 'citizen'],
  ['citizen20@demo.vyra', 'Anam Sheikh', 'citizen'],
]
assertN('accounts', accounts.length)
const accountRows = accounts.map(([email, name, role], i) => `(${lit(uid(9, i + 1))}::UUID, ${lit(email)}, ${lit(name)}, ${lit(role)})`)

// ---------------------------------------------------------------------------------------------
// 2. Emergency cases: 30 picked from the 80 demo cases (story cases first), balanced by status
// ---------------------------------------------------------------------------------------------
const all: Row[] = demoReports(now)
const quota: Record<string, number> = { pending: 6, investigating: 4, assigned: 8, resolved: 10, cancelled: 2 }
const picked: Row[] = []
for (const [status, q] of Object.entries(quota)) picked.push(...all.filter((r) => r.status === status).slice(0, q))
picked.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) // oldest first -> stable numbering
assertN('reports', picked.length)
// Newest first like the original (story cases were listed newest-first); renumber 1..30.
picked.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
const reports: Row[] = picked.map((r, i) => ({ ...r, id: uid(0, i + 1).replace(/^00000000/, '00000000'), client_id: `demo-seed-${i + 1}` }))
// uid(0,..) gives "00000000-0000-4000-8000-..." - same prefix the original seed used.

const reportCols = ['id', 'client_id', 'location_lat', 'location_lng', 'location_address', 'location_source', 'location_accuracy_m', 'area', 'people_count', 'immediate_danger', 'dangers', 'danger_details', 'injury_severity', 'injury_count', 'injury_details', 'medical_need_types', 'medical_needs', 'can_evacuate', 'vulnerabilities', 'contact_info', 'status', 'verified', 'priority_score']
const reportRows = reports.map((r) => {
  const t = triageReport(r, { now: new Date(now) })
  const vals = reportCols.map((c) => (c === 'priority_score' ? String(t.score) : lit(r[c])))
  return `(${vals.join(', ')}, ${ago(r.resolved_at)}, ${ago(r.created_at)}, ${ago(r.created_at)})`
})
const eventRows: string[] = []
for (const r of reports) {
  const at = (min: number) => `${ago(r.created_at)} + INTERVAL '${min} minutes'`
  eventRows.push(`(${lit(r.id)}, 'created', 'seed', NULL, NULL, 'Simulated demo report', ${ago(r.created_at)})`)
  if (r.verified) eventRows.push(`(${lit(r.id)}, 'verify', 'Dispatcher (demo)', 'false', 'true', NULL, ${at(4)})`)
  if (r.status !== 'pending') {
    const when = r.resolved_at && r.status === 'resolved' ? ago(r.resolved_at) : at(8)
    eventRows.push(`(${lit(r.id)}, 'status', 'Dispatcher (demo)', 'pending', ${lit(r.status)}, NULL, ${when})`)
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Rescue teams: 16 originals + 14 new = 30
// ---------------------------------------------------------------------------------------------
interface Team { id: string; team_name: string; team_leader: string; contact_number: string; base_location: string; team_size: number; capabilities: string[]; lat: number; lng: number; team_type: string; area: string; status: string; active: boolean }
const teams: Team[] = TEAM_DEFS.map((t: any) => ({ ...t, status: t.map_status }))
const extraTeams: Omit<Team, 'id' | 'status' | 'active'>[] = []
extraTeams.push(
  { team_name: 'Boat Team Echo', team_leader: 'Yasir Mallah', contact_number: '+92 300 1000017', base_location: 'Clifton Seaview jetty', team_size: 5, capabilities: ['water_rescue', 'evacuation'], team_type: 'boat', area: 'Clifton', lat: 24.8235, lng: 67.0265 },
  { team_name: 'Boat Team Foxtrot', team_leader: 'Zahid Mirani', contact_number: '+92 300 1000018', base_location: 'Landhi canal boat post', team_size: 4, capabilities: ['water_rescue'], team_type: 'boat', area: 'Landhi', lat: 24.8475, lng: 67.1995 },
  { team_name: 'Boat Team Golf', team_leader: 'Nadeem Baloch', contact_number: '+92 300 1000019', base_location: 'Baba Island jetty', team_size: 5, capabilities: ['water_rescue', 'evacuation'], team_type: 'boat', area: 'Keamari', lat: 24.8335, lng: 66.9835 },
  { team_name: 'Medical Unit 2', team_leader: 'Dr. Sadia Rauf', contact_number: '+92 300 1000020', base_location: 'Lyari dispensary', team_size: 4, capabilities: ['medical'], team_type: 'medical', area: 'Lyari', lat: 24.872, lng: 66.992 },
  { team_name: 'Medical Unit 6', team_leader: 'Dr. Bilal Chishti', contact_number: '+92 300 1000021', base_location: 'Korangi health post', team_size: 4, capabilities: ['medical', 'evacuation'], team_type: 'medical', area: 'Korangi', lat: 24.829, lng: 67.131 },
  { team_name: 'Medical Unit 9', team_leader: 'Dr. Aneela Shah', contact_number: '+92 300 1000022', base_location: 'Orangi maternity home', team_size: 3, capabilities: ['medical'], team_type: 'medical', area: 'Orangi', lat: 24.944, lng: 66.998 },
  { team_name: 'Medical Unit 11', team_leader: 'Dr. Furqan Ali', contact_number: '+92 300 1000023', base_location: 'North Nazimabad clinic', team_size: 4, capabilities: ['medical'], team_type: 'medical', area: 'North Nazimabad', lat: 24.946, lng: 67.046 },
  { team_name: 'Search & Rescue Golf', team_leader: 'Haroon Rasheed', contact_number: '+92 300 1000024', base_location: 'Malir civil defence post', team_size: 7, capabilities: ['search_rescue', 'evacuation'], team_type: 'search_rescue', area: 'Malir', lat: 24.894, lng: 67.198 },
  { team_name: 'Search & Rescue Hotel', team_leader: 'Ghazala Parveen', contact_number: '+92 300 1000025', base_location: 'Gulshan fire station', team_size: 6, capabilities: ['search_rescue', 'fire'], team_type: 'search_rescue', area: 'Gulshan-e-Iqbal', lat: 24.921, lng: 67.094 },
  { team_name: 'Fire Response Lima', team_leader: 'Sohail Akhtar', contact_number: '+92 300 1000026', base_location: 'Landhi fire station', team_size: 6, capabilities: ['fire'], team_type: 'fire', area: 'Landhi', lat: 24.851, lng: 67.201 },
  { team_name: 'Fire Response Mike', team_leader: 'Ejaz Hussain', contact_number: '+92 300 1000027', base_location: 'Lyari fire post', team_size: 5, capabilities: ['fire', 'search_rescue'], team_type: 'fire', area: 'Lyari', lat: 24.868, lng: 66.999 },
  { team_name: 'Evacuation Bus Crew 5', team_leader: 'Anwar Gill', contact_number: '+92 300 1000028', base_location: 'Gulshan bus terminal', team_size: 3, capabilities: ['evacuation'], team_type: 'transport', area: 'Gulshan-e-Iqbal', lat: 24.917, lng: 67.087 },
  { team_name: 'Evacuation Truck Crew 6', team_leader: 'Rashid Dar', contact_number: '+92 300 1000029', base_location: 'Keamari truck stand', team_size: 4, capabilities: ['evacuation', 'logistics'], team_type: 'transport', area: 'Keamari', lat: 24.825, lng: 66.981 },
  { team_name: 'Logistics Truck 12', team_leader: 'Mubashir Iqbal', contact_number: '+92 300 1000030', base_location: 'Orangi relief store', team_size: 3, capabilities: ['logistics'], team_type: 'logistics', area: 'Orangi', lat: 24.95, lng: 66.99 },
)
// Statuses for the new teams: mostly available, two off duty. (Only teams on a live mission are 'assigned'.)
const extraStatus = ['available', 'available', 'available', 'available', 'available', 'unavailable', 'available', 'available', 'available', 'available', 'available', 'available', 'unavailable', 'available']
extraTeams.forEach((t, i) => teams.push({ ...t, id: uid(2, teams.length + 1), status: extraStatus[i], active: false }))
assertN('teams', teams.length)
const teamRows = teams.map((t, i) => `(${[t.id, t.team_name, t.team_leader, t.contact_number, t.base_location, t.team_size, t.capabilities, t.lat, t.lng, t.team_type, t.area, t.status].map(lit).join(', ')}, TRUE, ${agoM(5000 - i * 40)})`)

// ---------------------------------------------------------------------------------------------
// 4. Resources: 20 team-linked (boats, ambulances, trucks) + 10 shared stock = 30
// ---------------------------------------------------------------------------------------------
const byName = (n: string) => teams.find((t) => t.team_name === n)!
const resources: Row[] = []
const addRes = (resource_type: string, name: string, quantity: number, team_id: string | null, status = 'available', notes: string | null = null) =>
  resources.push({ id: uid(4, resources.length + 1), resource_type, name, quantity, team_id, status, notes, created: 4800 - resources.length * 25 })
const st = (t: Team) => (t.status === 'assigned' ? 'in_use' : 'available')
for (const t of teams.filter((t) => t.capabilities.includes('water_rescue'))) addRes('boat', `${t.team_name} rescue boat`, 1, t.id, st(t))
for (const t of teams.filter((t) => t.team_type === 'medical' && t.capabilities.includes('medical'))) addRes('vehicle', `${t.team_name} ambulance`, 1, t.id, st(t))
for (const n of ['Search & Rescue Bravo', 'Search & Rescue Echo', 'Search & Rescue Foxtrot', 'Fire Response Kilo']) addRes('vehicle', `${n} utility truck`, 1, byName(n).id, st(byName(n)))
for (const n of ['Evacuation Bus Crew 2', 'Evacuation Truck Crew 4']) addRes('vehicle', `${n} transport`, 1, byName(n).id, st(byName(n)))
addRes('boat', 'Spare inflatable boat', 2)
addRes('boat', 'Reserve boat (engine fault)', 1, null, 'maintenance', 'Outboard motor being repaired')
addRes('vehicle', 'Reserve pickup truck', 2)
addRes('first_aid', 'First aid kits, warehouse A', 24)
addRes('medical_supplies', 'IV fluids and dressings', 18)
addRes('medical_supplies', 'Insulin cooler packs', 3, null, 'in_use')
addRes('food', 'Dry ration packs, Malir store', 120)
addRes('food', 'Dry ration packs, Gulshan store', 2, null, 'available', 'Almost gone, restock needed')
addRes('water', 'Bottled water crates, Lyari', 6, null, 'in_use')
addRes('water', 'Water tanker (leaking)', 1, null, 'maintenance')
assertN('resources', resources.length)
const resourceRows = resources.map((x) => `(${[x.id, x.resource_type, x.name, x.quantity, x.team_id, x.status, x.notes].map(lit).join(', ')}, ${agoM(x.created)})`)

// ---------------------------------------------------------------------------------------------
// 5. Missions (30): 8 live + 16 completed + 6 cancelled, and 30 supply allocations
// ---------------------------------------------------------------------------------------------
const dispatches: Row[] = []
const dr: Row[] = []
let dn = 0, rn = 0
const reportAgeMin = (r: Row) => minsAgo(r.created_at)!
const dist = (t: Team, r: Row) => distanceKm([t.lat, t.lng], [r.location_lat, r.location_lng])
const nearest = (r: Row, pool: Team[]) => [...pool].sort((a, b) => dist(a, r) - dist(b, r))

// Live: nearest-pair the 8 teams that start on a mission with the 8 'assigned' cases.
const liveTeamNames = ['Boat Team Alpha', 'Boat Team Bravo', 'Boat Team Charlie', 'Medical Unit 3', 'Medical Unit 5', 'Search & Rescue Echo', 'Search & Rescue Foxtrot', 'Evacuation Truck Crew 4']
const liveTeams = liveTeamNames.map(byName)
liveTeams.forEach((t) => { t.active = true })
for (const t of teams) t.status = t.active ? 'assigned' : t.status === 'assigned' ? 'available' : t.status
const assigned = reports.filter((r) => r.status === 'assigned')
const pairs = liveTeams.flatMap((t) => assigned.map((r) => ({ t, r, d: dist(t, r) }))).sort((x, y) => x.d - y.d)
const usedT = new Set<string>(), usedR = new Set<string>()
const chosen: typeof pairs = []
for (const p of pairs) { if (usedT.has(p.t.id) || usedR.has(p.r.id)) continue; usedT.add(p.t.id); usedR.add(p.r.id); chosen.push(p) }
if (chosen.length !== 8) throw new Error('live pairing: ' + chosen.length)
const stages = ['pending', 'en_route', 'on_scene', 'en_route', 'on_scene', 'pending', 'en_route', 'on_scene']
const liveIds: Record<string, string> = {}
chosen.forEach(({ t, r, d }, i) => {
  const when = Math.max(3, Math.min(reportAgeMin(r) - 2, 8 + i * 5))
  const id = uid(6, ++dn)
  liveIds[t.id] = id
  dispatches.push({ id, report_id: r.id, team_id: t.id, assigned_at: when, status: stages[i], notes: i % 3 === 0 ? 'Access road is partly flooded, approach from the north side.' : null, match_score: 62 + ((i * 11) % 34), distance_km: +d.toFixed(1), warnings: d > 8 ? ['Long distance: expect a slower arrival'] : [], completed_at: null, updated: Math.max(1, when - 2) })
  for (const res of resources.filter((x) => x.team_id === t.id && x.status === 'in_use')) dr.push({ id: uid(7, ++rn), dispatch_id: id, resource_id: res.id, quantity: res.quantity })
})
// The two shared in-use stocks ride along with live missions.
const resByName = (n: string) => resources.find((x) => x.name === n)!
dr.push({ id: uid(7, ++rn), dispatch_id: dispatches[0].id, resource_id: resByName('Bottled water crates, Lyari').id, quantity: 6 })
dr.push({ id: uid(7, ++rn), dispatch_id: dispatches[1].id, resource_id: resByName('Insulin cooler packs').id, quantity: 3 })

// Completed: every resolved case gets a mission; 6 of the 10 needed a second team, so they get an earlier completed one too.
const resolved = reports.filter((r) => r.status === 'resolved')
const doneIds: string[] = []
resolved.forEach((r, i) => {
  const C = reportAgeMin(r), R = minsAgo(r.resolved_at)!
  const sB = Math.max(R + 5, Math.min(R + 25 + (i % 7) * 6, C - 14))
  const t1 = nearest(r, teams)[i % 3]
  const id1 = uid(6, ++dn)
  doneIds.push(id1)
  if (i < 6) {
    const t0 = nearest(r, teams.filter((t) => t.id !== t1.id))[(i + 1) % 4]
    const cA = sB + 2, sA = Math.min(C - 1, sB + 26)
    if (sA - cA < 5) throw new Error('window too small for report ' + r.id)
    const id0 = uid(6, ++dn)
    doneIds.push(id0)
    dispatches.push({ id: id0, report_id: r.id, team_id: t0.id, assigned_at: sA, status: 'completed', notes: 'First team handed over, second team finished the evacuation.', match_score: 60 + ((i * 9) % 30), distance_km: +dist(t0, r).toFixed(1), warnings: [], completed_at: cA, updated: cA })
  }
  dispatches.push({ id: id1, report_id: r.id, team_id: t1.id, assigned_at: sB, status: 'completed', notes: i % 4 === 0 ? 'Family moved to the nearest shelter.' : null, match_score: 58 + ((i * 7) % 38), distance_km: +dist(t1, r).toFixed(1), warnings: [], completed_at: R, updated: R })
})
// Cancelled: both cancelled cases (false alarm / duplicate) + 4 open cases where the first team was stood down and redirected.
const cancelledReports = reports.filter((r) => r.status === 'cancelled')
const redirected = [...reports.filter((r) => r.status === 'investigating').slice(0, 2), ...reports.filter((r) => r.status === 'pending').slice(0, 2)]
const cancelNotes = ['Duplicate of another report, team stood down.', 'False alarm confirmed by phone, team stood down.', 'Team diverted to a higher-priority case.', 'Road blocked on approach, team recalled.', 'Team diverted to a higher-priority case.', 'Boat needed elsewhere, reassigning.']
;[...cancelledReports, ...redirected].forEach((r, i) => {
  const t = nearest(r, teams.filter((x) => !x.active))[0]
  const when = Math.max(3, Math.min(reportAgeMin(r) - 2, 20 + i * 4))
  dispatches.push({ id: uid(6, ++dn), report_id: r.id, team_id: t.id, assigned_at: when, status: 'cancelled', notes: cancelNotes[i], match_score: 55 + ((i * 8) % 30), distance_km: +dist(t, r).toFixed(1), warnings: [], completed_at: null, updated: Math.max(1, when - 3) })
})
assertN('dispatches', dispatches.length)

// Allocations: completed missions hold the vehicle/boat their team used (history); top up with first-aid kits to reach 30.
const kit = resByName('First aid kits, warehouse A')
for (const d of dispatches.filter((x) => x.status === 'completed')) {
  const own = resources.find((x) => x.team_id === d.team_id && ['boat', 'vehicle'].includes(x.resource_type))
  if (own && dr.length < N) dr.push({ id: uid(7, ++rn), dispatch_id: d.id, resource_id: own.id, quantity: own.quantity })
}
for (const d of dispatches.filter((x) => x.status === 'completed')) {
  if (dr.length >= N) break
  dr.push({ id: uid(7, ++rn), dispatch_id: d.id, resource_id: kit.id, quantity: 2 })
}
assertN('dispatch_resources', dr.length)
dispatches.sort((a, b) => a.assigned_at - b.assigned_at) // newest first
const dispatchRows = dispatches.map((d) => `(${[d.id, d.report_id, d.team_id].map(lit).join(', ')}, NULL, ${agoM(d.assigned_at)}, ${lit(d.status)}, ${lit(d.notes)}, ${d.match_score}, ${d.distance_km}, ${lit({ breakdown: {}, warnings: d.warnings })}, ${agoM(d.completed_at)}, ${agoM(d.assigned_at)}, ${agoM(d.updated)})`)
const drRows = dr.map((x) => `(${[x.id, x.dispatch_id, x.resource_id].map(lit).join(', ')}, ${x.quantity})`)

// ---------------------------------------------------------------------------------------------
// 6. Shelters: 11 originals + 19 new = 30
// ---------------------------------------------------------------------------------------------
type Sh = { name: string; address: string; area: string; lat: number; lng: number; capacity: number | null; occ: number; phone: string; services: string[]; status: 'open' | 'full' | 'closed'; verified: boolean }
const shelters: Sh[] = SHELTER_DEFS.map((s: any) => ({ name: s.name, address: s.address, area: s.area, lat: s.location_lat, lng: s.location_lng, capacity: s.capacity, occ: s.current_occupancy, phone: s.contact_number, services: s.services, status: s.status, verified: s.verified }))
const S = (name: string, address: string, area: string, lat: number, lng: number, capacity: number, occ: number, services: string[], status: Sh['status'], verified = true): Sh =>
  ({ name, address, area, lat, lng, capacity, occ: status === 'full' ? capacity : status === 'closed' ? 0 : occ, phone: '', services, status, verified })
shelters.push(
  S('Lyari Girls Secondary School', 'Baghdadi main road, Lyari', 'Lyari', 24.869, 66.989, 260, 140, ['food', 'water'], 'open'),
  S('Kalri Jamat Khana Hall', 'Kalri, Lyari', 'Lyari', 24.877, 66.981, 160, 160, ['food', 'water', 'medical'], 'full'),
  S('Korangi Industrial Area Hall', 'Sector 23, Korangi', 'Korangi', 24.837, 67.135, 350, 120, ['water', 'power'], 'open'),
  S('Qayyumabad Community School', 'Qayyumabad, Korangi', 'Korangi', 24.831, 67.116, 200, 75, ['food', 'water'], 'open'),
  S('Fish Harbour Workers Hall', 'Fish harbour road, Keamari', 'Keamari', 24.831, 66.972, 180, 90, ['food', 'water'], 'open'),
  S('Sultanabad Boys School', 'Sultanabad, Keamari', 'Keamari', 24.837, 66.986, 220, 0, ['water'], 'closed'),
  S('Safoora Goth Government School', 'Safoora chowrangi, Gulshan-e-Iqbal', 'Gulshan-e-Iqbal', 24.932, 67.082, 300, 110, ['food', 'water', 'medical', 'power'], 'open'),
  S('Gulshan Block 13 Mosque Hall', 'Block 13, Gulshan-e-Iqbal', 'Gulshan-e-Iqbal', 24.921, 67.098, 140, 140, ['water'], 'full'),
  S('Orangi Sector 5 Madrasa Hall', 'Sector 5, Orangi', 'Orangi', 24.944, 66.981, 200, 95, ['food', 'water'], 'open'),
  S('Qasba Colony Girls School', 'Qasba colony, Orangi', 'Orangi', 24.964, 66.977, 240, 60, ['food', 'water', 'medical'], 'open'),
  S('Saddar Municipal Library Hall', 'Zainab Market side, Saddar', 'Saddar', 24.857, 67.025, 130, 45, ['water', 'power'], 'open'),
  S('Frere Town Parish Hall', 'Frere Town, Saddar', 'Saddar', 24.868, 67.013, 110, 110, ['food', 'water'], 'full'),
  S('Malir Halt Railway Institute', 'Malir Halt', 'Malir', 24.881, 67.205, 280, 130, ['food', 'water', 'power'], 'open'),
  S('Saudabad Government College', 'Saudabad, Malir', 'Malir', 24.881, 67.19, 320, 210, ['food', 'water', 'medical'], 'open'),
  S('Sherpao Colony Primary School', 'Sherpao colony, Landhi', 'Landhi', 24.849, 67.191, 150, 20, ['water'], 'open'),
  S('Muslimabad Community Centre', 'Muslimabad, Landhi', 'Landhi', 24.841, 67.213, 180, 70, ['food', 'water'], 'open', false),
  S('Defence Phase 2 Club House', 'Phase 2, Clifton', 'Clifton', 24.816, 67.042, 160, 30, ['food', 'water', 'power'], 'open'),
  S('Block A Graveyard Road School', 'Block A, North Nazimabad', 'North Nazimabad', 24.929, 67.039, 210, 95, ['food', 'water'], 'open'),
  S('Block N Community Hall', 'Block N, North Nazimabad', 'North Nazimabad', 24.952, 67.045, 170, 0, ['water'], 'closed', false),
)
assertN('shelters', shelters.length)
const shelterRows = shelters.map((s, i) => `(${[uid(3, i + 1), s.name, s.address, s.area, s.lat, s.lng, s.capacity, s.occ, s.phone || null, s.services, s.status, s.verified].map(lit).join(', ')}, ${agoM(3000 - i * 60 + (i > 10 ? 1600 : 0))})`)

// ---------------------------------------------------------------------------------------------
// 7. Route hazards (30) and blocked roads (30): 9 originals each + 21 shared new incidents
// ---------------------------------------------------------------------------------------------
type Hz = { desc: string; lat: number; lng: number; radius: number; sev: 'low' | 'medium' | 'high'; active: boolean; reason: string; area: string; verified: boolean; dlat: number; dlng: number }
const origHaz: [string, number, number, number, string, boolean?][] = [
  ['Lyari Expressway underpass flooded', 24.866, 66.995, 0.8, 'high'],
  ['Korangi Road submerged near Qayyumabad', 24.834, 67.1, 1.2, 'high'],
  ['Debris on Malir River bridge approach', 24.887, 67.184, 0.5, 'medium'],
  ['Landhi 89 stop road under 1 m of water', 24.847, 67.196, 1, 'high'],
  ['Orangi nullah bridge closed, cracked structure', 24.948, 66.988, 0.6, 'high'],
  ['Fallen trees on Sharae Faisal service lane', 24.86, 67.033, 0.4, 'low'],
  ['Keamari Port Road waterlogged', 24.823, 66.975, 0.9, 'medium'],
  ['Gulshan Block 7 underpass flooded', 24.92, 67.088, 0.7, 'high'],
  ['Slow traffic and mud on University Road (cleared)', 24.932, 67.105, 0.5, 'low', false],
]
const origRoads: [string, string, string, number[][], boolean][] = [
  ['Lyari Expressway underpass flooded', 'flooding', 'Lyari', [[24.862, 66.988], [24.866, 66.995], [24.87, 67.001]], true],
  ['Korangi Road submerged near Qayyumabad', 'flooding', 'Korangi', [[24.836, 67.088], [24.834, 67.1], [24.832, 67.11]], true],
  ['Debris on Malir River bridge approach', 'debris', 'Malir', [[24.885, 67.18], [24.888, 67.186]], true],
  ['Landhi 89 stop road under 1 m of water', 'flooding', 'Landhi', [[24.846, 67.19], [24.848, 67.202]], true],
  ['Orangi nullah bridge closed, structure cracked', 'structural', 'Orangi', [[24.947, 66.985], [24.949, 66.992]], true],
  ['Fallen trees on Sharae Faisal service lane', 'debris', 'Saddar', [[24.858, 67.03], [24.862, 67.036]], true],
  ['Keamari Port Road waterlogged', 'flooding', 'Keamari', [[24.82, 66.97], [24.826, 66.98]], true],
  ['Gulshan Block 7 underpass flooded', 'flooding', 'Gulshan-e-Iqbal', [[24.918, 67.085], [24.922, 67.092]], true],
  ['Possible block on University Road', 'other', 'Gulshan-e-Iqbal', [[24.93, 67.1], [24.935, 67.11]], false],
]
// [description, area, reason, severity, lat, lng, radius km, active, verified]
const extra: [string, string, string, 'low' | 'medium' | 'high', number, number, number, boolean, boolean][] = [
  ['Baghdadi main road knee-deep in water', 'Lyari', 'flooding', 'medium', 24.871, 66.988, 0.6, true, true],
  ['Chakiwara bridge approach blocked by a stalled truck', 'Lyari', 'other', 'medium', 24.8705, 66.9915, 0.4, true, true],
  ['Kalri nullah overflowing onto the road', 'Lyari', 'flooding', 'high', 24.8775, 66.982, 0.9, true, true],
  ['Sector 31 main road under 60 cm of water', 'Korangi', 'flooding', 'high', 24.8185, 67.1235, 1.0, true, true],
  ['Korangi Crossing flyover ramp cracked', 'Korangi', 'structural', 'high', 24.8247, 67.1426, 0.5, true, true],
  ['Sector 5 school road blocked by fallen wall', 'Korangi', 'collapse', 'medium', 24.8335, 67.1352, 0.4, true, true],
  ['Fish harbour approach road flooded', 'Keamari', 'flooding', 'high', 24.8291, 66.9768, 0.8, true, true],
  ['Sultanabad main road blocked by fallen wires', 'Keamari', 'debris', 'medium', 24.8373, 66.9863, 0.4, true, true],
  ['Safoora chowrangi underpass flooded', 'Gulshan-e-Iqbal', 'flooding', 'high', 24.9322, 67.0818, 0.8, true, true],
  ['Block 13 road partly collapsed by sinkhole', 'Gulshan-e-Iqbal', 'collapse', 'high', 24.9215, 67.0981, 0.3, true, true],
  ['Sector 11 nullah road waterlogged', 'Orangi', 'flooding', 'medium', 24.9393, 67.0048, 0.7, true, true],
  ['Qasba colony lane 7 blocked by debris', 'Orangi', 'debris', 'low', 24.9642, 66.9768, 0.3, true, true],
  ['Burns Road low section flooded', 'Saddar', 'flooding', 'medium', 24.8539, 67.0364, 0.5, true, true],
  ['Empress Market back lane blocked by stalled cars', 'Saddar', 'other', 'low', 24.8692, 67.0341, 0.3, true, false],
  ['Saudabad bridge approach under water', 'Malir', 'flooding', 'high', 24.8839, 67.1902, 0.9, true, true],
  ['Malir Halt railway crossing closed, track washed out', 'Malir', 'structural', 'high', 24.9045, 67.2167, 0.6, true, true],
  ['Sherpao colony lane 2 flooded and impassable', 'Landhi', 'flooding', 'high', 24.8486, 67.1908, 0.7, true, true],
  ['Defence phase 2 service road blocked by fallen tree', 'Clifton', 'debris', 'low', 24.8158, 67.0419, 0.3, false, true],
  ['Seaview beach road covered by sand and water', 'Clifton', 'flooding', 'medium', 24.8231, 67.027, 0.8, true, true],
  ['Block A road flooded near the graveyard wall', 'North Nazimabad', 'flooding', 'medium', 24.9288, 67.0392, 0.6, true, true],
  ['Block H underpass flooded, vehicles stuck', 'North Nazimabad', 'flooding', 'high', 24.9433, 67.0418, 0.7, false, false],
]
if (extra.length !== 21) throw new Error('extra incidents: ' + extra.length)
const hazards: Hz[] = [
  ...origHaz.map((h, i) => ({ desc: h[0], lat: h[1], lng: h[2], radius: h[3], sev: h[4] as Hz['sev'], active: h[5] ?? true, reason: '', area: '', verified: true, dlat: 0, dlng: 0, _i: i })),
  ...extra.map((e) => ({ desc: e[0], lat: e[4], lng: e[5], radius: e[6], sev: e[3], active: e[7], reason: e[2], area: e[1], verified: e[8], dlat: 0, dlng: 0 })),
]
assertN('hazards', hazards.length)
const hazardRows = hazards.map((h, i) => `(${[uid(5, i + 1), h.desc, h.lat, h.lng, h.radius, h.sev, h.active].map(lit).join(', ')}, ${agoM(1500 - i * 40)})`)
const roads = [
  ...origRoads.map((r) => ({ desc: r[0], reason: r[1], area: r[2], path: r[3], verified: r[4] })),
  ...extra.map((e) => ({ desc: e[0], reason: e[2], area: e[1], verified: e[8], path: [[+(e[4] - 0.003).toFixed(4), +(e[5] - 0.004).toFixed(4)], [e[4], e[5]], [+(e[4] + 0.003).toFixed(4), +(e[5] + 0.004).toFixed(4)]] })),
]
assertN('blocked_roads', roads.length)
const roadRows = roads.map((r, i) => `(${[uid(1, i + 1), r.desc, r.reason, r.area, r.path, r.verified].map(lit).join(', ')})`)

// ---------------------------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------------------------
const delNames = (xs: string[]) => xs.map(lit).join(', ')
const sql = `-- =============================================================================
-- VYRA - demo seed, 30 rows per table, for a cloud Supabase project (SIMULATED DATA ONLY)
-- Vulnerability, Yielded Response & Assistance
--
-- Fictional urban-flooding scenario in Karachi. Contents (30 of each):
--   30 sign-in accounts (1 administrator, 9 responders, 20 citizens) - auth users + profiles
--   30 emergency cases across 10 areas (6 pending, 4 investigating, 8 assigned, 10 resolved, 2 cancelled)
--   30 rescue teams, 30 supply records, 30 shelters
--   30 route hazards, 30 blocked roads
--   30 missions (8 live, 16 completed, 6 cancelled) and 30 supply allocations
--   plus ${eventRows.length} audit-history events (derived from the 30 cases)
--
-- HOW TO RUN (Supabase > SQL Editor > New query, one file per run, in this order)
--   1. supabase/vyra_complete_schema.sql
--   2. supabase/migrations/001_stage7_8_dispatch_offline.sql
--   3. this file
--
-- SAFE TO RE-RUN: removes the previous seed rows first (matched by their fixed ids / names), including
-- the older 80-case seed, then inserts these again with fresh timestamps.
-- Reports and accounts created by real users are untouched.
--
-- SECURITY: every account below gets the password on the "seed_password" line. Change it BEFORE
-- running if this project will be reachable by anyone else.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


-- -----------------------------------------------------------------------------
-- 1. Accounts: auth users (email + password sign-in) and their profiles
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  seed_password TEXT := 'VYRA-demo-1';   -- <<< CHANGE THIS before running on a shared project
  a RECORD;
  c RECORD;
BEGIN
  FOR a IN
    SELECT * FROM (VALUES
${accountRows.map((r) => `      ${r}`).join(',\n')}
    ) AS t(id, email, full_name, role)
  LOOP
    -- Re-running replaces the account (and resets its password).
    UPDATE public.dispatches SET assigned_by = NULL WHERE assigned_by = a.id;
    DELETE FROM public.profiles WHERE id = a.id OR email = a.email;
    DELETE FROM auth.users WHERE id = a.id OR email = a.email;   -- identities go with it

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', a.id, 'authenticated', 'authenticated', a.email,
      crypt(seed_password, gen_salt('bf')), NOW(),
      '{"provider":"email","providers":["email"]}'::JSONB,
      jsonb_build_object('full_name', a.full_name, 'email_verified', true),
      NOW(), NOW()
    );

    -- GoTrue fails to sign in a user whose token columns are NULL; set whichever exist to ''.
    FOR c IN
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name IN ('confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
                            'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
    LOOP
      EXECUTE format('UPDATE auth.users SET %I = COALESCE(%I, '''') WHERE id = $1', c.column_name, c.column_name) USING a.id;
    END LOOP;

    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), a.id, a.id::TEXT,
      jsonb_build_object('sub', a.id::TEXT, 'email', a.email, 'email_verified', true, 'phone_verified', false),
      'email', NOW(), NOW(), NOW()
    );

    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (a.id, a.email, a.full_name, a.role::user_role)
    -- The sign-up trigger (migration 011) already created a citizen profile for this auth user; set the intended role.
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, role = EXCLUDED.role;
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Remove the previous seed rows (this file is safe to re-run)
-- -----------------------------------------------------------------------------
DELETE FROM dispatches WHERE id::TEXT LIKE '60000000-%';
DELETE FROM emergency_reports WHERE client_id LIKE 'demo-seed-%' OR id::TEXT LIKE '00000000-0000-4000-8000-%';
DELETE FROM resources WHERE id::TEXT LIKE '40000000-%';
DELETE FROM rescue_teams WHERE id::TEXT LIKE '20000000-%' OR team_name IN (${delNames(TEAM_DEFS.map((t: any) => t.team_name))});
DELETE FROM shelters WHERE id::TEXT LIKE '30000000-%' OR name IN (${delNames(SHELTER_DEFS.map((s: any) => s.name))});
DELETE FROM route_hazards WHERE id::TEXT LIKE '50000000-%';
DELETE FROM blocked_roads WHERE id::TEXT LIKE '10000000-%' OR description IN (${delNames(origRoads.map((r) => r[0]))});


-- -----------------------------------------------------------------------------
-- 3. Emergency cases (30) and their audit history (${eventRows.length} events)
-- -----------------------------------------------------------------------------
INSERT INTO emergency_reports (${reportCols.join(', ')}, resolved_at, created_at, updated_at) VALUES
${values(reportRows)};

INSERT INTO report_events (report_id, action, actor, from_value, to_value, note, created_at) VALUES
${values(eventRows)};


-- -----------------------------------------------------------------------------
-- 4. Response operation: teams, supplies, shelters, hazards, roads (30 each)
-- -----------------------------------------------------------------------------
INSERT INTO rescue_teams (id, team_name, team_leader, contact_number, base_location, team_size, capabilities, current_location_lat, current_location_lng, team_type, area, status, verified, created_at) VALUES
${values(teamRows)};

INSERT INTO resources (id, resource_type, name, quantity, team_id, status, notes, created_at) VALUES
${values(resourceRows)};

INSERT INTO shelters (id, name, address, area, location_lat, location_lng, capacity, current_occupancy, contact_number, services, status, verified, created_at) VALUES
${values(shelterRows)};

INSERT INTO route_hazards (id, description, location_lat, location_lng, radius_km, severity, active, created_at) VALUES
${values(hazardRows)};

INSERT INTO blocked_roads (id, description, reason, area, path, verified) VALUES
${values(roadRows)};


-- -----------------------------------------------------------------------------
-- 5. Missions (30) and the supplies each one holds (30)
-- -----------------------------------------------------------------------------
INSERT INTO dispatches (id, report_id, team_id, assigned_by, assigned_at, status, notes, match_score, distance_km, match_explanation, completed_at, created_at, updated_at) VALUES
${values(dispatchRows)};

INSERT INTO dispatch_resources (id, dispatch_id, resource_id, quantity) VALUES
${values(drRows)};


-- -----------------------------------------------------------------------------
-- 6. Check: every line below should say 30 (report_events is derived)
-- -----------------------------------------------------------------------------
SELECT 'profiles (demo accounts)' AS item, COUNT(*) AS rows FROM profiles WHERE email LIKE '%@demo.vyra'
UNION ALL SELECT 'auth users (demo accounts)', COUNT(*) FROM auth.users WHERE email LIKE '%@demo.vyra'
UNION ALL SELECT 'emergency_reports', COUNT(*) FROM emergency_reports WHERE client_id LIKE 'demo-seed-%'
UNION ALL SELECT 'report_events', COUNT(*) FROM report_events WHERE actor IN ('seed', 'Dispatcher (demo)')
UNION ALL SELECT 'rescue_teams', COUNT(*) FROM rescue_teams WHERE id::TEXT LIKE '20000000-%'
UNION ALL SELECT 'resources', COUNT(*) FROM resources WHERE id::TEXT LIKE '40000000-%'
UNION ALL SELECT 'shelters', COUNT(*) FROM shelters WHERE id::TEXT LIKE '30000000-%'
UNION ALL SELECT 'route_hazards', COUNT(*) FROM route_hazards WHERE id::TEXT LIKE '50000000-%'
UNION ALL SELECT 'blocked_roads', COUNT(*) FROM blocked_roads WHERE id::TEXT LIKE '10000000-%'
UNION ALL SELECT 'dispatches', COUNT(*) FROM dispatches WHERE id::TEXT LIKE '60000000-%'
UNION ALL SELECT 'dispatch_resources', COUNT(*) FROM dispatch_resources WHERE id::TEXT LIKE '70000000-%';

NOTIFY pgrst, 'reload schema';
`
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
writeFileSync(SEED_OUT, sql)
const setup = `-- VYRA: complete setup in ONE file (schema + dispatch/offline migration + 30-row seed).
-- Paste into Supabase > SQL Editor > New query and press Run. Safe to re-run.
-- Change seed_password in part 3 first if others can reach the project.
-- Generated by scripts/generate-seed-30.mts - do not edit by hand.

-- ================= PART 1: SCHEMA =================
${read('../supabase/vyra_complete_schema.sql')}
-- ================= PART 2: DISPATCH + OFFLINE MIGRATION =================
${read('../supabase/migrations/001_stage7_8_dispatch_offline.sql').replace(/^NOTIFY.*$/gm, '')}
-- ================= PART 3: SEED DATA (30 per table) =================
${sql}`
writeFileSync(SETUP_OUT, setup)
console.log(`wrote supabase/seed/vyra_full_seed.sql and supabase/vyra_complete_setup.sql: ${accounts.length} accounts, ${reports.length} cases, ${eventRows.length} events, ${teams.length} teams, ${resources.length} resources, ${shelters.length} shelters, ${hazards.length} hazards, ${roads.length} roads, ${dispatches.length} missions, ${dr.length} allocations`)
