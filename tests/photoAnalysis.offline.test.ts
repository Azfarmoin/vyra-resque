// Offline photo analysis: photos saved with the report on the device, "waiting" while offline, analysis
// triggered only after the server confirms the photos, failures never break sync, retries never duplicate.
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { closeDbForTests, DB_NAME } from '../src/lib/offline/db'
import { addAttachment, getReport, listAttachments, patchAttachment, queueReport, generateId } from '../src/lib/offline/store'
import { syncAll, type SyncDeps } from '../src/lib/offline/sync'
import { ANON } from '../src/lib/offline/types'
import type { Identity } from '../src/lib/offline/identity'
import { previewAnalysis, WAITING_TEXT } from '../src/lib/photoAnalysis/client'
import { callFor } from './fixtures/photoScenarios'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5])
const jpeg = (name = 'a.jpg') => Object.assign(new Blob([JPEG], { type: 'image/jpeg' }), { name })
const ANONYMOUS: Identity = { owner: ANON, userId: null, email: null, token: null }

beforeEach(async () => {
  await closeDbForTests()
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME)
    r.onsuccess = () => res()
    r.onerror = () => rej(r.error)
  })
})

interface Srv {
  reports: Map<string, string>
  photos: Set<string>
  analysisCalls: { aid: string; consent: unknown; clientId: string | null; method: string; body: Record<string, unknown> }[]
  analysed: Set<string>
  order: string[]
  analysis: 'ok' | 'down' | 'error500' | 'failed'
}
function makeServer() {
  const s: Srv = { reports: new Map(), photos: new Set(), analysisCalls: [], analysed: new Set(), order: [], analysis: 'ok' }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    if (url === '/api/reports') {
      const key = headers.get('idempotency-key')!
      const dup = s.reports.has(key)
      if (!dup) s.reports.set(key, `srv-${s.reports.size + 1}`)
      s.order.push('report')
      return json(dup ? 200 : 201, { report: { id: s.reports.get(key), status: 'pending' }, duplicate: dup })
    }
    let m = url.match(/^\/api\/reports\/([^/]+)\/attachments$/)
    if (m) {
      s.photos.add(headers.get('x-attachment-id')!)
      s.order.push('photo')
      return json(201, { attachment: { id: `srv-${headers.get('x-attachment-id')}` }, duplicate: false })
    }
    m = url.match(/^\/api\/reports\/([^/]+)\/attachments\/([^/]+)\/analysis$/)
    if (m) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      s.analysisCalls.push({ aid: m[2], consent: body.consent, clientId: headers.get('x-report-client-id'), method: init?.method || 'GET', body })
      s.order.push(`analysis:${init?.method}`)
      if (init?.method === 'PATCH') return json(200, { analysis: {} })
      if (s.analysis === 'down') throw new TypeError('Failed to fetch')
      if (s.analysis === 'error500') return json(503, { error: 'busy' })
      const first = !s.analysed.has(m[2])
      s.analysed.add(m[2])
      if (s.analysis === 'failed') return json(200, { analysis: { analysis_status: 'failed', result: null, failure_reason: 'The AI service took too long to answer.' }, reused: !first })
      return json(200, { analysis: { analysis_status: 'completed', result: (callFor('flood') as { result: object }).result, failure_reason: null }, reused: !first })
    }
    return json(404, { error: 'nope' })
  }
  return { s, fetchMock }
}
const deps = (server: ReturnType<typeof makeServer>, online = true): SyncDeps => ({ fetch: server.fetchMock, getIdentity: async () => ANONYMOUS, now: () => Date.parse('2026-10-24T10:00:00Z'), random: () => 0.5, isOnline: () => online })
const queue = (id = generateId()) => queueReport({ client_id: id, owner: ANON, form: {}, payload: { location_source: 'manual', location_address: 'near the blue gate', dangers: ['rising_water'] } })
const waitFor = async (cond: () => Promise<boolean> | boolean, ms = 2000) => {
  const t0 = Date.now()
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

test('offline: photo and consent are saved on the device, analysis is "waiting", nothing is sent, and no analysis is faked', async () => {
  const server = makeServer()
  const r = await queue()
  const saved = await addAttachment(r.client_id, ANON, jpeg())
  await patchAttachment(saved.id, { analysis_consent: true })
  // the form asks the preview endpoint while offline: it never calls the network and says "waiting"
  const waiting = await previewAnalysis(saved.blob!, { online: false, fetchImpl: server.fetchMock })
  await patchAttachment(saved.id, { analysis: waiting })
  const [att] = await listAttachments(r.client_id)
  assert.equal(att.analysis!.status, 'waiting')
  assert.equal(att.analysis!.reason, WAITING_TEXT)
  assert.equal(att.analysis!.result, null)
  assert.ok(att.blob) // original kept on the device
  assert.deepEqual(await syncAll({}, deps(server, false)), { skipped: 'offline', synced: 0, failed: 0, waiting: 0, needsAuth: 0 })
  assert.equal(server.s.analysisCalls.length, 0)
  assert.equal(server.s.reports.size, 0)
})

test('back online: report and photo sync first, then analysis starts only after the server confirmed the photo', async () => {
  const server = makeServer()
  const r = await queue()
  const saved = await addAttachment(r.client_id, ANON, jpeg())
  await patchAttachment(saved.id, { analysis_consent: true })
  const sum = await syncAll({}, deps(server))
  assert.equal(sum.synced, 1)
  assert.equal((await getReport(r.client_id))!.status, 'synced')
  await waitFor(async () => (await listAttachments(r.client_id))[0].analysis?.server_checked === true)
  assert.deepEqual(server.s.order, ['report', 'photo', 'analysis:POST'])
  const call = server.s.analysisCalls[0]
  assert.equal(call.consent, true)
  assert.equal(call.clientId, r.client_id) // proves the device owns the anonymous report
  assert.equal(call.aid, `srv-${saved.id}`)
  const [att] = await listAttachments(r.client_id)
  assert.equal(att.status, 'uploaded')
  assert.equal(att.blob, null)
  assert.equal(att.analysis!.status, 'completed')
})

test('no consent, no analysis call', async () => {
  const server = makeServer()
  const r = await queue()
  await addAttachment(r.client_id, ANON, jpeg())
  await syncAll({}, deps(server))
  await new Promise((res) => setTimeout(res, 50))
  assert.equal(server.s.analysisCalls.length, 0)
  assert.equal((await getReport(r.client_id))!.status, 'synced')
})

test('analysis failure (server down, 503, or model failure) never fails the sync and keeps all data', async () => {
  for (const mode of ['down', 'error500', 'failed'] as const) {
    await closeDbForTests()
    const server = makeServer()
    server.s.analysis = mode
    const r = await queue()
    const saved = await addAttachment(r.client_id, ANON, jpeg())
    await patchAttachment(saved.id, { analysis_consent: true })
    const sum = await syncAll({}, deps(server))
    assert.equal(sum.synced, 1, mode)
    assert.equal(sum.failed, 0, mode)
    const rep = (await getReport(r.client_id))!
    assert.equal(rep.status, 'synced', mode)
    assert.equal(rep.server_id, 'srv-' + server.s.reports.size)
    await waitFor(() => server.s.analysisCalls.length >= 1)
    await new Promise((res) => setTimeout(res, 30))
    const [att] = await listAttachments(r.client_id)
    assert.equal(att.status, 'uploaded', mode) // photo is safe on the server
    if (mode === 'failed') {
      assert.equal(att.analysis!.status, 'failed')
      assert.match(att.analysis!.reason!, /too long/)
    }
    await new Promise<void>((res, rej) => {
      closeDbForTests().then(() => {
        const q = indexedDB.deleteDatabase(DB_NAME)
        q.onsuccess = () => res()
        q.onerror = () => rej(q.error)
      })
    })
  }
})

test('retries are idempotent: syncing again creates no duplicate reports, photos or analysis calls once checked', async () => {
  const server = makeServer()
  const r = await queue()
  const saved = await addAttachment(r.client_id, ANON, jpeg())
  await patchAttachment(saved.id, { analysis_consent: true })
  await syncAll({}, deps(server))
  await waitFor(async () => (await listAttachments(r.client_id))[0].analysis?.server_checked === true)
  await syncAll({ force: true }, deps(server))
  await new Promise((res) => setTimeout(res, 50))
  assert.equal(server.s.reports.size, 1)
  assert.equal(server.s.photos.size, 1)
  assert.equal(server.s.analysisCalls.filter((c) => c.method === 'POST').length, 1)
})

test('what the reporter did with the suggestions is passed to the server after analysis', async () => {
  const server = makeServer()
  const r = await queue()
  const saved = await addAttachment(r.client_id, ANON, jpeg())
  await patchAttachment(saved.id, { analysis_consent: true, analysis: { status: 'completed', result: (callFor('flood') as unknown as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result, reason: null, at: null, choice: 'edited', server_checked: false } })
  await syncAll({}, deps(server))
  await waitFor(() => server.s.analysisCalls.some((c) => c.method === 'PATCH'))
  assert.deepEqual(server.s.analysisCalls.find((c) => c.method === 'PATCH')!.body, { user_action: 'edited' })
  // the suggestions the reporter already saw are kept locally
  assert.equal((await listAttachments(r.client_id))[0].analysis!.result!.suggested_report_title, 'Floodwater reported on road')
})

test('a report with several photos analyses each one separately', async () => {
  const server = makeServer()
  const r = await queue()
  for (const n of ['1.jpg', '2.jpg', '3.jpg']) {
    const a = await addAttachment(r.client_id, ANON, jpeg(n))
    await patchAttachment(a.id, { analysis_consent: true })
  }
  await syncAll({}, deps(server))
  await waitFor(() => server.s.analysisCalls.length >= 3)
  assert.equal(new Set(server.s.analysisCalls.map((c) => c.aid)).size, 3)
})
