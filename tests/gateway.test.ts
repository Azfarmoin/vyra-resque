// Server side of radio / SMS / Bluetooth / manual delivery, against the in-memory store.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as ingest from '../src/app/api/gateway/ingest/route'
import * as sms from '../src/app/api/gateway/sms/route'
import * as reports from '../src/app/api/reports/route'
import * as reportById from '../src/app/api/reports/[id]/route'
import { encodeCompact } from '../src/lib/delivery/compact'
import { twilioSignature } from '../src/lib/gateway/twilio'

const KEY = 'gateway-key-1234567890'
beforeEach(() => {
  setStore(createMemoryStore())
  process.env.GATEWAY_API_KEY = KEY
  process.env.TWILIO_AUTH_TOKEN = 'twilio-secret'
  process.env.PUBLIC_BASE_URL = 'https://vyra.example'
})

const CID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b'
const fullBody = {
  client_id: CID, location_lat: 24.8556, location_lng: 67.0228, location_source: 'gps', location_address: 'Behind the clock tower',
  incident_time: '2026-10-26T08:00:00.000Z', reporter_urgency: 'critical', people_count: 4, dangers: ['trapped', 'rising_water'],
  injury_severity: 'serious', medical_need_types: ['oxygen'], medical_needs: 'Oxygen concentrator, battery low', can_evacuate: 'no', contact_name: 'Sara', contact_phone: '+92 300 1234567',
}
const compact = () => encodeCompact({ ...fullBody, client_id: CID }).text
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const auth = { authorization: `Bearer ${KEY}` }
const msg = (raw: string, channel = 'radio') => ({ gateway_id: 'gw-7', messages: [{ channel, raw }] })

test('gateway ingestion is off without a key, and refuses a wrong key', async () => {
  delete process.env.GATEWAY_API_KEY
  assert.equal((await ingest.POST(post('/api/gateway/ingest', msg(compact()), auth))).status, 503)
  process.env.GATEWAY_API_KEY = KEY
  assert.equal((await ingest.POST(post('/api/gateway/ingest', msg(compact())))).status, 401)
  assert.equal((await ingest.POST(post('/api/gateway/ingest', msg(compact()), { authorization: 'Bearer wrong-wrong-wrong-wrong' }))).status, 401)
  process.env.GATEWAY_API_KEY = 'short'
  assert.equal((await ingest.POST(post('/api/gateway/ingest', msg(compact()), { authorization: 'Bearer short' }))).status, 503) // weak keys are not accepted
})

test('a radio message creates a partial report with an ACK line; a retransmission is a duplicate, not a second incident', async () => {
  const first = await (await ingest.POST(post('/api/gateway/ingest', msg(compact()), auth))).json()
  const r = first.results[0]
  assert.equal(r.ok, true)
  assert.equal(r.duplicate, false)
  assert.match(r.ack, /^ACK\|[A-Za-z0-9_-]{22}\|gw-7$/)

  const again = await (await ingest.POST(post('/api/gateway/ingest', msg(compact()), auth))).json()
  assert.equal(again.results[0].duplicate, true)
  assert.equal(again.results[0].report_id, r.report_id)

  const detail = await (await reportById.GET(new NextRequest(`http://localhost/api/reports/${r.report_id}`), { params: { id: r.report_id } })).json()
  const rep = detail.report
  assert.equal(rep.partial, true)
  assert.equal(rep.ingest_channel, 'radio')
  assert.equal(rep.people_count, 4)
  assert.equal(rep.location_source, 'manual') // the short message cannot prove "GPS"
  assert.equal(rep.incident_time, '2026-10-26T08:00:00.000Z')
  assert.ok(rep.dangers.includes('trapped'))
  assert.equal(rep.immediate_danger, true)
  assert.ok(rep.history.some((e: { note: string }) => /gateway gw-7/.test(e.note)))
})

test('the full report later completes the SAME incident: details added, id, creation time and responder state kept', async () => {
  const short = (await (await ingest.POST(post('/api/gateway/ingest', msg(compact()), auth))).json()).results[0]
  // a responder already picked it up from the short message
  const { getStore } = await import('../src/lib/db')
  await getStore().updateReport(short.report_id, { status: 'investigating', verified: true })

  const res = await reports.POST(post('/api/reports', fullBody))
  assert.equal(res.status, 200) // duplicate: it is the same incident
  const body = await res.json()
  assert.equal(body.duplicate, true)
  assert.equal(body.report.id, short.report_id)
  assert.equal(body.report.partial, false)
  assert.equal(body.report.ingest_channel, 'radio') // the device learns the server already had the short copy

  const all = (await getStore().listReports({})).filter((x) => x.client_id === CID)
  assert.equal(all.length, 1)
  const row = all[0]
  assert.equal(row.medical_needs, 'Oxygen concentrator, battery low')
  assert.equal(row.contact_info, 'Sara · +92 300 1234567')
  assert.equal(row.location_address, 'Behind the clock tower')
  assert.equal(row.status, 'investigating')
  assert.equal(row.verified, true)
})

test('the full report arriving first makes a later radio retransmission harmless', async () => {
  await reports.POST(post('/api/reports', fullBody))
  const r = (await (await ingest.POST(post('/api/gateway/ingest', msg(compact()), auth))).json()).results[0]
  assert.equal(r.ok, true)
  assert.equal(r.duplicate, true)
  const { getStore } = await import('../src/lib/db')
  assert.equal((await getStore().listReports({})).filter((x) => x.client_id === CID).length, 1)
})

test('damaged messages are rejected and nothing is recorded', async () => {
  const { getStore: gs } = await import('../src/lib/db')
  const before = (await gs().listReports({})).length
  const bad = compact().replace('|4|', '|7|')
  const r = (await (await ingest.POST(post('/api/gateway/ingest', msg(bad), auth))).json()).results[0]
  assert.equal(r.ok, false)
  assert.match(r.error, /Checksum/)
  assert.equal((await gs().listReports({})).length, before)
  assert.equal((await ingest.POST(post('/api/gateway/ingest', { messages: [] }, auth))).status, 400)
})

test('SMS webhook: unsigned requests are refused; a signed one records the report and replies with the acknowledgement', async () => {
  const params = { Body: compact(), From: '+923001112233', To: '+15550001234' }
  const form = new URLSearchParams(params).toString()
  const mk = (sig?: string) => new NextRequest('http://localhost/api/gateway/sms', { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sig ? { 'x-twilio-signature': sig } : {}) } })
  assert.equal((await sms.POST(mk())).status, 403)
  assert.equal((await sms.POST(mk('bogus'))).status, 403)

  const good = await sms.POST(mk(twilioSignature('twilio-secret', 'https://vyra.example/api/gateway/sms', params)))
  assert.equal(good.status, 200)
  const xml = await good.text()
  assert.match(xml, /VYRA ACK [A-Za-z0-9_-]{22}/)
  assert.match(xml, /has not acknowledged it yet/)
  const { getStore } = await import('../src/lib/db')
  const rows = (await getStore().listReports({})).filter((x) => x.client_id === CID)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ingest_channel, 'sms')
  const total = (await getStore().listReports({})).length

  const junkParams = { Body: 'help me please', From: '+923001112233', To: '+15550001234' }
  const junk = new NextRequest('http://localhost/api/gateway/sms', { method: 'POST', body: new URLSearchParams(junkParams).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilioSignature('twilio-secret', 'https://vyra.example/api/gateway/sms', junkParams) } })
  const jr = await (await sms.POST(junk)).text()
  assert.match(jr, /NOT recorded/) // the sender is told the truth
  assert.equal((await getStore().listReports({})).length, total)

  delete process.env.TWILIO_AUTH_TOKEN
  assert.equal((await sms.POST(mk('x'))).status, 503)
})
