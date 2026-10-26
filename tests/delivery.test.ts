// Multi-channel delivery tests. IndexedDB is faked, the server is a mock fetch, and hardware is a fake line transport.
import 'fake-indexeddb/auto'
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { closeDbForTests, DB_NAME, getDb } from '../src/lib/offline/db'
import { getReport, queueReport, generateId } from '../src/lib/offline/store'
import { ANON } from '../src/lib/offline/types'
import { clientIdToIncident, crc16, decodeCompact, encodeCompact, incidentToClientId } from '../src/lib/delivery/compact'
import { deliverPending, deliverReport, markSmsHandedOff, refreshOperatorAcks, resetStaleSending } from '../src/lib/delivery/orchestrator'
import { getDelivery, patchDelivery, recordAckForIncident, setConfig } from '../src/lib/delivery/store'
import { deliveryView } from '../src/lib/delivery/status'
import { adopt, disconnectBridge, createBridgeAdapter } from '../src/lib/delivery/adapters/bridge'
import type { LineTransport } from '../src/lib/delivery/adapters/transports'
import type { ChannelAdapter, DeliveryDeps } from '../src/lib/delivery/adapters/types'
import type { ChannelId } from '../src/lib/delivery/types'

beforeEach(async () => {
  await closeDbForTests()
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME)
    r.onsuccess = () => res()
    r.onerror = () => rej(r.error)
  })
})

const payloadFor = (id: string) => ({
  client_id: id, reporter_id: null, location_lat: 24.8556, location_lng: 67.0228, location_source: 'gps', location_address: '',
  incident_time: '2026-10-26T08:00:00.000Z', reporter_urgency: 'critical', people_count: 4, dangers: ['trapped', 'rising_water'],
  injury_severity: 'serious', medical_need_types: ['oxygen'], can_evacuate: 'no', contact_phone: '+92 300 1234567',
})
async function saved() {
  const id = generateId()
  await queueReport({ client_id: id, owner: ANON, form: {}, payload: payloadFor(id) })
  return id
}
const view = async (id: string) => deliveryView((await getReport(id))!, await getDelivery(id))

const unavailable = (id: ChannelId): ChannelAdapter => ({ id, availability: async () => ({ available: false, reason: `${id} down` }), send: async () => ({ outcome: 'unavailable', detail: 'x' }) })
const only = (over: Partial<Record<ChannelId, ChannelAdapter>>): Partial<Record<ChannelId, ChannelAdapter>> => ({
  radio: unavailable('radio'), sms: unavailable('sms'), bluetooth: unavailable('bluetooth'), internet: unavailable('internet'), manual: unavailable('manual'), ...over,
})
const deps = (adapters: Partial<Record<ChannelId, ChannelAdapter>>, extra: Partial<DeliveryDeps> = {}): Partial<DeliveryDeps> => ({ adapters, ...extra })

// ---------- compact message ----------
test('compact message: round trip, ASCII, within one SMS, CRC protected', () => {
  const id = generateId()
  const { text, length } = encodeCompact(payloadFor(id))
  assert.ok(length <= 160, `length ${length}`)
  assert.match(text, /^[\x20-\x7e]+$/)
  const d = decodeCompact(text)
  assert.ok(d.ok)
  if (!d.ok) return
  assert.equal(d.value.clientId, id)
  assert.deepEqual(d.value.dangers, ['trapped', 'rising_water'])
  assert.equal(d.value.people, 4)
  assert.equal(d.value.urgency, 'critical')
  assert.equal(d.value.injury, 'serious')
  assert.equal(d.value.lat, 24.8556)
  assert.equal(d.value.incidentTime, '2026-10-26T08:00:00.000Z') // the ORIGINAL time survives
  assert.equal(d.value.callback, '+923001234567')
  assert.ok(d.value.resources.includes('SAR') && d.value.resources.includes('BOAT') && d.value.resources.includes('MED') && d.value.resources.includes('EVAC'))
})
test('compact message: damaged or foreign text is rejected, never guessed', () => {
  const { text } = encodeCompact(payloadFor(generateId()))
  const bad = text.replace('|4|', '|9|')
  assert.equal(decodeCompact(bad).ok, false)
  assert.equal(decodeCompact('hello').ok, false)
  assert.equal(decodeCompact(text.slice(0, -3)).ok, false)
  assert.equal(crc16('123456789'), '29B1') // CRC-16/CCITT-FALSE check value
})
test('compact message: no coordinates -> short place text, none invented; ids round-trip', () => {
  const id = generateId()
  const { text } = encodeCompact({ client_id: id, dangers: ['fire'], location_address: 'Near Café Clock Tower | Saddar' })
  const d = decodeCompact(text)
  assert.ok(d.ok && d.value.lat === null && d.value.place === 'Near Cafe Clock Tower Saddar')
  assert.equal(incidentToClientId(clientIdToIncident(id)), id)
  assert.equal(incidentToClientId(clientIdToIncident('custom-id-1234')), 'custom-id-1234')
})

// ---------- save first, honest status ----------
test('with every channel unavailable the report is kept, queued, and clearly NOT delivered', async () => {
  const id = await saved()
  const rec = await deliverReport(id, { deps: deps(only({})) })
  assert.equal(rec?.stage, 'failed_retry')
  const v = await view(id)
  assert.equal(v?.label, 'Delivery Failed — Retry Available')
  assert.equal(v?.delivered, false)
  assert.match(v!.detail, /NOT delivered/)
  const r = await getReport(id)
  assert.equal(r?.status, 'saved_locally') // still queued locally
  assert.ok(rec?.compact && rec.next_retry_at)
})
test('saved, queued, transmitted and SMS hand-off are never "delivered"', async () => {
  const id = await saved()
  assert.equal((await view(id))?.label, 'Saved on Device')
  assert.equal((await view(id))?.delivered, false)

  const radio: ChannelAdapter = { id: 'radio', availability: async () => ({ available: true, reason: null }), send: async () => ({ outcome: 'transmitted', detail: 'on the air, no ack' }) }
  await deliverReport(id, { deps: deps(only({ radio })) })
  let v = await view(id)
  assert.equal(v?.stage, 'sending_radio')
  assert.equal(v?.label, 'Sending via Radio')
  assert.equal(v?.delivered, false)

  await markSmsHandedOff(id)
  v = await view(id)
  assert.equal(v?.stage, 'sending_sms')
  assert.equal(v?.delivered, false)
  assert.match(v!.detail, /NOT confirmed delivered/)
})
test('a verified radio acknowledgement flips the status; an operator acknowledgement comes after, and never goes backwards', async () => {
  const id = await saved()
  const radio: ChannelAdapter = { id: 'radio', availability: async () => ({ available: true, reason: null }), send: async () => ({ outcome: 'transmitted', detail: 'sent' }) }
  await deliverReport(id, { deps: deps(only({ radio })) })
  const incident = clientIdToIncident(id)
  await recordAckForIncident(incident, { kind: 'gateway', via: 'radio' })
  let v = await view(id)
  assert.equal(v?.label, 'Received by Gateway')
  assert.equal(v?.delivered, true)
  assert.match(v!.detail, /full report and photos will upload/)

  await recordAckForIncident(incident, { kind: 'operator', via: 'radio' })
  assert.equal((await view(id))?.label, 'Acknowledged by Rescue Operator')
  // a later failed retry must not downgrade it
  await deliverReport(id, { force: true, deps: deps(only({})) })
  assert.equal((await view(id))?.label, 'Acknowledged by Rescue Operator')
  // acknowledgements for incidents this device does not own are ignored
  assert.equal(await recordAckForIncident(clientIdToIncident(generateId()), { kind: 'gateway', via: 'radio' }), null)
})

// ---------- ordering, fallbacks, no duplicates ----------
test('channel priority is configurable and every available channel is tried in that order', async () => {
  const id = await saved()
  const calls: string[] = []
  const spy = (ch: ChannelId): ChannelAdapter => ({ id: ch, availability: async () => ({ available: true, reason: null }), send: async () => { calls.push(ch); return { outcome: 'failed', detail: 'no' } } })
  await deliverReport(id, { deps: deps(only({ radio: spy('radio'), sms: spy('sms'), bluetooth: spy('bluetooth'), internet: spy('internet') })) })
  assert.deepEqual(calls, ['radio', 'sms', 'bluetooth', 'internet'])
  calls.length = 0
  await setConfig({ order: ['internet', 'bluetooth', 'sms', 'radio', 'manual'], enabled: { radio: false, sms: true, bluetooth: true, internet: true, manual: true } })
  await deliverReport(id, { force: true, deps: deps(only({ radio: spy('radio'), sms: spy('sms'), bluetooth: spy('bluetooth'), internet: spy('internet') })) })
  assert.deepEqual(calls, ['internet', 'bluetooth', 'sms']) // disabled radio skipped
})

function fakeServer() {
  const s = { reports: new Map<string, string>(), photos: 0, calls: 0, down: false, onCall: undefined as undefined | (() => Promise<void>) }
  const json = (st: number, b: unknown) => new Response(JSON.stringify(b), { status: st, headers: { 'content-type': 'application/json' } })
  const fetchMock: typeof fetch = async (input, init) => {
    s.calls++
    if (s.onCall) await s.onCall()
    if (s.down) throw new TypeError('Failed to fetch')
    const url = String(input)
    const h = new Headers(init?.headers)
    if (url === '/api/reports') {
      const key = h.get('idempotency-key')!
      const dup = s.reports.has(key)
      if (!dup) s.reports.set(key, `srv-${s.reports.size + 1}`)
      return json(dup ? 200 : 201, { report: { id: s.reports.get(key), status: 'pending', ingest_channel: dup ? 'radio' : null }, duplicate: dup })
    }
    if (/\/attachments$/.test(url)) { s.photos++; return json(201, { attachment: { id: 'a' } }) }
    return json(404, {})
  }
  return { s, fetchMock }
}
const syncDeps = (f: typeof fetch) => ({ fetch: f, getIdentity: async () => ({ owner: ANON, userId: null, email: null, token: null }) })

test('mobile data alone is enough: the real internet channel sends with no Wi-Fi involved, and labels itself accordingly', async () => {
  const id = await saved()
  const { s, fetchMock } = fakeServer()
  const seen: string[] = []
  s.onCall = async () => { seen.push((await getDelivery(id))!.stage) }
  const rec = await deliverReport(id, { deps: deps({ ...only({}), internet: undefined } as never, { syncDeps: syncDeps(fetchMock), connection: () => 'cellular', isOnline: () => true }) })
  assert.equal(s.reports.size, 1)
  assert.ok(seen.includes('sending_mobile_data'))
  assert.equal(rec?.stage, 'received_gateway')
  const v = await view(id)
  assert.equal(v?.label, 'Received by Gateway')
  assert.equal((await getReport(id))?.status, 'synced')
})
test('the browser online flag is a hint only: offline flag skips quietly, a forced retry still tries', async () => {
  const id = await saved()
  const { s, fetchMock } = fakeServer()
  const d = deps({ ...only({}), internet: undefined } as never, { syncDeps: syncDeps(fetchMock), isOnline: () => false })
  await deliverReport(id, { deps: d })
  assert.equal(s.calls, 0)
  assert.equal((await view(id))?.stage, 'failed_retry')
  await deliverReport(id, { force: true, deps: d })
  assert.equal(s.reports.size, 1)
})
test('retrying never creates a duplicate incident, even when the response is lost', async () => {
  const id = await saved()
  const { s, fetchMock } = fakeServer()
  const d = deps({ ...only({}), internet: undefined } as never, { syncDeps: syncDeps(fetchMock), isOnline: () => true })
  s.down = true
  await deliverReport(id, { force: true, deps: d })
  assert.equal((await view(id))?.stage, 'failed_retry')
  s.down = false
  await deliverReport(id, { force: true, deps: d })
  await deliverReport(id, { force: true, deps: d })
  assert.equal(s.reports.size, 1)
  assert.equal((await getReport(id))?.client_id, id) // original id (and queued time) preserved
})
test('after a radio acknowledgement the full report still goes out over the internet, and the server reports it already had the short copy', async () => {
  const id = await saved()
  const { s, fetchMock } = fakeServer()
  s.reports.set(id, 'srv-0') // the gateway already created the incident from the short radio message
  const radio: ChannelAdapter = { id: 'radio', availability: async () => ({ available: true, reason: null }), send: async () => ({ outcome: 'acked', detail: 'gateway ack' }) }
  const sms: ChannelAdapter = { id: 'sms', availability: async () => ({ available: true, reason: null }), send: async () => { throw new Error('SMS must not be used after an ack') } }
  await deliverReport(id, { deps: deps({ ...only({ radio, sms }), internet: undefined } as never, { syncDeps: syncDeps(fetchMock), isOnline: () => true }) })
  assert.equal(s.reports.size, 1)
  const r = await getReport(id)
  assert.equal(r?.status, 'synced')
  const v = await view(id)
  assert.equal(v?.delivered, true)
  assert.match(v!.detail, /already had/)
})
test('with a radio ack but no internet the short message counts as received and the full report keeps waiting', async () => {
  const id = await saved()
  const radio: ChannelAdapter = { id: 'radio', availability: async () => ({ available: true, reason: null }), send: async () => ({ outcome: 'acked', detail: 'gateway ack' }) }
  await deliverReport(id, { deps: deps(only({ radio })) })
  const rec = await getDelivery(id)
  assert.equal(rec?.stage, 'received_gateway')
  assert.ok(rec?.next_retry_at) // internet retry still scheduled
  assert.equal((await getReport(id))?.status, 'saved_locally')
})
test('SMS without a tap only asks for one; it never claims to have sent anything', async () => {
  const id = await saved()
  const sms: ChannelAdapter = { id: 'sms', availability: async () => ({ available: true, reason: null, needsUserAction: true }), send: async (c) => (c.userGesture ? { outcome: 'handed_off', detail: 'opened' } : { outcome: 'needs_user_action', detail: 'Tap "Send via SMS"' }) }
  await deliverReport(id, { deps: deps(only({ sms })) })
  const rec = await getDelivery(id)
  assert.equal(rec?.channels.sms?.state, 'needs_user_action')
  assert.equal(rec?.stage, 'failed_retry')
})
test('deliverPending retries due reports, honours backoff, and force overrides it', async () => {
  const id = await saved()
  let sends = 0
  const radio: ChannelAdapter = { id: 'radio', availability: async () => ({ available: true, reason: null }), send: async () => { sends++; return { outcome: 'failed', detail: 'no' } } }
  const d = deps(only({ radio }))
  await deliverPending({ deps: d })
  assert.equal(sends, 1)
  await deliverPending({ deps: d }) // next_retry_at is in the future
  assert.equal(sends, 1)
  await deliverPending({ force: true, deps: d })
  assert.equal(sends, 2)
})
test('a "sending" row left by a closed app becomes an honest retry state', async () => {
  const id = await saved()
  await patchDelivery(id, (r) => { r.stage = 'sending_radio'; r.updated_at = '2020-01-01T00:00:00.000Z' })
  // patchDelivery stamps updated_at; age it explicitly
  const db = await getDb()
  const cur = (await db.get('delivery', id))!
  await db.put('delivery', { ...cur, updated_at: new Date(Date.now() - 600_000).toISOString() })
  await resetStaleSending()
  const rec = await getDelivery(id)
  assert.equal(rec?.stage, 'failed_retry')
  assert.match(rec!.detail!, /NOT delivered/)
})
test('operator acknowledgement is read from the server only when it really changed', async () => {
  const id = await saved()
  const { fetchMock } = fakeServer()
  await deliverReport(id, { deps: deps({ ...only({}), internet: undefined } as never, { syncDeps: syncDeps(fetchMock), isOnline: () => true }) })
  const status = (st: string): typeof fetch => async () => new Response(JSON.stringify({ report: { status: st } }), { status: 200 })
  await refreshOperatorAcks(status('pending'))
  assert.equal((await view(id))?.label, 'Received by Gateway')
  await refreshOperatorAcks(status('investigating'))
  assert.equal((await view(id))?.label, 'Acknowledged by Rescue Operator')
})

// ---------- hardware bridge protocol (fake hardware) ----------
function fakeBridge(kind: string, script: (line: string, emit: (l: string) => void) => void) {
  const cbs = new Set<(l: string) => void>()
  let closeCb: () => void = () => undefined
  let open = false
  const emit = (l: string) => setTimeout(() => cbs.forEach((cb) => cb(l)), 0)
  const writes: string[] = []
  const t: LineTransport = {
    kind: 'serial', name: 'Fake LoRa', isOpen: () => open,
    open: async () => { open = true },
    writeLine: async (l) => { writes.push(l); if (l === 'VYRA?') emit(`VYRA-BRIDGE|1|${kind}|dev-1`); else script(l, emit) },
    onLine: (cb) => { cbs.add(cb); return () => { cbs.delete(cb) } },
    onClose: (cb) => { closeCb = cb },
    close: async () => { open = false; closeCb() },
  }
  return { t, writes }
}
const ctxFor = async (id: string, ackWaitMs = 80) => ({
  report: (await getReport(id))!, compact: encodeCompact(payloadFor(id)).text,
  config: { order: ['radio'] as ChannelId[], enabled: { radio: true, sms: true, bluetooth: true, internet: true, manual: true }, smsNumber: '', ackWaitMs }, force: true, userGesture: false, deps: { now: () => Date.now() },
})

test('radio bridge: TX alone is "transmitted", an ACK line is a verified acknowledgement, ERR is a failure', async () => {
  const id = await saved()
  const radio = createBridgeAdapter('radio')
  assert.equal((await radio.availability(await ctxFor(id))).available, false) // nothing connected

  let mode: 'tx' | 'ack' | 'err' | 'silent' = 'tx'
  const { t, writes } = fakeBridge('lora', (line, emit) => {
    const inc = line.split('|')[2]
    if (mode === 'silent') return
    if (mode === 'err') return emit(`ERR|${inc}|duty cycle`)
    emit(`TX|${inc}`)
    if (mode === 'ack') emit(`ACK|${inc}|gw-7`)
  })
  await adopt('radio', t)
  assert.equal((await radio.availability(await ctxFor(id))).available, true)

  let r = await radio.send(await ctxFor(id))
  assert.equal(r.outcome, 'transmitted')
  assert.match(r.detail, /NOT confirmed delivered/)
  assert.ok(writes.some((w) => w.startsWith('MSG|V1|')))

  mode = 'ack'
  r = await radio.send(await ctxFor(id))
  assert.equal(r.outcome, 'acked')
  await new Promise((res) => setTimeout(res, 20))
  assert.equal((await getDelivery(id))?.gateway_ack_via, 'radio') // persisted by the always-on listener

  mode = 'err'
  r = await radio.send(await ctxFor(id))
  assert.equal(r.outcome, 'failed')
  mode = 'silent'
  r = await radio.send(await ctxFor(id))
  assert.equal(r.outcome, 'failed') // no TX confirmation: not claimed as sent
  await disconnectBridge('radio')
})
test('a device that does not speak the VYRA bridge protocol is never sent a report', async () => {
  const writes: string[] = []
  const t: LineTransport = { kind: 'serial', name: 'Random gadget', isOpen: () => true, open: async () => undefined, writeLine: async (l) => { writes.push(l) }, onLine: () => () => undefined, onClose: () => undefined, close: async () => undefined }
  await assert.rejects(adopt('radio', t), /did not answer like a VYRA bridge/)
  assert.deepEqual(writes, ['VYRA?'])
  const { t: relay } = fakeBridge('relay', () => undefined)
  await assert.rejects(adopt('radio', relay), /not a LoRa radio bridge/)
})

// ---------- storage upgrade ----------
test('upgrading an existing version-2 database keeps every unsent report', async () => {
  const old = await openDB(DB_NAME, 2, {
    upgrade(db) {
      const r = db.createObjectStore('reports', { keyPath: 'client_id' })
      r.createIndex('owner', 'owner'); r.createIndex('status', 'status')
      db.createObjectStore('attachments', { keyPath: 'id' }).createIndex('report_id', 'report_id')
      db.createObjectStore('meta', { keyPath: 'key' })
    },
  })
  await old.put('reports', { client_id: 'keep-me-123', owner: ANON, status: 'saved_locally', form: {}, payload: { a: 1 }, step: 0, created_at: 'x', updated_at: 'x', queued_at: 'x', attempts: 0, next_attempt_at: null, last_error: null, server_id: null, server_status: null, synced_at: null, duplicate: false, created_offline: true })
  old.close()
  const db = await getDb()
  assert.equal((await db.get('reports', 'keep-me-123'))?.status, 'saved_locally')
  assert.ok(db.objectStoreNames.contains('delivery'))
})
