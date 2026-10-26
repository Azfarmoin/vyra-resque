// Calls the Next.js route handlers directly against the in-memory demo store.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as reports from '../src/app/api/reports/route'
import * as reportById from '../src/app/api/reports/[id]/route'
import * as override from '../src/app/api/reports/[id]/triage-override/route'
import * as publicStatus from '../src/app/api/reports/[id]/public-status/route'
import * as triage from '../src/app/api/triage/route'
import * as layers from '../src/app/api/map/layers/route'

beforeEach(() => setStore(createMemoryStore()))

const req = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://localhost${path}`, {
    method: init?.method || 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: { 'content-type': 'application/json' },
  })
const ctx = (id: string) => ({ params: { id } })

const valid = {
  client_id: 'test-client-0001',
  location_lat: 24.868,
  location_lng: 66.993,
  location_source: 'gps',
  location_accuracy_m: 10,
  people_count: 3,
  dangers: ['trapped'],
  injury_severity: 'serious',
  injury_count: 1,
  medical_need_types: ['oxygen'],
  can_evacuate: 'no',
  vulnerabilities: ['elderly'],
  contact_name: 'Test',
  contact_phone: '+92 300 1234567',
}

test('POST /api/reports stores a report, assigns an area, is idempotent and hides details', async () => {
  const first = await reports.POST(req('/api/reports', { method: 'POST', body: valid }))
  assert.equal(first.status, 201)
  const { report } = await first.json()
  assert.equal(report.area, 'Lyari')
  assert.equal(report.contact_info, undefined)

  const retry = await reports.POST(req('/api/reports', { method: 'POST', body: valid }))
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).report.id, report.id)

  const full = await (await reportById.GET(req(`/api/reports/${report.id}`), ctx(report.id))).json()
  assert.equal(full.report.triage.suggestedPriority, 'critical')
  assert.equal(full.report.contact_info, 'Test · +92 300 1234567')
  assert.equal(full.report.immediate_danger, true)
  assert.equal(full.report.history[0].action, 'created')

  const pub = await (await publicStatus.GET(req('/'), ctx(report.id))).json()
  assert.equal(pub.report.status, 'pending')
})

test('POST /api/reports rejects bad input with field details', async () => {
  const res = await reports.POST(req('/api/reports', { method: 'POST', body: { location_lat: 200, location_lng: 0, location_source: 'gps', dangers: ['none', 'fire'], people_count: 0 } }))
  assert.equal(res.status, 400)
  const paths = (await res.json()).details.map((d: { path: string }) => d.path)
  assert.ok(paths.includes('location_lat'))
  assert.ok(paths.includes('people_count'))
})

test('GET /api/reports filters by area and status', async () => {
  const body = await (await reports.GET(req('/api/reports?area=Malir&status=open'))).json()
  assert.ok(body.reports.length > 0)
  assert.ok(body.reports.every((r: { area: string; status: string }) => r.area === 'Malir' && r.status !== 'resolved'))
  assert.equal(body.mode, 'demo')
})

test('GET /api/triage lists open cases highest priority first', async () => {
  const body = await (await triage.GET(req('/api/triage'))).json()
  const rank = { critical: 4, high: 3, medium: 2, low: 1 } as Record<string, number>
  const order = body.reports.map((r: { priority: string }) => rank[r.priority])
  assert.deepEqual(order, [...order].sort((a: number, b: number) => b - a))
  assert.ok(body.reports.every((r: { status: string }) => r.status !== 'resolved'))
})

test('overrides need a reason and are recorded in history', async () => {
  const { reports: list } = await (await triage.GET(req('/api/triage?priority=low,medium'))).json()
  const id = list[0].id

  const noReason = await override.PATCH(req('/', { method: 'PATCH', body: { priority: 'critical', reason: '' } }), ctx(id))
  assert.equal(noReason.status, 400)

  const ok = await (await override.PATCH(req('/', { method: 'PATCH', body: { priority: 'critical', reason: 'Phoned reporter: man collapsed', by: 'Ops lead' } }), ctx(id))).json()
  assert.equal(ok.report.priority, 'critical')
  assert.equal(ok.report.overridden, true)
  assert.equal(ok.report.history.at(-1).action, 'override')
  assert.equal(ok.report.history.at(-1).actor, 'Ops lead')

  const cleared = await (await override.PATCH(req('/', { method: 'PATCH', body: { priority: null, reason: 'Situation stabilised' } }), ctx(id))).json()
  assert.equal(cleared.report.overridden, false)
})

test('resolving a case removes it from the triage queue', async () => {
  const { reports: list } = await (await triage.GET(req('/api/triage'))).json()
  const id = list[0].id
  const res = await reportById.PATCH(req('/', { method: 'PATCH', body: { status: 'resolved', by: 'Team A' } }), ctx(id))
  assert.equal(res.status, 200)
  const after = await (await triage.GET(req('/api/triage'))).json()
  assert.ok(!after.reports.some((r: { id: string }) => r.id === id))
})

test('GET /api/map/layers returns only verified, active layers', async () => {
  const body = await (await layers.GET(req('/api/map/layers'))).json()
<<<<<<< HEAD
  assert.ok(body.shelters.length >= 4)
  assert.ok(body.shelters.every((s: { verified: boolean }) => s.verified))
  assert.ok(!body.shelters.some((s: { name: string }) => /Rumoured/.test(s.name)))
  assert.ok(body.teams.length > 0)
  assert.ok(body.teams.every((t: { status: string }) => t.status !== 'unavailable'))
  assert.ok(body.roadBlocks.length >= 3)
  assert.ok(body.roadBlocks.every((r: { verified: boolean }) => r.verified))
=======
  assert.equal(body.shelters.length, 4)
  assert.ok(body.teams.every((t: { status: string }) => t.status !== 'unavailable'))
  assert.equal(body.roadBlocks.length, 3)
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
})
