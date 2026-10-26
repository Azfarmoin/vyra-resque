// Early-warning system tests. All feeds are mocked: no network, no paid APIs, no live emergencies.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlertValidationError, classifyHazard, mapCapSeverity, parseCapDocument } from '../src/lib/alerts/cap'
import { matchLocation } from '../src/lib/alerts/geo'
import { applyCandidate, sanitiseError, sweepExpired } from '../src/lib/alerts/ingest'
import { detectConflicts, effectiveStatus } from '../src/lib/alerts/lifecycle'
import { buildAlertsView, runMonitoring } from '../src/lib/alerts/monitor'
import { createMemoryAlertStore } from '../src/lib/alerts/store'
import { createCapFeedProvider } from '../src/lib/alerts/providers/capFeed'
import { evaluateDaily, createOpenMeteoProvider, DEFAULT_THRESHOLDS } from '../src/lib/alerts/providers/openMeteo'
import { createUsgsProvider } from '../src/lib/alerts/providers/usgs'
import { buildProviders } from '../src/lib/alerts/providers'
import { summarizeAlert, templateSummary, validateAiText } from '../src/lib/alerts/ai'
import { buildPayload, notifySubscribers, wantsAlert } from '../src/lib/alerts/notify'
import { isAllowedPushEndpoint, type PushSender } from '../src/lib/alerts/push'
import { publishAnnouncement, withdrawAnnouncement, ManualError } from '../src/lib/alerts/manual'
import { cronAuthorised } from '../src/lib/alerts/auth'
import { cap, clifton, lahore, mockFetch, NOW, rss, sampleAlert, SENT, EXPIRES } from './fixtures/alerts'
import type { AlertCandidate, PushSubscriptionRow } from '../src/lib/alerts/types'

const opts = { provider: 'met', sourceName: 'Test Met Service', now: NOW }
const parse = (xml: string) => parseCapDocument(xml, opts)
const one = (xml: string) => { const r = parse(xml); assert.equal(r.length, 1); return r[0] }

// ---------------------------------------------------------------- ingestion & mapping
test('official CAP warning is ingested with source, times, area, instructions and original link', () => {
  const a = one(cap())
  assert.equal(a.origin, 'official')
  assert.equal(a.hazard_type, 'heavy_rain')
  assert.equal(a.severity, 'warning')
  assert.equal(a.issued_at, '2026-10-24T09:30:00.000Z')
  assert.equal(a.expires_at, '2026-10-24T18:00:00.000Z')
  assert.equal(a.affected_area, 'Clifton, Karachi')
  assert.equal(a.instruction, 'Avoid low-lying roads.')
  assert.equal(a.source_url, 'https://met.example.test/alerts/TEST-1')
  assert.equal(a.areas[0].geometry[0].type, 'polygon')
})

test('severity mapping follows the source and never invents urgency', () => {
  const m = mapCapSeverity
  assert.equal(m({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }), 'emergency')
  assert.equal(m({ severity: 'Extreme', urgency: 'Expected', certainty: 'Likely' }), 'emergency')
  assert.equal(m({ severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', responseType: ['Evacuate'] }), 'emergency')
  assert.equal(m({ severity: 'Severe', urgency: 'Immediate', certainty: 'Observed', responseType: ['Prepare'] }), 'warning')
  assert.equal(m({ severity: 'Severe', urgency: 'Expected', certainty: 'Likely' }), 'warning')
  assert.equal(m({ severity: 'Severe', urgency: 'Future', certainty: 'Possible' }), 'watch') // could become hazardous
  assert.equal(m({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Possible' }), 'watch') // uncertain never becomes Emergency
  assert.equal(m({ severity: 'Moderate', urgency: 'Expected', certainty: 'Likely' }), 'watch')
  assert.equal(m({ severity: 'Minor' }), 'information')
  assert.equal(m({ severity: 'Unknown' }), 'information')
  assert.equal(m({}), 'information')
})

test('hazard classification', () => {
  assert.equal(classifyHazard('Heat Wave advisory'), 'heatwave')
  assert.equal(classifyHazard('River flood warning at Guddu barrage'), 'river_flood')
  assert.equal(classifyHazard('Flash flood and heavy rain'), 'heavy_rain')
  assert.equal(classifyHazard('Tropical cyclone Asna'), 'cyclone')
  assert.equal(classifyHazard('Severe thunderstorm with hail'), 'thunderstorm_wind')
  assert.equal(classifyHazard('Landslide risk'), 'landslide')
  assert.equal(classifyHazard('Forest fire'), 'wildfire')
  assert.equal(classifyHazard('Earthquake'), 'earthquake')
  assert.equal(classifyHazard('Something unusual'), 'other')
})

test('timestamps are validated: no offset, impossible, future, expiry before sent', () => {
  for (const bad of [{ sent: '2026-10-24T09:30:00' }, { sent: 'yesterday' }, { sent: '2026-10-24T14:30:00Z' }, { expires: '2026-10-24T08:00:00Z' }, { effective: '24/10/2026' }]) {
    assert.throws(() => parse(cap(bad)), (e: unknown) => e instanceof AlertValidationError && e.kind === 'invalid_timestamp', JSON.stringify(bad))
  }
  assert.throws(() => parse('<alert><identifier>x</identifier></alert>'), AlertValidationError) // no sent
  assert.throws(() => parse(cap({ noInfo: true })), AlertValidationError)
  assert.throws(() => parse('<not-cap/>'), AlertValidationError)
})

test('test, exercise, draft and non-public messages are never ingested', () => {
  for (const o of [{ status: 'Test' }, { status: 'Exercise' }, { status: 'Draft' }, { scope: 'Restricted' }, { scope: 'Private' }]) assert.deepEqual(parse(cap(o)), [], JSON.stringify(o))
})

test('malformed XML is rejected cleanly', () => {
  assert.throws(() => parse('<alert><identifier>x</alert>'))
  assert.throws(() => parse(''))
  // entity tricks are not expanded
  const c = one(cap({ description: '&lt;b&gt; &amp; &#65;' }))
  assert.equal(c.description, '<b> & A')
  assert.doesNotThrow(() => parse('<!DOCTYPE alert [<!ENTITY x "boom">]>' + cap()))
})

// ---------------------------------------------------------------- location matching
test('location matching: inside, outside, near-edge and imprecise', () => {
  const a = sampleAlert()
  assert.equal(matchLocation(a, clifton).result, 'yes')
  assert.equal(matchLocation(a, clifton).precision, 'polygon')
  assert.equal(matchLocation(a, lahore).result, 'no')
  assert.match(matchLocation(a, lahore).note, /not a statement that your location is safe/i)
  // 200 m outside the edge with a 1 km GPS accuracy: cannot rule it out
  const edge = { ...clifton, lat: 24.8622, source: 'gps' as const, accuracyM: 1000 }
  assert.equal(matchLocation(a, edge).result, 'possible')
  // a named-area centre is only a stand-in for the whole area: inside but imprecise
  const area = { ...clifton, lat: 24.7815, source: 'area_centre' as const, accuracyM: null }
  const m = matchLocation(a, area)
  assert.equal(m.result, 'possible')
  assert.match(m.note, /approximate/i)
  assert.doesNotMatch(m.note, /your (exact )?(street|building) is/i)
})

test('location matching: circles, name-only alerts and alerts with no way to tell', () => {
  const circ = sampleAlert({ areas: [{ description: 'Around X', geometry: [{ type: 'circle', center: [24.82, 67.03], radiusKm: 10 }], geocodes: [] }] })
  assert.equal(matchLocation(circ, clifton).result, 'yes')
  assert.equal(matchLocation(circ, lahore).result, 'no')
  const named = sampleAlert({ areas: [{ description: 'Karachi South, Clifton', geometry: [], geocodes: [] }], affected_area: 'Karachi South, Clifton' })
  const byName = matchLocation(named, clifton)
  assert.equal(byName.result, 'possible')
  assert.equal(byName.precision, 'area_name')
  assert.equal(matchLocation(named, lahore).result, 'unknown')
  const none = sampleAlert({ areas: [], affected_area: '' })
  assert.equal(matchLocation(none, clifton).result, 'unknown')
})

// ---------------------------------------------------------------- duplicates, revisions, cancellations, expiry
test('duplicate alerts are not duplicated; unchanged re-fetch does not notify', async () => {
  const store = createMemoryAlertStore()
  const c = one(cap())
  const first = await applyCandidate(store, c, NOW)
  assert.equal(first[0].action, 'created')
  assert.equal(first[0].notify, 'new')
  const again = await applyCandidate(store, one(cap()), NOW + 600_000)
  assert.equal(again[0].action, 'unchanged')
  assert.equal(again[0].notify, undefined)
  assert.equal((await store.listAlerts()).length, 1)
})

test('a revised alert updates the same record; only material changes notify', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap()), NOW)
  const t2 = '2026-10-24T09:45:00Z'
  const sev = await applyCandidate(store, one(cap({ sent: t2, severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' })), NOW)
  assert.equal(sev[0].action, 'updated')
  assert.equal(sev[0].notify, 'update')
  assert.equal(sev[0].alert!.revision, 2)
  assert.equal(sev[0].alert!.severity, 'emergency')
  // wording-only edit: updates the record, no new notification
  const text = await applyCandidate(store, one(cap({ sent: '2026-10-24T09:50:00Z', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed', description: 'Heavy rainfall of 80 mm is expected. Flooding is possible in places.' })), NOW)
  assert.equal(text[0].action, 'updated')
  assert.equal(text[0].notify, undefined)
  assert.equal((await store.listAlerts()).length, 1)
})

test('a late-arriving older revision does not overwrite a newer one', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap({ sent: '2026-10-24T09:45:00Z', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' })), NOW)
  const old = await applyCandidate(store, one(cap({ sent: '2026-10-24T09:30:00Z', severity: 'Moderate' })), NOW)
  assert.equal(old[0].action, 'unchanged')
  assert.equal((await store.findByExternal('met', 'TEST-1'))!.severity, 'emergency')
})

test('CAP Update supersedes and Cancel withdraws earlier messages', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap({ id: 'A1' })), NOW)
  const upd = await applyCandidate(store, one(cap({ id: 'A2', sent: '2026-10-24T09:40:00Z', msgType: 'Update', references: 'met@example.test,A1,2026-10-24T09:30:00Z' })), NOW)
  assert.equal(upd.find((o) => o.action === 'created')!.notify, 'new')
  assert.equal((await store.findByExternal('met', 'A1'))!.status, 'superseded')
  assert.equal((await store.findByExternal('met', 'A2'))!.status, 'active')

  // a bare Cancel (no <info>) withdraws A2 and stores nothing of its own
  const cancel = await applyCandidate(store, parse(cap({ id: 'A3', sent: '2026-10-24T09:50:00Z', msgType: 'Cancel', references: 'met@example.test,A2,2026-10-24T09:40:00Z', noInfo: true }))[0], NOW)
  assert.equal(cancel[0].action, 'superseded')
  assert.equal(cancel[0].notify, 'cancel')
  assert.equal((await store.findByExternal('met', 'A2'))!.status, 'cancelled')
  assert.equal(await store.findByExternal('met', 'A3'), null)
  // a cancellation that references nothing we hold is harmless
  const ghost = await applyCandidate(store, parse(cap({ id: 'A9', msgType: 'Cancel', references: 'met@example.test,NOPE,2026-10-24T09:00:00Z', noInfo: true }))[0], NOW)
  assert.equal(ghost[0].action, 'unchanged')
})

test('an alert issued long ago is stored but not pushed (e.g. when a provider is first enabled)', async () => {
  const store = createMemoryAlertStore()
  const oldSent = '2026-10-23T08:00:00Z'
  const r = await applyCandidate(store, one(cap({ sent: oldSent, effective: oldSent })), NOW)
  assert.equal(r[0].action, 'created')
  assert.equal(r[0].notify, undefined)
})

test('expired alerts are never active, are swept, and are hidden from the live view but kept in history', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap({ expires: '2026-10-24T11:00:00Z' })), NOW)
  const later = NOW + 2 * 3600_000
  const a = (await store.findByExternal('met', 'TEST-1'))!
  assert.equal(effectiveStatus(a, NOW), 'active')
  assert.equal(effectiveStatus(a, later), 'expired')
  const live = await buildAlertsView(store, [], { now: later })
  assert.equal(live.alerts.length, 0)
  const hist = await buildAlertsView(store, [], { now: later, history: true })
  assert.equal(hist.alerts.length, 1)
  assert.equal(hist.alerts[0].effective_status, 'expired')
  assert.equal(await sweepExpired(store, later), 1)
  assert.equal((await store.findByExternal('met', 'TEST-1'))!.status, 'expired')
})

test('a recently cancelled alert stays visible, marked cancelled, so nobody keeps acting on it', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap({ id: 'C1' })), NOW)
  await applyCandidate(store, parse(cap({ id: 'C2', sent: '2026-10-24T09:50:00Z', msgType: 'Cancel', references: 'met@example.test,C1,x', noInfo: true }))[0], NOW)
  const v = await buildAlertsView(store, [], { now: NOW })
  assert.equal(v.alerts.length, 1)
  assert.equal(v.alerts[0].effective_status, 'cancelled')
})

// ---------------------------------------------------------------- providers: feeds, outages, stale data
const FEED = 'https://met.example.test/rss.xml'
const mkProvider = () => createCapFeedProvider({ id: 'cap-test', name: 'Test Met Service', url: FEED, coverage: 'Testland', minIntervalMinutes: 10 })

test('CAP feed provider: follows same-host links, ignores other hosts, keeps good items when one is malformed', async () => {
  const { fn, calls } = mockFetch({
    [FEED]: rss(['https://met.example.test/a1.xml', 'https://met.example.test/a2.xml', 'https://evil.example.test/a3.xml']),
    'https://met.example.test/a1.xml': cap({ id: 'F1' }),
    'https://met.example.test/a2.xml': cap({ id: 'F2', sent: 'not a time' }),
    'https://evil.example.test/a3.xml': cap({ id: 'F3' }),
  })
  const store = createMemoryAlertStore()
  const rep = await runMonitoring(store, [mkProvider()], { fetchImpl: fn, now: NOW })
  assert.equal(rep.providers[0].status, 'ok')
  assert.equal(rep.providers[0].created, 1)
  assert.ok(rep.providers[0].rejected >= 2) // malformed timestamp + ignored foreign link
  assert.ok(!calls.includes('https://evil.example.test/a3.xml'), 'never fetches links on other hosts')
  const issues = await store.listIssues()
  assert.ok(issues.some((i) => i.kind === 'invalid_timestamp'))
  const h = (await store.getHealth())[0]
  assert.equal(h.consecutive_failures, 0)
  assert.ok(h.last_success_at)
})

test('provider outage: health records the failure, backs off, keeps old alerts and flags them as possibly stale', async () => {
  const store = createMemoryAlertStore()
  const p = mkProvider()
  const ok = mockFetch({ [FEED]: rss(['https://met.example.test/a1.xml']), 'https://met.example.test/a1.xml': cap({ id: 'F1' }) })
  await runMonitoring(store, [p], { fetchImpl: ok.fn, now: NOW })

  const down = mockFetch({ [FEED]: new Error(`connect ECONNREFUSED ${FEED}?token=SECRET123`) })
  const t1 = NOW + 15 * 60_000
  const r1 = await runMonitoring(store, [p], { fetchImpl: down.fn, now: t1 })
  assert.equal(r1.providers[0].status, 'error')
  assert.doesNotMatch(r1.providers[0].error!, /SECRET123|https?:/, 'errors never leak URLs or secrets')
  const h1 = (await store.getHealth())[0]
  assert.equal(h1.consecutive_failures, 1)
  assert.equal(h1.last_success_at, new Date(NOW).toISOString(), 'last success is preserved')

  // backoff: too soon after a failure -> not called at all
  const r2 = await runMonitoring(store, [p], { fetchImpl: down.fn, now: t1 + 5 * 60_000 })
  assert.equal(r2.providers[0].status, 'skipped_interval')
  assert.equal(down.calls.length, 1)

  // an hour later the old alert is still shown but the source is flagged stale and monitoring degraded
  const view = await buildAlertsView(store, [p], { now: NOW + 3600_000 })
  assert.equal(view.alerts.length, 1)
  assert.equal(view.alerts[0].freshness.state, 'stale')
  assert.equal(view.monitoring.state, 'degraded')
  assert.equal(view.providers[0].state, 'error')
})

test('HTTP errors, malformed feeds and expired credentials are handled without throwing', async () => {
  for (const routes of [{ [FEED]: { status: 500 } }, { [FEED]: { status: 401 } }, { [FEED]: '<rss><channel><item></channel>' }, { [FEED]: '' }]) {
    const store = createMemoryAlertStore()
    const rep = await runMonitoring(store, [mkProvider()], { fetchImpl: mockFetch(routes as never).fn, now: NOW })
    assert.equal(rep.providers[0].status, 'error')
    assert.equal((await store.listAlerts()).length, 0)
  }
})

test('with no verified provider configured the view says monitoring is OFF, and no alert is ever invented', async () => {
  const store = createMemoryAlertStore()
  const providers = buildProviders({}) // empty environment
  const v = await buildAlertsView(store, providers, { now: NOW })
  assert.equal(v.alerts.length, 0)
  assert.equal(v.monitoring.state, 'not_configured')
  assert.match(v.monitoring.message, /NOT monitoring/)
  assert.match(v.monitoring.message, /not a sign that conditions are safe/)
  const pmd = providers.find((p) => p.id === 'pmd-cap')!
  const ndma = providers.find((p) => p.id === 'ndma-cap')!
  assert.match(pmd.unconfiguredReason!, /ALERT_PMD_CAP_URL/)
  assert.match(ndma.unconfiguredReason!, /ALERT_NDMA_CAP_URL/)
  assert.equal(pmd.docs.feedUrl, null, 'no invented endpoint')
  // unconfigured providers are never called
  const { fn, calls } = mockFetch({})
  const rep = await runMonitoring(store, providers, { fetchImpl: fn, now: NOW })
  assert.equal(calls.length, 0)
  assert.ok(rep.providers.every((p) => p.status === 'skipped_unconfigured'))
})

test('a configured provider (PMD) is built from the environment, and a fresh run reports monitoring ok', async () => {
  const env = { ALERT_PMD_CAP_URL: FEED }
  const providers = buildProviders(env)
  const pmd = providers.find((p) => p.id === 'pmd-cap')!
  assert.equal(pmd.unconfiguredReason, null)
  const store = createMemoryAlertStore()
  const { fn } = mockFetch({ [FEED]: rss(['https://met.example.test/a1.xml']), 'https://met.example.test/a1.xml': cap({ id: 'P1' }) })
  await runMonitoring(store, providers, { fetchImpl: fn, now: NOW, env })
  const v = await buildAlertsView(store, providers, { now: NOW + 60_000 })
  assert.equal(v.monitoring.state, 'ok')
  assert.equal(v.alerts[0].freshness.state, 'fresh')
  assert.equal(v.alerts[0].provider, 'pmd-cap')
})

test('provider polling interval is respected; admin "force" overrides it; disabled providers are skipped', async () => {
  const store = createMemoryAlertStore()
  const p = mkProvider()
  const { fn, calls } = mockFetch({ [FEED]: rss([]) })
  await runMonitoring(store, [p], { fetchImpl: fn, now: NOW })
  assert.equal(calls.length, 1)
  const soon = await runMonitoring(store, [p], { fetchImpl: fn, now: NOW + 60_000 })
  assert.equal(soon.providers[0].status, 'skipped_interval')
  assert.equal(calls.length, 1)
  await runMonitoring(store, [p], { fetchImpl: fn, now: NOW + 60_000, force: true })
  assert.equal(calls.length, 2)
  await store.setProviderOverride('cap-test', false)
  const off = await runMonitoring(store, [p], { fetchImpl: fn, now: NOW + 3600_000, force: true })
  assert.equal(off.providers[0].status, 'skipped_disabled')
})

test('scheduled monitoring runs on the server with no browser present', async () => {
  assert.equal(typeof (globalThis as Record<string, unknown>).window, 'undefined')
  assert.equal(typeof (globalThis as Record<string, unknown>).document, 'undefined')
  const store = createMemoryAlertStore()
  const { fn } = mockFetch({ [FEED]: rss(['https://met.example.test/a1.xml']), 'https://met.example.test/a1.xml': cap({ id: 'S1' }) })
  const rep = await runMonitoring(store, [mkProvider()], { fetchImpl: fn, now: NOW })
  assert.equal(rep.providers[0].created, 1)
})

test('cron endpoint secret check', () => {
  const req = (v?: string) => ({ headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? v ?? null : null) } })
  assert.equal((cronAuthorised(req('Bearer anything'), {}) as { status: number }).status, 503)
  assert.equal((cronAuthorised(req('Bearer short'), { CRON_SECRET: 'short' }) as { status: number }).status, 503)
  const env = { CRON_SECRET: 'a-long-enough-secret-123' }
  assert.equal((cronAuthorised(req(), env) as { status: number }).status, 401)
  assert.equal((cronAuthorised(req('Bearer wrong-wrong-wrong-wrong'), env) as { status: number }).status, 401)
  assert.equal(cronAuthorised(req('Bearer a-long-enough-secret-123'), env).ok, true)
})

test('error text is sanitised', () => {
  assert.doesNotMatch(sanitiseError(new Error('fetch https://x.test/feed?api_key=abc failed')), /x\.test|abc/)
  assert.doesNotMatch(sanitiseError('token=ABC123 bad'), /ABC123/)
})

// ---------------------------------------------------------------- conflicting sources
test('conflicting sources are surfaced, not silently resolved; the official one leads', () => {
  const official = sampleAlert({ id: 'o', provider: 'met', origin: 'official', severity: 'warning', source_name: 'National Met Service' })
  const estimate = sampleAlert({ id: 'e', provider: 'open-meteo-estimates', origin: 'internal_estimate', severity: 'information', source_name: 'VYRA estimate' })
  const far = sampleAlert({ id: 'f', provider: 'other', severity: 'information', areas: [{ description: 'Lahore', geometry: [{ type: 'circle', center: [31.5, 74.3], radiusKm: 10 }], geocodes: [] }] })
  const c = detectConflicts([estimate, official, far], NOW)
  assert.equal(c.length, 1)
  assert.equal(c[0].prioritised_id, 'o')
  assert.deepEqual([...c[0].alert_ids].sort(), ['e', 'o'])
  assert.match(c[0].reason, /read both/)
  // same provider, same severity, expired or cancelled alerts are not conflicts
  assert.equal(detectConflicts([official, { ...estimate, severity: 'warning' }], NOW).length, 0)
  assert.equal(detectConflicts([official, { ...estimate, status: 'cancelled' }], NOW).length, 0)
})

// ---------------------------------------------------------------- estimates and observations are never presented as warnings
test('internal estimates are labelled, capped at Watch and never pushed', async () => {
  const d = { time: ['2026-10-24', '2026-10-25', '2026-10-26'], precipitation_sum: [10, 400, 20], apparent_temperature_max: [45, 46, 47], wind_gusts_10m_max: [10, 200, 10] }
  const ev = evaluateDaily(d, DEFAULT_THRESHOLDS)
  assert.ok(ev.length === 3 && ev.every((e) => e.severity === 'watch' || e.severity === 'information'))
  assert.ok(!ev.some((e) => e.severity === 'warning' || e.severity === 'emergency'))

  const env = { ALERT_OPEN_METEO_ENABLED: 'true', ALERT_MONITOR_POINTS: JSON.stringify([{ name: 'Clifton', lat: 24.81, lng: 67.03 }]) }
  const p = createOpenMeteoProvider(env)
  assert.equal(p.unconfiguredReason, null)
  const { fn } = mockFetch({})
  void fn
  const url = (u: string) => u.startsWith('https://api.open-meteo.com/v1/forecast')
  const fetchImpl = (async (input: RequestInfo | URL) => (url(String(input)) ? new Response(JSON.stringify({ daily: d }), { status: 200 }) : new Response('', { status: 404 }))) as typeof fetch
  const store = createMemoryAlertStore()
  const rep = await runMonitoring(store, [p], { fetchImpl, now: NOW, env })
  assert.equal(rep.providers[0].status, 'ok')
  const alerts = await store.listAlerts()
  assert.ok(alerts.length >= 1)
  assert.ok(alerts.every((a) => a.origin === 'internal_estimate' && (a.severity === 'watch' || a.severity === 'information')))
  assert.ok(alerts.every((a) => /not an official/i.test(a.description)))
  assert.deepEqual(rep.notifications, { attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 0 })
  // disabled / unconfigured by default
  assert.match(createOpenMeteoProvider({}).unconfiguredReason!, /Disabled/)
  assert.match(createOpenMeteoProvider({ ALERT_OPEN_METEO_ENABLED: 'true' }).unconfiguredReason!, /ALERT_MONITOR_POINTS/)
})

const QUAKES = JSON.stringify({ features: [
  { id: 'us1', properties: { mag: 6.1, place: '45 km W of Somewhere', time: NOW - 3600_000, updated: NOW - 1800_000, url: 'https://earthquake.usgs.gov/e/us1', status: 'reviewed', type: 'earthquake', tsunami: 0 }, geometry: { coordinates: [67.0, 25.0, 10] } },
  { id: 'bad1', properties: { mag: null, place: 'x', time: NOW, type: 'earthquake' }, geometry: { coordinates: [0, 0, 0] } },
  { id: 'fut', properties: { mag: 5, place: 'future', time: NOW + 86_400_000, type: 'earthquake' }, geometry: { coordinates: [0, 0, 0] } },
  { id: 'blast', properties: { mag: 4.6, place: 'quarry', time: NOW - 1000, type: 'quarry blast' }, geometry: { coordinates: [0, 0, 0] } },
] })

test('an estimate that the next forecast no longer supports is withdrawn immediately', async () => {
  const env = { ALERT_OPEN_METEO_ENABLED: 'true', ALERT_MONITOR_POINTS: JSON.stringify([{ name: 'Clifton', lat: 24.81, lng: 67.03 }]) }
  const p = createOpenMeteoProvider(env)
  const mk = (rain: number) => (async () => new Response(JSON.stringify({ daily: { time: ['2026-10-24', '2026-10-25', '2026-10-26'], precipitation_sum: [rain, 0, 0], apparent_temperature_max: [30, 30, 30], wind_gusts_10m_max: [10, 10, 10] } }), { status: 200 })) as unknown as typeof fetch
  const store = createMemoryAlertStore()
  await runMonitoring(store, [p], { fetchImpl: mk(120), now: NOW, env })
  assert.equal((await store.listAlerts({ statuses: ['active'] })).length, 1)
  await runMonitoring(store, [p], { fetchImpl: mk(5), now: NOW + 2 * 3600_000, env })
  assert.equal((await store.listAlerts({ statuses: ['active'] })).length, 0)
})

test('earthquakes are reported only as after-the-event records, never as predictions or warnings', async () => {
  const p = createUsgsProvider({ ALERT_USGS_ENABLED: 'true', ALERT_USGS_FEED_URL: 'https://usgs.example.test/q.json' })
  const store = createMemoryAlertStore()
  const rep = await runMonitoring(store, [p], { fetchImpl: mockFetch({ 'https://usgs.example.test/q.json': QUAKES }).fn, now: NOW })
  assert.equal(rep.providers[0].created, 1)
  assert.ok(rep.providers[0].rejected >= 3)
  const a = (await store.listAlerts())[0]
  assert.equal(a.origin, 'observation')
  assert.equal(a.severity, 'information')
  assert.match(a.description, /already happened/)
  assert.match(a.description, /not a prediction and not an early warning/)
  assert.match(p.docs.limitations, /cannot predict/)
  // near the epicentre only, and described as approximate distance matching
  assert.notEqual(matchLocation(a, { ...clifton, lat: 25.1, lng: 67.1 }).result, 'no')
  assert.equal(matchLocation(a, lahore).result, 'no')
  assert.match(createUsgsProvider({}).unconfiguredReason!, /Disabled/)
})

// ---------------------------------------------------------------- AI safeguards
const SRC = sampleAlert()

test('AI summaries must stay faithful: invented numbers, reassurance, destinations and raised severity are rejected', () => {
  assert.ok(validateAiText('Heavy rain of 80 mm is expected around Clifton. Avoid low-lying roads.', SRC).ok)
  const bad: [string, RegExp][] = [
    ['Heavy rain of 120 mm is expected.', /number \(120\)/],
    ['Heavy rain is expected. Call 021-5551234 for help.', /number/],
    ['Heavy rain is expected, but you are safe at home.', /safety/],
    ['There is no risk to Clifton.', /no risk/],
    ['Do not worry about this rain.', /reassurance/],
    ['Evacuate to Gulshan Stadium now.', /destination/],
    ['Go to the safe shelter nearby.', /destination|safe place/],
    ['Heavy rain will definitely cause floods.', /certainty/],
    ['This is an emergency in Clifton.', /Emergency/],
    ['See https://bad.example/x for details.', /link/],
    ['', /empty/],
    ['x'.repeat(1000), /too long/],
  ]
  for (const [text, why] of bad) {
    const r = validateAiText(text, SRC)
    assert.equal(r.ok, false, text)
    assert.match((r as { reason: string }).reason, why, text)
  }
  // an official Warning-level alert may use the word "warning"; an Information one may not escalate to it
  assert.equal(validateAiText('A warning is in force.', sampleAlert({ severity: 'information', title: 'Rain info', description: 'Some rain.', instruction: null })).ok, false)
  // Eastern Arabic digits cannot be used to smuggle a number past the check
  assert.equal(validateAiText('بارش ٩٩ ملی میٹر', SRC).ok, false)
  assert.equal(validateAiText('بارش ٨٠ ملی میٹر', SRC).ok, true)
})

test('AI: bad model output falls back to the template summary; model errors never block an alert; no key means no AI', async () => {
  const halluc = await summarizeAlert(SRC, { llm: async () => 'Heavy rain of 300 mm will hit. You are safe in Clifton.', model: 'm', now: NOW })
  assert.equal(halluc.method, 'template')
  assert.ok(halluc.rejectedReason)
  assert.equal(halluc.text, templateSummary(SRC))
  const boom = await summarizeAlert(SRC, { llm: async () => { throw new Error('HTTP 500 https://api.example/secret') }, now: NOW })
  assert.equal(boom.method, 'template')
  assert.doesNotMatch(boom.rejectedReason!, /https?:/)
  const none = await summarizeAlert(SRC, { llm: null, now: NOW })
  assert.equal(none.method, 'template')
  const good = await summarizeAlert(SRC, { llm: async () => 'Heavy rain of 80 mm is expected in Clifton and urban flooding is possible. Avoid low-lying roads.', model: 'm', language: 'en', now: NOW })
  assert.equal(good.method, 'llm')
  assert.equal(good.model, 'm')
  // the template only reuses the source's own words and numbers, and passes its own validator
  assert.ok(validateAiText(templateSummary(SRC), SRC).ok)
  assert.doesNotMatch(templateSummary(sampleAlert({ severity: 'information', description: '', instruction: null })), /safe|no risk/i)
})

test('summaries never decide severity: the stored severity is the source mapping, whatever the model says', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap()), NOW)
  const llm = { client: async () => 'This is an emergency. Heavy rain of 80 mm.', model: 'm' }
  await runMonitoring(store, [], { now: NOW, llm })
  const a = (await store.listAlerts())[0]
  assert.equal(a.severity, 'warning')
})

// ---------------------------------------------------------------- push: preferences, delivery, failures, privacy
const sub = (over: Partial<PushSubscriptionRow> = {}): Parameters<ReturnType<typeof createMemoryAlertStore>['upsertSubscription']>[0] => ({
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'p'.repeat(20), auth: 'a'.repeat(20), user_id: null,
  locations: [clifton], hazard_types: [], minimum_severity: 'warning', language: 'en', ...over,
})
const okSender = () => { const sent: string[] = []; const fn: PushSender = async (t, payload) => { sent.push(payload); void t; return { ok: true } }; return { fn, sent } }

test('push endpoints must be on known push services (no SSRF to internal addresses)', () => {
  assert.ok(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'))
  assert.ok(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'))
  assert.ok(isAllowedPushEndpoint('https://web.push.apple.com/abc'))
  for (const bad of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) assert.equal(isAllowedPushEndpoint(bad), false, bad)
  assert.ok(isAllowedPushEndpoint('https://push.example.org/x', 'example.org'))
})

test('who gets notified: location, hazard filter and minimum severity', async () => {
  const store = createMemoryAlertStore()
  const a = sampleAlert()
  const mk = async (over: Partial<PushSubscriptionRow>, ep: string) => store.upsertSubscription(sub({ endpoint: `https://fcm.googleapis.com/fcm/send/${ep}`, ...over }))
  const inside = await mk({}, 'in')
  const outside = await mk({ locations: [lahore] }, 'out')
  const noLoc = await mk({ locations: [] }, 'noloc')
  const wrongHazard = await mk({ hazard_types: ['heatwave'] }, 'haz')
  const highBar = await mk({ minimum_severity: 'emergency' }, 'hi')
  assert.equal(wantsAlert(inside, a), true)
  assert.equal(wantsAlert(outside, a), false)
  assert.equal(wantsAlert(noLoc, a), false)
  assert.equal(wantsAlert(wrongHazard, a), false)
  assert.equal(wantsAlert(highBar, a), false)
  // imprecise-but-close counts ("possible")
  assert.equal(wantsAlert({ ...inside, locations: [{ ...clifton, lat: 24.8622, source: 'gps', accuracyM: 1000 }] }, a), true)
  const { fn, sent } = okSender()
  const res = await notifySubscribers(store, a, 'new', fn)
  assert.equal(res.sent, 1)
  assert.equal(sent.length, 1)
})

test('the same alert revision is never sent twice to the same person; a new revision is', async () => {
  const store = createMemoryAlertStore()
  await store.upsertSubscription(sub())
  const { fn, sent } = okSender()
  const a = sampleAlert()
  assert.equal((await notifySubscribers(store, a, 'new', fn)).sent, 1)
  const again = await notifySubscribers(store, a, 'new', fn)
  assert.equal(again.sent, 0)
  assert.equal(again.skipped, 1)
  assert.equal((await notifySubscribers(store, { ...a, revision: 2, severity: 'emergency' }, 'update', fn)).sent, 1)
  assert.equal(sent.length, 2)
})

test('push failures are recorded; expired subscriptions are removed; a missing sender is reported, not hidden', async () => {
  const store = createMemoryAlertStore()
  const s = await store.upsertSubscription(sub())
  const a = sampleAlert()
  const failing: PushSender = async () => ({ ok: false, status: 503, message: 'service unavailable' })
  const r1 = await notifySubscribers(store, a, 'new', failing)
  assert.equal(r1.failed, 1)
  assert.equal((await store.listNotifications())[0].outcome, 'failed')
  assert.equal((await store.listSubscriptions())[0].failure_count, 1)

  const throwing: PushSender = async () => { throw new Error('socket hang up') }
  const r2 = await notifySubscribers(store, { ...a, revision: 2 }, 'update', throwing)
  assert.equal(r2.failed, 1)

  const gone: PushSender = async () => ({ ok: false, status: 410, message: 'gone' })
  const r3 = await notifySubscribers(store, { ...a, revision: 3 }, 'update', gone)
  assert.equal(r3.removed, 1)
  assert.equal((await store.listSubscriptions()).length, 0)
  assert.equal((await store.listNotifications())[0].outcome, 'gone')

  await store.upsertSubscription(sub())
  const none = await notifySubscribers(store, { ...a, revision: 4 }, 'update', null)
  assert.equal(none.failed, 1)
  assert.match((await store.listNotifications())[0].detail!, /not configured/)
  void s
})

test('cancellations only reach people who were told about the alert; payload carries no location', async () => {
  const store = createMemoryAlertStore()
  await store.upsertSubscription(sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/told' }))
  await store.upsertSubscription(sub({ endpoint: 'https://fcm.googleapis.com/fcm/send/never' }))
  const a = sampleAlert()
  const { fn, sent } = okSender()
  // only "told" receives the original
  const subs = await store.listSubscriptions()
  await store.recordNotification({ alert_id: a.id, revision: 1, subscription_id: subs[0].id, kind: 'new' }).then((n) => store.finishNotification(n!.id, 'sent'))
  const res = await notifySubscribers(store, { ...a, status: 'cancelled', revision: 2 }, 'cancel', fn)
  assert.equal(res.sent, 1)
  assert.equal(JSON.parse(sent[0]).cancelled, true)
  const payload = buildPayload(a, 'new')
  assert.doesNotMatch(payload, /24\.82|67\.03|Clifton"?,?\s*lat|"lat"|"lng"/)
  assert.ok(JSON.parse(payload).url.startsWith('/alerts?id='))
})

// ---------------------------------------------------------------- admin announcements & privacy
test('manual announcements are human-authored, bounded, audited, and the only thing admins can withdraw', async () => {
  const store = createMemoryAlertStore()
  const base = { title: 'Road closed by flooding', description: 'Verified with the district control room.', severity: 'warning' as const, hazard_type: 'heavy_rain' as const, affected_area: 'Clifton', expires_at: '2026-10-25T10:00:00Z', verified_confirmation: true as const }
  await assert.rejects(() => publishAnnouncement(store, { ...base, expires_at: '2026-10-24T09:00:00Z' }, 'admin@x.test', null, NOW), ManualError)
  await assert.rejects(() => publishAnnouncement(store, { ...base, expires_at: '2027-01-01T00:00:00Z' }, 'admin@x.test', null, NOW), /at most 30 days/)
  await store.upsertSubscription(sub({ locations: [lahore] }))
  const { fn, sent } = okSender()
  const { alert, notifications } = await publishAnnouncement(store, { ...base, notify: true }, 'admin@x.test', fn, NOW)
  assert.equal(alert.origin, 'manual')
  assert.equal(alert.source_name, 'VYRA administrators')
  assert.equal(notifications!.sent, 1, 'no boundary => broadcast, as the limitations text says')
  assert.match(alert.limitations[0], /may not apply to your location/)
  assert.equal(sent.length, 1)
  assert.ok((await store.listAudit()).some((e) => e.action === 'announcement_published' && e.actor === 'admin@x.test'))

  // imported alerts cannot be edited or withdrawn by hand
  const imported = (await applyCandidate(store, one(cap()), NOW))[0].alert!
  await assert.rejects(() => withdrawAnnouncement(store, imported.id, 'admin@x.test', null, NOW), (e: unknown) => e instanceof ManualError && e.status === 403)
  const w = await withdrawAnnouncement(store, alert.id, 'admin@x.test', fn, NOW)
  assert.equal(w.status, 'cancelled')
  assert.equal(sent.length, 2, 'the person who was told is told it was withdrawn')
  await assert.rejects(() => withdrawAnnouncement(store, alert.id, 'admin@x.test', null, NOW), /no longer active/)
})

test('the public view never exposes raw source payloads, admin identities or subscription details', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap()), NOW)
  await publishAnnouncement(store, { title: 'Announcement', description: 'Verified announcement text.', severity: 'watch', hazard_type: 'other', affected_area: 'Karachi', expires_at: '2026-10-25T10:00:00Z', verified_confirmation: true }, 'secret-admin@x.test', null, NOW)
  await store.upsertSubscription(sub())
  const json = JSON.stringify(await buildAlertsView(store, [], { now: NOW }))
  assert.doesNotMatch(json, /secret-admin|raw_source_metadata|created_by|fcm\.googleapis|p256dh|"auth"/)
  assert.match(json, /manual/)
})

test('official alerts, AI/template summaries, estimates and human announcements stay distinguishable', async () => {
  const store = createMemoryAlertStore()
  await applyCandidate(store, one(cap()), NOW)
  await publishAnnouncement(store, { title: 'Announcement', description: 'Verified announcement text.', severity: 'watch', hazard_type: 'other', affected_area: 'Karachi', expires_at: '2026-10-25T10:00:00Z', verified_confirmation: true }, 'a@x.test', null, NOW)
  const origins = (await store.listAlerts()).map((a) => a.origin).sort()
  assert.deepEqual(origins, ['manual', 'official'])
  assert.ok((await store.listAlerts()).every((a) => a.ai_summary === null), 'summaries are stored separately and only when generated')
})
