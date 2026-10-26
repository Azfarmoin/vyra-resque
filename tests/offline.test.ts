// Offline-first engine tests. IndexedDB is faked in memory and the server is a mock `fetch`: no real network.
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { closeDbForTests, DB_NAME } from '../src/lib/offline/db'
import {
  addAttachment, beginEdit, deleteAllUnsynced, deleteLocalReport, getLastSyncAt, getReport, listAttachments, listReports,
  loadActiveDraft, queueReport, removeAttachment, retryReport, saveDraft, summarize, generateId,
} from '../src/lib/offline/store'
import { computeBackoffMs, syncAll, BACKOFF_CAP_MS, type SyncDeps } from '../src/lib/offline/sync'
import { ImageRejected, prepareImage } from '../src/lib/offline/images'
import { ANON, LocalSaveError } from '../src/lib/offline/types'
import type { Identity } from '../src/lib/offline/identity'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5])
const jpeg = (name = 'a.jpg') => Object.assign(new Blob([JPEG], { type: 'image/jpeg' }), { name })
const A: Identity = { owner: 'user-a', userId: 'user-a', email: 'a@x', token: 'tok-a' }
const B: Identity = { owner: 'user-b', userId: 'user-b', email: 'b@x', token: 'tok-b' }
const ANONYMOUS: Identity = { owner: ANON, userId: null, email: null, token: null }

beforeEach(async () => {
  await closeDbForTests()
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME)
    r.onsuccess = () => res()
    r.onerror = () => rej(r.error)
  })
})

// ---- a tiny fake VYRA server ------------------------------------------------------------------
interface Server {
  reports: Map<string, { id: string; owner: string | null }>
  photos: Map<string, string>
  calls: { url: string; method: string; auth: string | null }[]
  mode: 'ok' | 'down' | 'unauthorized' | 'error500' | 'reject400' | 'photo415' | 'lose-response-once' | 'photo-down'
}
function makeServer() {
  const s: Server = { reports: new Map(), photos: new Map(), calls: [], mode: 'ok' }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    s.calls.push({ url, method: init?.method || 'GET', auth: headers.get('authorization') })
    if (s.mode === 'down') throw new TypeError('Failed to fetch')
    if (s.mode === 'unauthorized') return json(401, { error: 'Your session has expired', code: 'auth_required' })
    if (s.mode === 'error500') return json(503, { error: 'Server busy' })
    if (url === '/api/reports') {
      if (s.mode === 'reject400') return json(400, { error: 'Validation failed', details: [{ path: 'dangers', message: 'bad' }] })
      const key = headers.get('idempotency-key')!
      const existing = s.reports.get(key)
      if (existing) return json(200, { report: { id: existing.id, status: 'pending' }, duplicate: true })
      const id = `srv-${s.reports.size + 1}`
      s.reports.set(key, { id, owner: headers.get('authorization') })
      if (s.mode === 'lose-response-once') {
        s.mode = 'ok'
        throw new TypeError('connection reset')
      }
      return json(201, { report: { id, status: 'pending' }, duplicate: false })
    }
    const m = url.match(/^\/api\/reports\/([^/]+)\/attachments$/)
    if (m) {
      if (s.mode === 'photo415') return json(415, { error: 'Only JPEG, PNG or WebP photos are accepted' })
      if (s.mode === 'photo-down') throw new TypeError('Failed to fetch')
      const att = headers.get('x-attachment-id')!
      const dup = s.photos.has(att)
      s.photos.set(att, m[1])
      return json(dup ? 200 : 201, { attachment: { id: `srv-${att}` }, duplicate: dup })
    }
    return json(404, { error: 'nope' })
  }
  return { s, fetchMock }
}

function deps(over: Partial<SyncDeps> & { server: ReturnType<typeof makeServer>; identity?: Identity; time?: { t: number } }): SyncDeps {
  const time = over.time ?? { t: Date.parse('2026-10-24T10:00:00Z') }
  return {
    fetch: over.server.fetchMock,
    getIdentity: async () => over.identity ?? ANONYMOUS,
    now: () => time.t,
    random: () => 0.5,
    isOnline: over.isOnline ?? (() => true),
  }
}

const payload = (extra: Record<string, unknown> = {}) => ({ location_source: 'manual', location_address: 'near the blue gate', dangers: ['rising_water'], ...extra })
async function queue(owner = ANON, extra: Record<string, unknown> = {}, id = generateId()) {
  return queueReport({ client_id: id, owner, form: { a: 1 }, payload: payload(extra) })
}

// ---- tests -----------------------------------------------------------------------------------

test('airplane mode: report is saved on the device, nothing is sent, and it is never called synced', async () => {
  const server = makeServer()
  const r = await queue()
  assert.equal(r.status, 'saved_locally')
  const summary = await syncAll({}, deps({ server, isOnline: () => false }))
  assert.equal(summary.skipped, 'offline')
  assert.equal(server.s.calls.length, 0)
  const stored = await getReport(r.client_id)
  assert.equal(stored!.status, 'saved_locally')
  assert.equal(stored!.server_id, null)
  assert.equal(await getLastSyncAt(), null)
})

test('drafts survive a browser restart', async () => {
  const id = generateId()
  await saveDraft({ client_id: id, owner: ANON, form: { dangerDetails: 'water rising' }, step: 2 })
  await closeDbForTests() // simulate closing the browser: the connection is gone, the data is not
  const draft = await loadActiveDraft(ANON)
  assert.equal(draft!.client_id, id)
  assert.deepEqual(draft!.form, { dangerDetails: 'water rising' })
  assert.equal(draft!.step, 2)
})

test('saving a draft never downgrades a queued report', async () => {
  const r = await queue()
  await saveDraft({ client_id: r.client_id, owner: ANON, form: { late: 'autosave' }, step: 4 })
  assert.equal((await getReport(r.client_id))!.status, 'saved_locally')
})

test('photos are stored as blobs, survive a restart and are released after the server confirms them', async () => {
  const server = makeServer()
  const r = await queue()
  await addAttachment(r.client_id, ANON, jpeg())
  await closeDbForTests()
  const [att] = await listAttachments(r.client_id)
  assert.equal(att.status, 'local')
  assert.deepEqual(new Uint8Array(await att.blob!.arrayBuffer()), JPEG)
  assert.equal(summarize(await listReports(ANON), await listAttachments(r.client_id)).pendingImages, 1)

  await syncAll({}, deps({ server }))
  const [done] = await listAttachments(r.client_id)
  assert.equal(done.status, 'uploaded')
  assert.equal(done.blob, null)
  assert.equal((await getReport(r.client_id))!.status, 'synced')
})

test('image validation: rejects non-images by content, empty and oversized files; shrinks large ones', async () => {
  await assert.rejects(prepareImage(new Blob(['GIF89a....'], { type: 'image/jpeg' })), ImageRejected) // lying type
  await assert.rejects(prepareImage(new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])])), /HEIC/)
  await assert.rejects(prepareImage(new Blob([])), ImageRejected)
  const big = new Blob([JPEG, new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' })
  const shrunk = await prepareImage(big, async () => ({ blob: new Blob([JPEG], { type: 'image/jpeg' }), width: 1600, height: 900 }))
  assert.equal(shrunk.blob.size, JPEG.length)
  assert.equal(shrunk.width, 1600)
  // 6 MB that cannot be shrunk is refused rather than stored
  const huge = new Blob([JPEG, new Uint8Array(6 * 1024 * 1024)], { type: 'image/jpeg' })
  await assert.rejects(prepareImage(huge, async () => null), /over 5 MB/)
})

test('multiple pending reports sync oldest first and update the last-sync time only on success', async () => {
  const server = makeServer()
  const time = { t: Date.parse('2026-10-24T10:00:00Z') }
  const one = await queue(ANON, { location_address: 'one' })
  await new Promise((r) => setTimeout(r, 5))
  const two = await queue(ANON, { location_address: 'two' })
  const summary = await syncAll({}, deps({ server, time }))
  assert.equal(summary.synced, 2)
  assert.deepEqual([...server.s.reports.keys()], [one.client_id, two.client_id])
  assert.equal(await getLastSyncAt(), new Date(time.t).toISOString())
  const stored = await getReport(one.client_id)
  assert.equal(stored!.status, 'synced')
  assert.equal(stored!.server_id, 'srv-1')
})

test('connection drops mid-sync: nothing is lost, backoff is scheduled, and resuming never re-sends the report', async () => {
  const server = makeServer()
  const time = { t: Date.parse('2026-10-24T10:00:00Z') }
  const ok = await queue(ANON, { location_address: 'ok' })
  await new Promise((r) => setTimeout(r, 5))
  const flaky = await queue(ANON, { location_address: 'flaky' })
  await addAttachment(flaky.client_id, ANON, jpeg('1.jpg'))
  await addAttachment(flaky.client_id, ANON, jpeg('2.jpg'))

  server.s.mode = 'photo-down' // report POSTs work, photo uploads fail with a network error
  const first = await syncAll({}, deps({ server, time }))
  assert.equal(first.synced, 1)
  assert.equal(first.waiting, 1)
  const waiting = (await getReport(flaky.client_id))!
  assert.equal(waiting.status, 'waiting')
  assert.equal(waiting.server_id, 'srv-2') // confirmed report ID is remembered
  assert.equal(waiting.attempts, 1)
  assert.ok(Date.parse(waiting.next_attempt_at!) > time.t)
  assert.equal((await listAttachments(flaky.client_id)).every((a) => a.blob && a.status === 'local'), true)
  assert.equal((await getReport(ok.client_id))!.status, 'synced')

  // Too early: the automatic run respects the backoff timer.
  server.s.mode = 'ok'
  const reportPosts = () => server.s.calls.filter((c) => c.url === '/api/reports').length
  const before = server.s.calls.length
  await syncAll({}, deps({ server, time }))
  assert.equal(server.s.calls.length, before)

  // After the wait it resumes with the photos only.
  time.t += BACKOFF_CAP_MS + 1
  const postsBefore = reportPosts()
  const second = await syncAll({}, deps({ server, time }))
  assert.equal(second.synced, 1)
  assert.equal(reportPosts(), postsBefore) // report was not POSTed again
  assert.equal(server.s.photos.size, 2)
  assert.equal((await getReport(flaky.client_id))!.status, 'synced')
})

test('"Sync now" (force) ignores the backoff timer', async () => {
  const server = makeServer()
  const r = await queue()
  server.s.mode = 'down'
  await syncAll({}, deps({ server }))
  assert.equal((await getReport(r.client_id))!.status, 'waiting')
  server.s.mode = 'ok'
  assert.equal((await syncAll({}, deps({ server }))).synced, 0) // still inside the backoff window
  assert.equal((await syncAll({ force: true }, deps({ server }))).synced, 1)
})

test('duplicate sync attempts at the same moment send the report once', async () => {
  const server = makeServer()
  await queue()
  const d = deps({ server })
  const results = await Promise.all([syncAll({}, d), syncAll({}, d), syncAll({ force: true }, d)])
  assert.equal(server.s.calls.filter((c) => c.url === '/api/reports').length, 1)
  assert.equal(results.reduce((n, r) => n + r.synced, 0), 1)
})

test('lost response: the server saved it but the device never heard; the retry is recognised, not duplicated', async () => {
  const server = makeServer()
  const r = await queue()
  server.s.mode = 'lose-response-once'
  await syncAll({}, deps({ server }))
  assert.equal((await getReport(r.client_id))!.status, 'waiting')
  assert.equal(server.s.reports.size, 1)
  await syncAll({ force: true }, deps({ server }))
  const stored = (await getReport(r.client_id))!
  assert.equal(stored.status, 'synced')
  assert.equal(stored.duplicate, true)
  assert.equal(server.s.reports.size, 1)
})

test('expired session keeps the report and asks for sign-in instead of failing or losing it', async () => {
  const server = makeServer()
  const r = await queue(A.owner)
  server.s.mode = 'unauthorized'
  const first = await syncAll({}, deps({ server, identity: A }))
  assert.equal(first.needsAuth, 1)
  const stored = (await getReport(r.client_id))!
  assert.equal(stored.status, 'needs_auth')
  assert.equal(stored.attempts, 0)
  assert.ok(stored.payload)
  server.s.mode = 'ok'
  assert.equal((await syncAll({}, deps({ server, identity: A }))).synced, 1)
})

test('a report is never sent under a different account, and signed-out devices wait for sign-in', async () => {
  const server = makeServer()
  const r = await queue(A.owner)
  assert.equal((await syncAll({}, deps({ server, identity: B }))).needsAuth, 1)
  assert.equal((await syncAll({}, deps({ server, identity: ANONYMOUS }))).needsAuth, 1)
  assert.equal(server.s.calls.length, 0)
  assert.equal((await getReport(r.client_id))!.status, 'needs_auth')
  assert.equal((await syncAll({}, deps({ server, identity: A }))).synced, 1)
  assert.equal(server.s.calls[0].auth, 'Bearer tok-a')
})

test('anonymous reports stay anonymous even when someone signs in later', async () => {
  const server = makeServer()
  await queue(ANON)
  await syncAll({}, deps({ server, identity: A }))
  assert.equal(server.s.calls[0].auth, null)
})

test('multiple accounts on one device only see their own reports', async () => {
  await queue(A.owner, { location_address: 'a1' })
  await queue(B.owner, { location_address: 'b1' })
  await queue(ANON, { location_address: 'anon1' })
  await saveDraft({ client_id: generateId(), owner: A.owner, form: {}, step: 0 })
  assert.equal((await listReports(A.owner)).length, 2)
  assert.equal((await listReports(B.owner)).length, 1)
  assert.equal((await listReports(ANON)).length, 1)
  assert.equal(await deleteAllUnsynced(A.owner), 2)
  assert.equal((await listReports(B.owner)).length, 1)
})

test('storage quota exhaustion is reported honestly and does not corrupt what is already saved', async () => {
  const r = await queue()
  await addAttachment(r.client_id, ANON, jpeg('ok.jpg'))
  const proto = (globalThis as unknown as { IDBObjectStore: { prototype: { put: (...a: unknown[]) => unknown } } }).IDBObjectStore.prototype
  const realPut = proto.put
  proto.put = function () {
    throw new DOMException('quota', 'QuotaExceededError')
  }
  try {
    await assert.rejects(addAttachment(r.client_id, ANON, jpeg('full.jpg')), (e: unknown) => e instanceof LocalSaveError && e.quota)
    await assert.rejects(queueReport({ client_id: generateId(), owner: ANON, form: {}, payload: payload() }), (e: unknown) => e instanceof LocalSaveError && /out of storage/.test(e.message))
  } finally {
    proto.put = realPut
  }
  assert.equal((await listAttachments(r.client_id)).length, 1)
  assert.equal((await listReports(ANON)).length, 1)
})

test('rejected photo: the report is received but marked failed with retry; retry does not re-send the report', async () => {
  const server = makeServer()
  const r = await queue()
  await addAttachment(r.client_id, ANON, jpeg())
  server.s.mode = 'photo415'
  const first = await syncAll({}, deps({ server }))
  assert.equal(first.failed, 1)
  const failed = (await getReport(r.client_id))!
  assert.equal(failed.status, 'failed')
  assert.equal(failed.server_id, 'srv-1')
  assert.match(failed.last_error!, /1 photo/)
  assert.equal((await listAttachments(r.client_id))[0].status, 'failed')

  server.s.mode = 'ok'
  await retryReport(r.client_id)
  await syncAll({}, deps({ server }))
  assert.equal((await getReport(r.client_id))!.status, 'synced')
  assert.equal(server.s.calls.filter((c) => c.url === '/api/reports').length, 1)
})

test('removing the failed photo lets the report finish', async () => {
  const server = makeServer()
  const r = await queue()
  const att = await addAttachment(r.client_id, ANON, jpeg())
  server.s.mode = 'photo415'
  await syncAll({}, deps({ server }))
  await removeAttachment(att.id)
  server.s.mode = 'ok'
  await retryReport(r.client_id)
  assert.equal((await syncAll({}, deps({ server }))).synced, 1)
})

test('server rejection (400) becomes "failed" with the reason, and the data is kept', async () => {
  const server = makeServer()
  const r = await queue()
  server.s.mode = 'reject400'
  assert.equal((await syncAll({}, deps({ server }))).failed, 1)
  const stored = (await getReport(r.client_id))!
  assert.equal(stored.status, 'failed')
  assert.match(stored.last_error!, /dangers: bad/)
  assert.ok(stored.payload)
})

test('5xx errors retry with backoff instead of failing', async () => {
  const server = makeServer()
  const r = await queue()
  server.s.mode = 'error500'
  await syncAll({}, deps({ server }))
  assert.equal((await getReport(r.client_id))!.status, 'waiting')
})

test('editing an unsent report pauses syncing; a report the server already has cannot be edited', async () => {
  const server = makeServer()
  const r = await queue()
  const draft = await beginEdit(r.client_id)
  assert.equal(draft!.status, 'draft')
  assert.equal((await syncAll({}, deps({ server }))).synced, 0)
  assert.equal(server.s.calls.length, 0)
  await queueReport({ client_id: r.client_id, owner: ANON, form: { edited: true }, payload: payload({ location_address: 'edited' }) })
  assert.equal((await syncAll({}, deps({ server }))).synced, 1)
  assert.equal(await beginEdit(r.client_id), null)
})

test('deleting a local report also deletes its photos', async () => {
  const r = await queue()
  await addAttachment(r.client_id, ANON, jpeg())
  await deleteLocalReport(r.client_id)
  assert.equal(await getReport(r.client_id), undefined)
  assert.equal((await listAttachments(r.client_id)).length, 0)
})

test('backoff grows exponentially, is jittered, and is capped', () => {
  assert.equal(computeBackoffMs(0, () => 0), 1000)
  assert.equal(computeBackoffMs(0, () => 1), 5000)
  assert.equal(computeBackoffMs(3, () => 1), 40000)
  assert.equal(computeBackoffMs(30, () => 1), BACKOFF_CAP_MS)
  for (let i = 0; i < 20; i++) {
    const v = computeBackoffMs(i)
    assert.ok(v >= 1000 && v <= BACKOFF_CAP_MS)
  }
})

test('ids are unique', () => {
  assert.equal(new Set(Array.from({ length: 500 }, generateId)).size, 500)
})
