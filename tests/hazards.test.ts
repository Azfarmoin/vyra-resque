// Hazard endpoints: responder-only, validated, and verification stamped by the server.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as hazards from '../src/app/api/hazards/route'
import * as hazardById from '../src/app/api/hazards/[id]/route'

beforeEach(() => setStore(createMemoryStore()))

const R = { 'x-demo-user': 'dispatcher@demo.vyra' }
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/hazards', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const ctx = (id: string) => ({ params: { id } })

test('hazard endpoints refuse anonymous and citizen callers', async () => {
  assert.equal((await hazards.GET(req('GET'))).status, 401)
  assert.equal((await hazards.GET(req('GET', undefined, { 'x-demo-user': 'citizen@demo.vyra' }))).status, 403)
  assert.equal((await hazards.POST(req('POST', { description: 'x', location_lat: 24.8, location_lng: 67 }))).status, 401)
  assert.equal((await hazardById.PATCH(req('PATCH', { active: false }), ctx('x'))).status, 401)
  assert.equal((await hazardById.DELETE(req('DELETE'), ctx('x'))).status, 401)
})

test('hazard creation validates input; confirming stamps a server time; clearing deactivates', async () => {
  assert.equal((await hazards.POST(req('POST', { description: 'x', location_lat: 999, location_lng: 67 }, R))).status, 400)
  assert.equal((await hazards.POST(req('POST', { description: '', location_lat: 24, location_lng: 67 }, R))).status, 400)
  assert.equal((await hazards.POST(req('POST', { description: 'x', location_lat: 24, location_lng: 67, bogus: 1 }, R))).status, 400)

  const created = await hazards.POST(req('POST', { description: 'Flooded underpass', location_lat: 24.8, location_lng: 67.0, hazard_type: 'flooding', blocks_road: true }, R))
  assert.equal(created.status, 201)
  const h = await created.json()

  assert.equal((await hazardById.PATCH(req('PATCH', { verify: 'confirmed', last_verified_at: '2000-01-01' }, R), ctx(h.id))).status, 400) // client cannot supply the time
  const before = Date.now()
  const confirmed = await (await hazardById.PATCH(req('PATCH', { verify: 'confirmed' }, R), ctx(h.id))).json()
  assert.equal(confirmed.verification_status, 'confirmed')
  assert.ok(Date.parse(confirmed.last_verified_at) >= before - 1000)

  const cleared = await (await hazardById.PATCH(req('PATCH', { verify: 'resolved' }, R), ctx(h.id))).json()
  assert.equal(cleared.active, false)
  assert.equal((await hazardById.PATCH(req('PATCH', {}, R), ctx(h.id))).status, 400)
  assert.equal((await hazardById.DELETE(req('DELETE', undefined, R), ctx(h.id))).status, 200)
})
