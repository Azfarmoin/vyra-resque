// Server side of offline sync: ownership rules, idempotency, private photo upload. In-memory store, no network.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore, getStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as reports from '../src/app/api/reports/route'
import * as attachments from '../src/app/api/reports/[id]/attachments/route'
import * as attachment from '../src/app/api/reports/[id]/attachments/[aid]/route'

beforeEach(() => setStore(createMemoryStore()))

const CITIZEN = '90000000-0000-4000-8000-000000000005'
const NEIGHBOUR = '90000000-0000-4000-8000-000000000006'
const RESPONDER = '90000000-0000-4000-8000-000000000002'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const post = (body: unknown, token?: string) =>
  reports.POST(new NextRequest('http://localhost/api/reports', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }))
const base = (extra: Record<string, unknown> = {}) => ({
  client_id: `client-${Math.random().toString(36).slice(2, 12)}`,
  location_source: 'manual', location_lat: 24.868, location_lng: 66.993, dangers: ['rising_water'], ...extra,
})
const ctx = (id: string, aid = '') => ({ params: { id, aid } })
const upload = (id: string, body: Uint8Array | string, headers: Record<string, string>) =>
  attachments.POST(new NextRequest(`http://localhost/api/reports/${id}/attachments`, { method: 'POST', body: body as BodyInit, headers }), ctx(id))
const get = (path: string, token?: string) => new NextRequest(`http://localhost${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })

test('landmark-only report is accepted without coordinates; no location at all is refused', async () => {
  const ok = await post({ client_id: 'landmark-0001', location_source: 'manual', location_address: 'behind the blue gate, near Lyari bridge', dangers: ['fire'] })
  assert.equal(ok.status, 201)
  const row = await getStore().findReportByClientId('landmark-0001')
  assert.equal(row!.location_lat, null)
  assert.equal(row!.area, null) // no coordinates, so no invented area
  assert.equal((await post({ client_id: 'nowhere-0001', location_source: 'manual', dangers: [] })).status, 400)
  assert.equal((await post({ client_id: 'halfpos-0001', location_source: 'gps', location_lat: 24.8, location_address: 'x' })).status, 400)
})

test('offline fields are stored: incident time, reporter urgency, capture time, offline flag', async () => {
  const res = await post(base({ incident_time: '2026-10-24T08:15:00.000Z', reporter_urgency: 'high', location_captured_at: '2026-10-24T08:16:00.000Z', submitted_offline: true, client_created_at: '2026-10-24T08:20:00.000Z' }))
  assert.equal(res.status, 201)
  const stored = (await getStore().listReports({}))[0]
  assert.equal(stored.reporter_urgency, 'high')
  assert.equal(stored.incident_time, '2026-10-24T08:15:00.000Z')
  assert.equal(stored.submitted_offline, true)
  assert.equal((await post(base({ reporter_urgency: 'urgent!!' }))).status, 400)
})

test('reporter_id cannot be claimed without a valid sign-in, and cannot differ from the signed-in user', async () => {
  assert.equal((await post(base({ reporter_id: CITIZEN }))).status, 401) // claims an account, no token
  const spoof = await post(base({ reporter_id: NEIGHBOUR }), `demo:${CITIZEN}`)
  assert.equal(spoof.status, 403)
  assert.equal((await spoof.json()).code, 'account_mismatch')
  const expired = await post(base(), 'not-a-real-token')
  assert.equal(expired.status, 401)
  assert.equal((await expired.json()).code, 'auth_required')
  const good = await post(base(), `demo:${CITIZEN}`) // owner comes from the verified token, not the body
  assert.equal(good.status, 201)
  assert.equal((await getStore().listReports({}))[0].reporter_id, CITIZEN)
})

test('retrying a client_id under another account does not return or expose the first account\'s report', async () => {
  const body = base()
  assert.equal((await post(body, `demo:${CITIZEN}`)).status, 201)
  assert.equal((await post(body, `demo:${CITIZEN}`)).status, 200)
  assert.equal((await post(body, `demo:${NEIGHBOUR}`)).status, 409)
  assert.equal((await post(body)).status, 409)
})

async function anonReport() {
  const body = base()
  const { report } = await (await post(body)).json()
  return { id: report.id as string, clientId: body.client_id as string }
}

test('photo upload: stored privately, idempotent, validated by content', async () => {
  const { id, clientId } = await anonReport()
  const h = (att: string, extra: Record<string, string> = {}) => ({ 'x-attachment-id': att, 'x-report-client-id': clientId, 'content-type': 'image/png', ...extra })

  const first = await upload(id, PNG, h('photo-0001'))
  assert.equal(first.status, 201)
  const again = await upload(id, PNG, h('photo-0001')) // retry after a lost response
  assert.equal(again.status, 200)
  assert.equal((await again.json()).duplicate, true)
  assert.equal((await getStore().listAttachments(id)).length, 1)

  assert.equal((await upload(id, 'just text, not an image', h('photo-0002'))).status, 415)
  assert.equal((await upload(id, new Uint8Array(0), h('photo-0003'))).status, 400)
  assert.equal((await upload(id, new Uint8Array(5 * 1024 * 1024 + 1).fill(1), h('photo-0004'))).status, 413)
  assert.equal((await upload(id, PNG, { 'x-report-client-id': clientId })).status, 400) // no attachment id
})

test('photo upload: only the creating device (anonymous) or the owning account (signed in) may attach', async () => {
  const { id } = await anonReport()
  assert.equal((await upload(id, PNG, { 'x-attachment-id': 'photo-0001', 'x-report-client-id': 'someone-elses-guess' })).status, 403)
  assert.equal((await upload(id, PNG, { 'x-attachment-id': 'photo-0001' })).status, 403)

  const body = base()
  const { report } = await (await post(body, `demo:${CITIZEN}`)).json()
  const mk = (token?: string) => ({ 'x-attachment-id': 'photo-0009', 'x-report-client-id': body.client_id as string, ...(token ? { authorization: `Bearer ${token}` } : {}) })
  assert.equal((await upload(report.id, PNG, mk())).status, 401)
  const wrong = await upload(report.id, PNG, mk(NEIGHBOUR && `demo:${NEIGHBOUR}`))
  assert.equal(wrong.status, 403)
  assert.equal((await wrong.json()).code, 'account_mismatch')
  assert.equal((await upload(report.id, PNG, mk('expired-token'))).status, 401)
  assert.equal((await upload(report.id, PNG, mk(`demo:${CITIZEN}`))).status, 201)
})

test('a report holds at most 8 photos', async () => {
  const { id, clientId } = await anonReport()
  for (let i = 0; i < 8; i++) assert.equal((await upload(id, PNG, { 'x-attachment-id': `photo-000${i}`, 'x-report-client-id': clientId })).status, 201)
  assert.equal((await upload(id, PNG, { 'x-attachment-id': 'photo-9999', 'x-report-client-id': clientId })).status, 422)
})

test('only responders and admins can list or download photos; downloads are never cached', async () => {
  const { id, clientId } = await anonReport()
  const up = await upload(id, PNG, { 'x-attachment-id': 'photo-0001', 'x-report-client-id': clientId })
  const { attachment: meta } = await up.json()

  assert.equal((await attachments.GET(get(`/api/reports/${id}/attachments`), ctx(id))).status, 401)
  assert.equal((await attachments.GET(get(`/api/reports/${id}/attachments`, `demo:${CITIZEN}`), ctx(id))).status, 403)
  const list = await attachments.GET(get(`/api/reports/${id}/attachments`, `demo:${RESPONDER}`), ctx(id))
  assert.equal(list.status, 200)
  assert.equal((await list.json()).attachments.length, 1)

  assert.equal((await attachment.GET(get('/x'), ctx(id, meta.id))).status, 401)
  const file = await attachment.GET(get('/x', `demo:${RESPONDER}`), ctx(id, meta.id))
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'image/png')
  assert.match(file.headers.get('cache-control')!, /no-store/)
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG)
})
