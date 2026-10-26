// AI photo analysis API: consent, ownership, idempotency, storage of results, staff review, signed links,
// failure handling. In-memory store and a mocked analyzer: no network, no paid calls.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore, getStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import { setAnalyzer, clearPhotoCache } from '../src/lib/photoAnalysis/service'
import { resetRateLimits } from '../src/lib/routing/rateLimit'
import { signPhotoUrl, verifyPhotoSignature } from '../src/lib/signedUrl'
import type { ModelCall } from '../src/lib/photoAnalysis/model'
import * as reports from '../src/app/api/reports/route'
import * as attachments from '../src/app/api/reports/[id]/attachments/route'
import * as attachment from '../src/app/api/reports/[id]/attachments/[aid]/route'
import * as analysis from '../src/app/api/reports/[id]/attachments/[aid]/analysis/route'
import * as analyses from '../src/app/api/reports/[id]/analyses/route'
import * as preview from '../src/app/api/photo-analysis/preview/route'
import { callFor, SCENARIOS } from './fixtures/photoScenarios'

const CITIZEN = '90000000-0000-4000-8000-000000000005'
const NEIGHBOUR = '90000000-0000-4000-8000-000000000006'
const RESPONDER = '90000000-0000-4000-8000-000000000002'
const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n, 2, 3, 4])

let analyzerCalls = 0
let plan: (bytes: Uint8Array) => ModelCall | Promise<ModelCall>
beforeEach(() => {
  setStore(createMemoryStore())
  resetRateLimits()
  clearPhotoCache()
  analyzerCalls = 0
  plan = () => callFor('flood')
  setAnalyzer(async (bytes) => {
    analyzerCalls++
    return plan(bytes)
  })
})

const auth = (t?: string): Record<string, string> => (t ? { authorization: `Bearer ${t}` } : {})
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
const ctx = (id: string, aid = '') => ({ params: { id, aid } })

async function makeReport(owner?: string) {
  const client_id = `client-${Math.random().toString(36).slice(2, 12)}`
  const res = await reports.POST(json('/api/reports', 'POST', { client_id, location_source: 'manual', location_lat: 24.868, location_lng: 66.993, dangers: ['rising_water'] }, auth(owner && `demo:${owner}`)))
  assert.equal(res.status, 201)
  const { report } = await res.json()
  return { id: report.id as string, client_id }
}
async function addPhoto(rep: { id: string; client_id: string }, n: number, owner?: string) {
  const attId = `photo-${n}-${Math.random().toString(36).slice(2, 8)}`
  const res = await attachments.POST(new NextRequest(`http://localhost/api/reports/${rep.id}/attachments`, { method: 'POST', body: png(n) as BodyInit, headers: { 'x-attachment-id': attId, 'x-report-client-id': rep.client_id, ...auth(owner && `demo:${owner}`) } }), ctx(rep.id))
  assert.equal(res.status, 201)
  return (await res.json()).attachment.id as string
}
const analyze = (rep: { id: string; client_id: string }, aid: string, body: unknown = { consent: true }, headers: Record<string, string> = {}) =>
  analysis.POST(json(`/api/reports/${rep.id}/attachments/${aid}/analysis`, 'POST', body, { 'x-report-client-id': rep.client_id, ...headers }), ctx(rep.id, aid))

test('consent is required: no analysis (and no model call) without it', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  assert.equal((await analyze(rep, aid, {})).status, 400)
  assert.equal((await analyze(rep, aid, { consent: false })).status, 400)
  assert.equal(analyzerCalls, 0)
  assert.equal(await getStore().getAnalysis(aid), null)
  const noHeader = await preview.POST(new NextRequest('http://localhost/api/photo-analysis/preview', { method: 'POST', body: png(1) as BodyInit }))
  assert.equal(noHeader.status, 400)
})

test('analysis is saved with status, model, timestamps, consent time and an unreviewed human-review state', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  const res = await analyze(rep, aid)
  assert.equal(res.status, 200)
  const { analysis: a, reused } = await res.json()
  assert.equal(reused, false)
  assert.equal(a.analysis_status, 'completed')
  assert.equal(a.result.model_version, 'mock-vision-1')
  assert.equal(a.result.review_required, true)
  const row = (await getStore().listAnalyses(rep.id))[0]
  assert.equal(row.attachment_id, aid)
  assert.equal(row.review_status, 'unreviewed')
  assert.equal(row.model_provider, 'anthropic')
  assert.ok(row.consent_at && row.analyzed_at)
  assert.equal(row.result!.detected_incident_types[0], 'flooding')
})

test('idempotent: repeating the call does not call the model or create a second record; force re-analyses and resets review', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  await analyze(rep, aid)
  const again = await (await analyze(rep, aid)).json()
  assert.equal(again.reused, true)
  assert.equal(analyzerCalls, 1)
  assert.equal((await getStore().listAnalyses(rep.id)).length, 1)

  await getStore().saveAnalysis({ attachment_id: aid, report_id: rep.id, review_status: 'confirmed', reviewed_by: RESPONDER })
  plan = () => callFor('fire')
  const forced = await (await analyze(rep, aid, { consent: true, force: true })).json()
  assert.equal(forced.reused, false)
  assert.equal(forced.analysis.result.detected_incident_types[0], 'fire')
  const row = await getStore().getAnalysis(aid)
  assert.equal(row!.review_status, 'unreviewed') // an earlier human check does not carry over to a new reading
  assert.equal(row!.attempts, 2)
  assert.equal((await getStore().listAnalyses(rep.id)).length, 1)
})

test('access control: only the owner (or the creating device) can analyse or read; others are refused', async () => {
  const anon = await makeReport()
  const aidAnon = await addPhoto(anon, 1)
  assert.equal((await analyze(anon, aidAnon, { consent: true }, { 'x-report-client-id': 'someone-elses-device' })).status, 403)

  const owned = await makeReport(CITIZEN)
  const aid = await addPhoto(owned, 2, CITIZEN)
  assert.equal((await analyze(owned, aid)).status, 401) // no sign-in
  assert.equal((await analyze(owned, aid, { consent: true }, auth(`demo:${NEIGHBOUR}`))).status, 403)
  assert.equal(analyzerCalls, 0)
  assert.equal((await analyze(owned, aid, { consent: true }, auth(`demo:${CITIZEN}`))).status, 200)

  const read = (token?: string, client?: string) => analysis.GET(new NextRequest(`http://localhost/x`, { headers: { ...auth(token), ...(client ? { 'x-report-client-id': client } : {}) } }), ctx(owned.id, aid))
  assert.equal((await read()).status, 401)
  assert.equal((await read(`demo:${NEIGHBOUR}`)).status, 403)
  const mine = await (await read(`demo:${CITIZEN}`)).json()
  assert.equal(mine.analysis.analysis_status, 'completed')
  assert.equal('reviewed_by' in mine.analysis, false) // reporters do not get reviewer details
})

test('staff dashboard data: responders see every photo with unverified flag, review state and a combined summary; citizens and visitors cannot', async () => {
  const rep = await makeReport()
  const kinds = ['flood', 'none', 'fire'] as const
  const ids: string[] = []
  let i = 0
  plan = (b) => callFor(kinds[b[8] - 1])
  for (const k of kinds) {
    void k
    const id = await addPhoto(rep, ++i)
    ids.push(id)
    await analyze(rep, id)
  }
  const get = (t?: string) => analyses.GET(new NextRequest('http://localhost/x', { headers: auth(t) }), { params: { id: rep.id } })
  assert.equal((await get()).status, 401)
  assert.equal((await get(`demo:${CITIZEN}`)).status, 403)
  const res = await get(`demo:${RESPONDER}`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.unverified, true)
  assert.equal(body.photos.length, 3)
  assert.equal(body.photos[0].analysis.review_status, 'unreviewed')
  assert.equal(body.photos[0].analysis.verified, false)
  assert.ok(body.combined.conflicts.length >= 2)
  assert.equal(body.combined.photo_count, 3)
})

test('human review: staff confirm/reject; reporters cannot review; reporters can record what they did with suggestions', async () => {
  const rep = await makeReport(CITIZEN)
  const aid = await addPhoto(rep, 1, CITIZEN)
  await analyze(rep, aid, { consent: true }, auth(`demo:${CITIZEN}`))
  const patch = (body: unknown, token?: string) => analysis.PATCH(json('/x', 'PATCH', body, auth(token)), ctx(rep.id, aid))
  assert.equal((await patch({ review_status: 'confirmed' }, `demo:${CITIZEN}`)).status, 403)
  assert.equal((await patch({ review_status: 'confirmed' })).status, 401)
  const ok = await patch({ review_status: 'confirmed', review_note: 'Checked on site' }, `demo:${RESPONDER}`)
  assert.equal(ok.status, 200)
  const row = await getStore().getAnalysis(aid)
  assert.equal(row!.review_status, 'confirmed')
  assert.equal(row!.reviewed_by, RESPONDER)
  assert.equal(row!.review_note, 'Checked on site')
  assert.equal((await patch({ review_status: 'bogus' }, `demo:${RESPONDER}`)).status, 400)
  assert.equal((await patch({ user_action: 'edited' }, `demo:${CITIZEN}`)).status, 200)
  assert.equal((await getStore().getAnalysis(aid))!.user_action, 'edited')
})

test('AI failures never break the report or the photo: failed state, original kept, retry works', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  plan = () => ({ ok: false, state: 'unavailable', reason: 'The AI service took too long to answer.' })
  const res = await analyze(rep, aid)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.analysis.analysis_status, 'failed')
  assert.match(body.analysis.failure_reason, /too long/)
  assert.equal((await getStore().listAttachments(rep.id)).length, 1) // photo is still there
  assert.ok(await getStore().readAttachment((await getStore().listAttachments(rep.id))[0])) // and readable
  assert.ok(await getStore().getReport(rep.id))

  plan = () => ({ ok: false, state: 'invalid_output', reason: 'The AI answer did not match the expected format, so it was discarded.' })
  assert.equal((await (await analyze(rep, aid)).json()).analysis.analysis_status, 'failed') // failed rows are retried automatically
  plan = () => callFor('flood')
  const retry = await (await analyze(rep, aid)).json()
  assert.equal(retry.analysis.analysis_status, 'completed')
  assert.equal((await getStore().listAnalyses(rep.id)).length, 1)
})

test('an exception inside analysis is contained and recorded as failed', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  plan = () => {
    throw new Error('boom')
  }
  const orig = console.error
  console.error = () => undefined
  try {
    const res = await analyze(rep, aid)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).analysis.analysis_status, 'failed')
  } finally {
    console.error = orig
  }
})

test('analysis is advisory: it never changes the report, priority score, status or history', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  plan = () => callFor('structural')
  const before = JSON.stringify([await getStore().getReport(rep.id), await getStore().listEvents(rep.id)])
  await analyze(rep, aid)
  assert.equal(JSON.stringify([await getStore().getReport(rep.id), await getStore().listEvents(rep.id)]), before)
})

test('preview: validates files on the server (empty, oversized, wrong type), rate limits, and stores nothing', async () => {
  const post = (body: Uint8Array | string, headers: Record<string, string> = {}) =>
    preview.POST(new NextRequest('http://localhost/api/photo-analysis/preview', { method: 'POST', body: body as BodyInit, headers: { 'x-analysis-consent': 'yes', ...headers } }))
  assert.equal((await post(new Uint8Array())).status, 400)
  assert.equal((await post('GIF89a not a supported photo')).status, 415)
  assert.equal((await post(new Uint8Array([0xff, 0xd8, 0xff, ...new Array(6 * 1024 * 1024).fill(1)]))).status, 413)
  assert.equal((await post(png(1), { authorization: 'Bearer expired-token' })).status, 401)
  assert.equal(analyzerCalls, 0)

  const ok = await post(png(1))
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.analysis.analysis_status, 'completed')
  assert.equal(body.analysis.preview, true)
  assert.equal((await getStore().listAnalyses('any')).length, 0)

  plan = () => ({ ok: false, state: 'not_configured', reason: 'Photo analysis is not set up on this server.' })
  const nc = await (await post(png(2))).json()
  assert.equal(nc.analysis.analysis_status, 'failed')
  assert.equal(nc.analysis.state, 'not_configured')

  let last = 200
  for (let i = 0; i < 14 && last !== 429; i++) last = (await post(png(3 + i))).status
  assert.equal(last, 429)
})

test('the same photo is sent to the model once (preview then stored copy share a short-lived result)', async () => {
  const preview1 = await preview.POST(new NextRequest('http://localhost/api/photo-analysis/preview', { method: 'POST', body: png(7) as BodyInit, headers: { 'x-analysis-consent': 'yes' } }))
  assert.equal(preview1.status, 200)
  const rep = await makeReport()
  const aid = await addPhoto(rep, 7)
  await analyze(rep, aid)
  assert.equal(analyzerCalls, 1)
})

test('private photos: staff get 5-minute signed links; links are tamper-proof and expire; others get nothing', async () => {
  const rep = await makeReport()
  const aid = await addPhoto(rep, 1)
  const mint = (t?: string) => attachment.POST(new NextRequest('http://localhost/x', { method: 'POST', headers: auth(t) }), ctx(rep.id, aid))
  assert.equal((await mint()).status, 401)
  assert.equal((await mint(`demo:${CITIZEN}`)).status, 403)
  const signed = await (await mint(`demo:${RESPONDER}`)).json()
  assert.match(signed.url, /exp=\d+&sig=[0-9a-f]{64}/)
  assert.ok(Date.parse(signed.expires_at) - Date.now() <= 5 * 60_000 + 2000)

  const open = (url: string) => attachment.GET(new NextRequest(`http://localhost${url}`), ctx(rep.id, aid))
  const good = await open(signed.url)
  assert.equal(good.status, 200)
  assert.equal(good.headers.get('cache-control'), 'private, no-store')
  assert.equal((await open(signed.url.replace(/sig=./, 'sig=0'))).status, 401)
  assert.equal((await open(`/api/reports/${rep.id}/attachments/${aid}`)).status, 401) // bare URL: not public
  const other = signPhotoUrl(rep.id, 'some-other-photo')
  assert.equal((await open(other.url)).status, 401) // a link for one photo opens no other photo
  const now = Date.now()
  const exp = signed.url.match(/exp=(\d+)/)![1]
  const sig = signed.url.match(/sig=([0-9a-f]+)/)![1]
  assert.equal(verifyPhotoSignature(rep.id, aid, exp, sig, now), true)
  assert.equal(verifyPhotoSignature(rep.id, aid, exp, sig, now + 6 * 60_000), false) // expired
})

test('a report with no photos, or with analysis never run, is submitted exactly as before', async () => {
  const res = await reports.POST(json('/api/reports', 'POST', { client_id: 'plain-report-1', location_source: 'manual', location_address: 'near the bridge', dangers: ['fire'] }))
  assert.equal(res.status, 201)
  assert.equal(analyzerCalls, 0)
})

test('model scenarios stored per photo keep their own results (no cross-contamination)', async () => {
  const rep = await makeReport()
  const kinds = ['flood', 'blockedRoad'] as const
  plan = (b) => callFor(kinds[b[8] - 1])
  const a1 = await addPhoto(rep, 1)
  const a2 = await addPhoto(rep, 2)
  await analyze(rep, a1)
  await analyze(rep, a2)
  assert.equal((await getStore().getAnalysis(a1))!.result!.suggested_report_title, SCENARIOS.flood.suggested_report_title)
  assert.equal((await getStore().getAnalysis(a2))!.result!.suggested_report_title, SCENARIOS.blockedRoad.suggested_report_title)
})
