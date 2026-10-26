// Offline display of cached warnings (pure logic behind the alerts page).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CACHE_KEY, describeStatus, readCache, reevaluate, writeCache } from '../src/lib/alerts/clientCache'
import { sampleAlert, NOW } from './fixtures/alerts'
import type { AlertsView, PublicAlert } from '../src/lib/alerts/monitor'
import type { AlertRecord } from '../src/lib/alerts/types'

const pub = (o = {}): PublicAlert => ({ ...(sampleAlert(o) as AlertRecord), effective_status: 'active', freshness: { state: 'fresh', lastSuccessAt: null, ageMinutes: 1 } })
const view = (alerts: PublicAlert[]): AlertsView => ({ serverTime: '2026-10-24T09:55:00.000Z', alerts, providers: [], conflicts: [], monitoring: { state: 'ok', message: '' } })
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

test('offline: saved alerts are labelled saved with their time, and never called live', () => {
  const s = describeStatus({ loading: false, online: false, view: view([pub()]), fetchedAt: '2026-10-24T09:55:00.000Z', fromCache: true })
  assert.equal(s.isLive, false)
  assert.equal(s.mode, 'saved_offline')
  assert.match(s.label, /^Saved copy - last updated/)
  assert.match(s.explanation!, /not live/)
  assert.match(s.explanation!, /cannot arrive/)
  assert.doesNotMatch(s.label, /live warning/i)
})

test('online but the service is unreachable: still a saved copy, with a different explanation', () => {
  const s = describeStatus({ loading: false, online: true, view: view([pub()]), fetchedAt: '2026-10-24T09:55:00.000Z', fromCache: true })
  assert.equal(s.mode, 'saved_error')
  assert.equal(s.isLive, false)
})

test('nothing saved and offline: says it does NOT mean there is no danger', () => {
  const s = describeStatus({ loading: false, online: false, view: null, fetchedAt: null, fromCache: false })
  assert.equal(s.mode, 'empty_offline')
  assert.match(s.explanation!, /does NOT mean there is no danger/)
})

test('a fresh response is the only thing described as live', () => {
  assert.equal(describeStatus({ loading: false, online: true, view: view([]), fetchedAt: '2026-10-24T10:00:00Z', fromCache: false }).isLive, true)
  assert.equal(describeStatus({ loading: true, online: true, view: null, fetchedAt: null, fromCache: false }).isLive, false)
})

test('a saved alert that has expired since is shown as expired, using the device clock', () => {
  const a = pub({ expires_at: '2026-10-24T11:00:00Z' })
  assert.equal(reevaluate([a], NOW)[0].effective_status, 'active')
  assert.equal(reevaluate([a], NOW + 3 * 3600_000)[0].effective_status, 'expired')
})

test('cache round-trips and keeps original timestamps; corrupt cache is ignored', () => {
  const st = mem()
  assert.equal(readCache(st), null)
  const v = view([pub()])
  writeCache(st, v, '2026-10-24T09:55:00.000Z')
  const c = readCache(st)!
  assert.equal(c.view.alerts[0].issued_at, v.alerts[0].issued_at)
  assert.equal(c.view.alerts[0].last_updated_at, v.alerts[0].last_updated_at)
  st.setItem(CACHE_KEY, '{not json')
  assert.equal(readCache(st), null)
})
