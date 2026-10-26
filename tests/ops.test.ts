// Teams, supplies, shelters and missions against the in-memory demo database.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as teams from '../src/app/api/teams/route'
import * as teamById from '../src/app/api/teams/[id]/route'
import * as resources from '../src/app/api/resources/route'
import * as resourceById from '../src/app/api/resources/[id]/route'
import * as shelters from '../src/app/api/shelters/route'
import * as dispatches from '../src/app/api/dispatches/route'
import * as dispatchById from '../src/app/api/dispatches/[id]/route'
import * as reports from '../src/app/api/reports/route'
import * as reportById from '../src/app/api/reports/[id]/route'
import * as demoAuth from '../src/app/api/demo/auth/route'

beforeEach(() => setStore(createMemoryStore()))

const req = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method || 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
// Shelters: administrators write, responders and administrators read the full records (the public list is verified shelters only).
const ADMIN = { 'x-demo-user': 'admin@demo.vyra' }
const ctx = (id: string) => ({ params: { id } })
const json = async (r: Response) => r.json()

test('the demo data set is large and varied', async () => {
  const list = await json(await reports.GET(req('/api/reports')))
  assert.ok(list.reports.length >= 70)
  for (const p of ['critical', 'high', 'medium', 'low']) assert.ok(list.summary.byPriority[p] > 0, `has ${p} cases`)
  for (const s of ['pending', 'investigating', 'assigned', 'resolved']) assert.ok(list.summary.byStatus[s] > 0, `has ${s} cases`)
  assert.ok((await json(await teams.GET(req('/api/teams')))).length >= 12)
  assert.ok((await json(await resources.GET(req('/api/resources')))).length >= 25)
  assert.ok((await json(await shelters.GET(req('/api/shelters', { headers: ADMIN })))).shelters.length >= 8)
})

test('a mission locks the team and case, and completing it frees them', async () => {
  const [team] = (await json(await teams.GET(req('/api/teams')))).filter((t: { status: string }) => t.status === 'available')
  const { reports: open } = await json(await reports.GET(req('/api/reports?status=open')))
  const target = open.find((r: { status: string }) => r.status === 'pending')

  const made = await dispatches.POST(req('/api/dispatches', { method: 'POST', body: { report_id: target.id, team_id: team.id } }))
  assert.equal(made.status, 201)
  const mission = await json(made)
  assert.equal(mission.rescue_teams.team_name, team.team_name)

  // The same team cannot be sent twice.
  const again = await dispatches.POST(req('/api/dispatches', { method: 'POST', body: { report_id: target.id, team_id: team.id } }))
  assert.equal(again.status, 409)
  // A team on a mission cannot be switched off or deleted.
  assert.equal((await teamById.PATCH(req('/', { method: 'PATCH', body: { status: 'unavailable' } }), ctx(team.id))).status, 409)
  assert.equal((await teamById.DELETE(req('/', { method: 'DELETE' }), ctx(team.id))).status, 409)

  const done = await dispatchById.PATCH(req('/', { method: 'PATCH', body: { status: 'completed' } }), ctx(mission.id))
  assert.equal(done.status, 200)
  const after = (await json(await teams.GET(req('/api/teams')))).find((t: { id: string }) => t.id === team.id)
  assert.equal(after.status, 'available')
  const rep = await json(await reportById.GET(req('/'), ctx(target.id)))
  assert.equal(rep.report.status, 'resolved')
})

test('supplies: validation, restock and in-use protection', async () => {
  const bad = await resources.POST(req('/api/resources', { method: 'POST', body: { resource_type: 'helicopter' } }))
  assert.equal(bad.status, 400)
  assert.equal((await resources.POST(req('/api/resources', { method: 'POST', body: { resource_type: 'food', quantity: 0 } }))).status, 400)

  const made = await json(await resources.POST(req('/api/resources', { method: 'POST', body: { resource_type: 'food', name: 'Test packs', quantity: 5 } })))
  const restocked = await resourceById.PATCH(req('/', { method: 'PATCH', body: { quantity: 15 } }), ctx(made.id))
  assert.equal((await json(restocked)).quantity, 15)
  assert.equal((await resourceById.PATCH(req('/', { method: 'PATCH', body: { quantity: -2 } }), ctx(made.id))).status, 400)
  assert.equal((await resourceById.PATCH(req('/', { method: 'PATCH', body: { status: 'in_use' } }), ctx(made.id))).status, 400)
  assert.equal((await resourceById.PATCH(req('/', { method: 'PATCH', body: { quantity: 1 } }), ctx('00000000-0000-0000-0000-00000000dead'))).status, 404)

  const inUse = (await json(await resources.GET(req('/api/resources')))).find((r: { status: string }) => r.status === 'in_use')
  assert.equal((await resourceById.DELETE(req('/', { method: 'DELETE' }), ctx(inUse.id))).status, 409)
})

test('shelters: administrators only, name required, unknown fields refused, zero coordinates kept, new records start unverified', async () => {
  const post = (body: unknown, headers?: Record<string, string>) => shelters.POST(req('/api/shelters', { method: 'POST', body, headers }))
  assert.equal((await post({ name: 'Anyone', capacity: 10 })).status, 401) // no sign-in
  assert.equal((await post({ name: 'Responder', capacity: 10 }, { 'x-demo-user': 'dispatcher@demo.vyra' })).status, 403) // responders cannot add shelters
  assert.equal((await post({ capacity: 10 }, ADMIN)).status, 400)
  assert.equal((await post({ name: 'X', capacity: 10, current_occupancy: 11 }, ADMIN)).status, 400) // headcounts are set through the occupancy action, not at creation
  const made = await post({ name: 'Zero coordinates hall', capacity: 10, location_lat: 0, location_lng: 0 }, ADMIN)
  assert.equal(made.status, 201)
  const created = (await json(made)).shelter
  assert.equal(created.location_lat, 0)
  assert.equal(created.verified, false)
  assert.equal(created.verification_status, 'unverified')
})

test('demo accounts: sign in, wrong password, register without admin', async () => {
  const info = await json(await demoAuth.GET())
  assert.equal(info.demo, true)
  const ok = await demoAuth.POST(req('/api/demo/auth', { method: 'POST', body: { email: 'dispatcher@demo.vyra', password: info.password } }))
  assert.equal((await json(ok)).user.role, 'responder')
  assert.equal((await demoAuth.POST(req('/api/demo/auth', { method: 'POST', body: { email: 'dispatcher@demo.vyra', password: 'nope' } }))).status, 401)

  const reg = await demoAuth.POST(req('/api/demo/auth', { method: 'POST', body: { action: 'register', email: 'new@example.com', password: 'abcdef', full_name: 'New Person', role: 'admin' } }))
  assert.equal(reg.status, 201)
  const login = await json(await demoAuth.POST(req('/api/demo/auth', { method: 'POST', body: { email: 'new@example.com', password: 'abcdef' } })))
  assert.equal(login.user.role, 'citizen') // self-service never grants admin
})
