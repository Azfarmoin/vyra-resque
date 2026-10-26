// Satellite API: authorization, unavailable imagery, failed processing, metadata persistence, review and linking rules.
// Imagery providers are scripted fakes (no network). Pixel fixtures are synthetic and used only to check behaviour.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getStore } from '../src/lib/db'
import { setSatelliteProviders } from '../src/lib/satellite/providers/registry'
import { ProviderError } from '../src/lib/satellite/providers/types'
import { setRoutingDeps } from '../src/lib/routing/deps'
import * as providersRoute from '../src/app/api/satellite/providers/route'
import * as searchRoute from '../src/app/api/satellite/search/route'
import * as analysesRoute from '../src/app/api/satellite/analyses/route'
import * as analysisRoute from '../src/app/api/satellite/analyses/[id]/route'
import * as imageRoute from '../src/app/api/satellite/analyses/[id]/image/[kind]/route'
import * as reviewRoute from '../src/app/api/satellite/analyses/[id]/review/route'
import * as linksRoute from '../src/app/api/satellite/analyses/[id]/links/route'
import { AOI, ADMIN, analysisBody, call, CITIZEN, ctx, fakeProvider, makeTiff, reset, RESPONDER, scene } from './satellite.helpers'

beforeEach(reset)
const j = async (res: Response) => ({ status: res.status, body: await res.json() })
const post = async (route: { POST: unknown }, path: string, body: unknown, as = RESPONDER, c?: unknown) => j(await (route.POST as (r: unknown, c?: unknown) => Promise<Response>)(call(path, { method: 'POST', body, as }), c))
const analyse = (over: Record<string, unknown> = {}, as = RESPONDER) => post(analysesRoute, '/api/satellite/analyses', analysisBody(over), as)
const searchBody = (over: Record<string, unknown> = {}) => ({ provider: 'planetary-computer', collection: 'sentinel-2-l2a', aoi: AOI, before: { start: '2026-08-01', end: '2026-08-20' }, after: { start: '2026-09-10', end: '2026-09-30' }, ...over })

test('authorization: anonymous gets 401 and citizens 403 on every satellite route; responders and admins are allowed', async () => {
  setSatelliteProviders([fakeProvider()])
  const created = await analyse()
  assert.equal(created.status, 201)
  const id = created.body.analysis.id
  const hits: [string, (as?: string) => Promise<Response>][] = [
    ['providers', (as) => providersRoute.GET(call('/api/satellite/providers', { as }) as never)],
    ['search', (as) => searchRoute.POST(call('/api/satellite/search', { method: 'POST', body: searchBody(), as }) as never)],
    ['list', (as) => analysesRoute.GET(call('/api/satellite/analyses', { as }) as never)],
    ['create', (as) => analysesRoute.POST(call('/api/satellite/analyses', { method: 'POST', body: analysisBody(), as }) as never)],
    ['get', (as) => analysisRoute.GET(call(`/api/satellite/analyses/${id}`, { as }) as never, ctx(id))],
    ['image', (as) => imageRoute.GET(call(`/api/satellite/analyses/${id}/image/change`, { as }) as never, ctx(id, 'change'))],
    ['review', (as) => reviewRoute.POST(call('/x', { method: 'POST', body: { state: 'inconclusive' }, as }) as never, ctx(id))],
    ['link', (as) => linksRoute.POST(call('/x', { method: 'POST', body: { targetType: 'zone', targetId: 'nope' }, as }) as never, ctx(id))],
  ]
  for (const [name, run] of hits) {
    assert.equal((await run(undefined)).status, 401, `${name} anonymous`)
    assert.equal((await run('nobody@example.com')).status, 401, `${name} unknown user`)
    assert.equal((await run(CITIZEN)).status, 403, `${name} citizen`)
    for (const who of [RESPONDER, ADMIN]) assert.ok([200, 201, 404, 409].includes((await run(who)).status), `${name} ${who}`)
  }
  const denied = await j(await providersRoute.GET(call('/api/satellite/providers', { as: CITIZEN }) as never))
  assert.match(denied.body.error, /responders and administrators/); assert.equal(denied.body.code, 'forbidden')
})
test('authorization: a citizen cannot reach stored analyses or images even with a valid id', async () => {
  setSatelliteProviders([fakeProvider()])
  const id = (await analyse()).body.analysis.id
  assert.equal((await analysisRoute.GET(call(`/x`, { as: CITIZEN }) as never, ctx(id))).status, 403)
  assert.equal((await imageRoute.GET(call(`/x`, { as: CITIZEN }) as never, ctx(id, 'before'))).status, 403)
})

test('providers: statuses are listed; a provider without credentials says which variables are missing (names only)', async () => {
  setSatelliteProviders([fakeProvider({ state: 'missing_credentials', missing: ['CDSE_CLIENT_ID', 'CDSE_CLIENT_SECRET'] })])
  const list = await j(await providersRoute.GET(call('/api/satellite/providers', { as: RESPONDER }) as never))
  assert.equal(list.body.providers[0].state, 'missing_credentials'); assert.match(list.body.advisory, /not proof of a disaster/)
  const s = await post(searchRoute, '/s', searchBody())
  assert.equal(s.status, 503); assert.equal(s.body.code, 'provider_missing_credentials'); assert.match(s.body.error, /credentials are missing \(CDSE_CLIENT_ID, CDSE_CLIENT_SECRET\)/)
  const a = await analyse()
  assert.equal(a.status, 503); assert.equal(a.body.code, 'provider_missing_credentials')
})
test('providers: unknown provider and an unsupported collection are clear errors', async () => {
  setSatelliteProviders([fakeProvider()])
  assert.equal((await post(searchRoute, '/s', searchBody({ provider: 'nope' }))).status, 404)
  assert.equal((await post(searchRoute, '/s', searchBody({ collection: 'landsat-c2-l2' }))).status, 400)
  assert.equal((await post(searchRoute, '/s', searchBody({ collection: 'bogus' }))).status, 400)
})

test('search: invalid dates and areas are refused before any provider is contacted', async () => {
  const fp = fakeProvider(); let searched = 0; const orig = fp.search; fp.search = async (r) => { searched++; return orig(r) }
  setSatelliteProviders([fp])
  const bad = [
    searchBody({ before: { start: '2026-02-30', end: '2026-03-02' } }), searchBody({ after: { start: '2026-10-20', end: '2027-01-01' } }), searchBody({ before: { start: '2026-09-20', end: '2026-09-25' } }),
    searchBody({ aoi: { type: 'bbox', bbox: [67, 24, 66, 25] } }), searchBody({ aoi: null }), searchBody({ before: null }),
  ]
  for (const b of bad) { const r = await post(searchRoute, '/s', b); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80)); assert.equal(r.body.code, 'validation') }
  assert.equal(searched, 0)
  assert.equal((await analyse({ beforeRange: { start: '2026-09-20', end: '2026-09-25' } })).status, 400)
  assert.equal((await analyse({ aoi: { type: 'bbox', bbox: [60, 20, 70, 30] } })).status, 400)
  assert.equal((await analyse({ parameters: { waterThreshold: 9 } })).status, 400)
  assert.equal((await analyse({ beforeSceneId: undefined })).status, 400)
})
test('search: scenes come back with metadata and a quality hint, and never expose provider access details', async () => {
  const fp = fakeProvider({ scenes: [scene({ id: 'B-1', acquiredAt: '2026-08-10T05:30:00.000Z', cloudCover: 8, access: { secret: 'internal-href' } }), scene({ id: 'B-2', acquiredAt: '2026-08-12T05:30:00.000Z', cloudCover: 70 }), scene({ id: 'A-1', acquiredAt: '2026-09-20T05:30:00.000Z' })] })
  setSatelliteProviders([fp])
  const r = await post(searchRoute, '/s', searchBody())
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.before.map((s: { id: string; qualityHint: string }) => [s.id, s.qualityHint]), [['B-1', 'good'], ['B-2', 'poor']])
  assert.equal(r.body.before[0].resolutionM, 10); assert.equal(r.body.before[0].platform, 'Sentinel-2A'); assert.ok(r.body.before[0].acquiredAt)
  assert.ok(!JSON.stringify(r.body).includes('internal-href'))
})
test('search: no imagery is reported plainly, not as an empty success', async () => {
  setSatelliteProviders([fakeProvider({ scenes: [] })])
  const r = await post(searchRoute, '/s', searchBody())
  assert.equal(r.status, 200); assert.equal(r.body.before.length, 0)
  assert.ok(r.body.notes.some((n: string) => /No imagery was found for the before dates/.test(n)) && r.body.notes.some((n: string) => /after dates/.test(n)))
})
test('search: provider outages and invalid responses surface as errors with the provider code', async () => {
  for (const [err, status, code] of [[new ProviderError('invalid_response', 'The imagery provider returned something that is not valid JSON.'), 502, 'provider_invalid_response'], [new ProviderError('unavailable', 'Could not reach the imagery provider.', 503), 503, 'provider_unavailable'], [new ProviderError('rate_limited', 'slow down', 503), 503, 'provider_rate_limited']] as const) {
    setSatelliteProviders([fakeProvider({ searchError: err })])
    const r = await post(searchRoute, '/s', searchBody())
    assert.equal(r.status, status); assert.equal(r.body.code, code)
  }
})

test('analysis: success stores identifiers, dates, method, parameters, quality, findings and timestamps; provider access details are not stored', async () => {
  setSatelliteProviders([fakeProvider()])
  const r = await analyse({ parameters: { waterThreshold: 0.1, minClusterPixels: 6 } })
  assert.equal(r.status, 201)
  const a = r.body.analysis
  assert.equal(a.status, 'completed'); assert.equal(a.method, 'optical_water_index_v1')
  assert.equal(a.before.id, 'B-1'); assert.equal(a.after.id, 'A-1'); assert.equal(a.before.acquiredAt, '2026-08-10T05:30:00.000Z'); assert.equal(a.after.provider, 'planetary-computer')
  assert.deepEqual(a.parameters, { index: 'mndwi', waterThreshold: 0.1, ndviDrop: 0.25, minClusterPixels: 6 })
  assert.deepEqual(a.beforeRange, { start: '2026-08-01', end: '2026-08-20' })
  assert.ok(['good', 'fair', 'poor'].includes(a.quality.rating)); assert.ok(a.quality.checks.some((c: { code: string }) => c.code === 'registration_unverified'))
  assert.ok(a.stats.classes[3].pixels > 0 && a.stats.maskedFractionAfter > 0)
  assert.ok(a.findings.some((f: string) => /possible new surface water/.test(f))); assert.ok(a.limitations.length >= 3)
  assert.ok(Date.parse(a.createdAt) > 0 && a.createdByName); assert.equal(a.reviewState, 'needs_review'); assert.equal(a.synthetic, false)
  assert.ok(!JSON.stringify(r.body).includes('internal-href'))
  // a later read returns exactly what was saved
  const again = await j(await analysisRoute.GET(call(`/x`, { as: ADMIN }) as never, ctx(a.id)))
  assert.deepEqual({ ...again.body.analysis, reviews: [], links: [] }, { ...a, reviews: [], links: [] })
  assert.equal(again.body.analysis.createdBy, a.createdBy)
  const list = await j(await analysesRoute.GET(call('/x', { as: RESPONDER }) as never))
  assert.equal(list.body.analyses.length, 1)
})
test('analysis: the original scene metadata is preserved untouched and nothing after saving can alter it', async () => {
  const s = scene({ id: 'B-1', acquiredAt: '2026-08-10T05:30:00.000Z', original: { stac_item_id: 'B-1', properties: { 'eo:cloud_cover': 5, odd_field: { deep: [1, 2, 3] } } } })
  setSatelliteProviders([fakeProvider({ scenes: [s, scene({ id: 'A-1', acquiredAt: '2026-09-20T05:30:00.000Z' })] })])
  const a = (await analyse()).body.analysis
  assert.deepEqual(a.before.original, s.original)
  await post(reviewRoute, '/x', { state: 'inconclusive', note: 'looking' }, RESPONDER, ctx(a.id))
  const after = (await j(await analysisRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(a.id)))).body.analysis
  assert.deepEqual(after.before.original, s.original); assert.deepEqual(after.stats, a.stats); assert.deepEqual(after.parameters, a.parameters); assert.equal(after.createdAt, a.createdAt)
})
test('analysis: preview and change images are real PNGs and need responder access', async () => {
  setSatelliteProviders([fakeProvider()])
  const id = (await analyse()).body.analysis.id
  for (const kind of ['before', 'after', 'change']) {
    const res = await imageRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(id, kind))
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/png')
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71])
  }
  assert.equal((await imageRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(id, 'secret'))).status, 404)
  assert.equal((await imageRoute.GET(call('/x', { as: RESPONDER }) as never, ctx('00000000-0000-0000-0000-000000000000', 'change'))).status, 404)
})
test('analysis: incompatible, out-of-range and unknown scenes are refused with a clear reason', async () => {
  const optical = scene({ id: 'B-1', acquiredAt: '2026-08-10T05:30:00.000Z' })
  setSatelliteProviders([fakeProvider({ scenes: [optical, scene({ id: 'A-1', kind: 'sar', acquiredAt: '2026-09-20T05:30:00.000Z' })] })])
  assert.match((await analyse()).body.error, /optical and the other is radar/)
  setSatelliteProviders([fakeProvider({ scenes: [optical, scene({ id: 'A-OLD', acquiredAt: '2026-07-01T00:00:00.000Z' })] })])
  assert.equal((await analyse({ afterSceneId: 'A-OLD' })).body.code, 'scene_out_of_range')
  setSatelliteProviders([fakeProvider()])
  const missing = await analyse({ afterSceneId: 'does-not-exist' })
  assert.ok(missing.status >= 400)
})

test('failed processing: the failure is reported honestly AND recorded in history; no results are shown', async () => {
  setSatelliteProviders([fakeProvider({ load: () => { throw new ProviderError('unavailable', 'Could not read the B03 image data from the provider.', 503) } })])
  const r = await analyse()
  assert.equal(r.status, 503); assert.equal(r.body.code, 'provider_unavailable'); assert.ok(r.body.analysisId)
  const rec = (await j(await analysisRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(r.body.analysisId)))).body.analysis
  assert.equal(rec.status, 'failed'); assert.match(rec.error, /Could not read/); assert.equal(rec.stats, null); assert.deepEqual(rec.findings, []); assert.equal(rec.hasImages, false); assert.equal(rec.before.id, 'B-1')
  assert.equal((await imageRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(rec.id, 'change'))).status, 404)
})
test('failed processing: an unexpected crash inside processing is also recorded, not swallowed as success', async () => {
  setSatelliteProviders([fakeProvider({ load: () => { throw new Error('boom') } })])
  const r = await analyse()
  assert.equal(r.status, 500)
  setSatelliteProviders([fakeProvider({ load: (s, g) => { const l = require_floodPair(s, g); delete l.bands.nir; return l } })])
  const missingBand = await analyse()
  assert.equal(missingBand.status, 422); assert.equal(missingBand.body.code, 'missing_bands')
  const h = (await j(await analysesRoute.GET(call('/x', { as: RESPONDER }) as never))).body.analyses
  assert.ok(h.some((x: { status: string }) => x.status === 'failed'))
})
test('failed processing: when nearly everything is cloud the analysis fails instead of reporting "no change"', async () => {
  setSatelliteProviders([fakeProvider({ load: (s, g) => { const l = require_floodPair(s, g); if (s.access?.role === 'after') l.flags.fill(2); return l } })])
  const r = await analyse()
  assert.equal(r.status, 422); assert.equal(r.body.code, 'no_valid_pixels')
  const h = (await j(await analysisRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(r.body.analysisId)))).body.analysis
  assert.equal(h.status, 'failed')
})
test('failed processing: an analysis that cannot be saved is not shown as if it were kept', async () => {
  const { setSatelliteRepo, RepoError } = await import('../src/lib/satellite/repo')
  setSatelliteProviders([fakeProvider()])
  setSatelliteRepo({ insertAnalysis: async () => { throw new RepoError('no such table satellite_analyses') }, listAnalyses: async () => [], getAnalysis: async () => null, getImage: async () => null, addReview: async () => { throw new Error('x') }, listReviews: async () => [], addLink: async () => { throw new Error('x') }, listLinks: async () => [] })
  const r = await analyse()
  assert.equal(r.status, 503); assert.equal(r.body.code, 'save_failed'); assert.match(r.body.error, /could not be saved, so it is not shown/); assert.equal(r.body.analysis, undefined)
})
test('rate limiting: a burst of analyses is slowed down per user', async () => {
  setSatelliteProviders([fakeProvider()])
  const codes: number[] = []
  for (let i = 0; i < 8; i++) codes.push((await analyse()).status)
  assert.ok(codes.includes(429) && codes.filter((c) => c === 201).length === 6)
})

test('review: the four states are recorded as an append-only history with reviewer and time', async () => {
  setSatelliteProviders([fakeProvider()])
  const id = (await analyse()).body.analysis.id
  for (const state of ['inconclusive', 'not_disaster_related', 'needs_review']) {
    const r = await post(reviewRoute, '/x', { state, note: `set ${state}` }, RESPONDER, ctx(id))
    assert.equal(r.status, 200); assert.equal(r.body.analysis.reviewState, state)
  }
  const c = await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'Checked against field team photo.', acknowledgedLimitations: true }, ADMIN, ctx(id))
  assert.equal(c.status, 200); assert.equal(c.body.analysis.reviewState, 'confirmed_by_reviewer')
  const h = c.body.analysis.reviews
  assert.deepEqual(h.map((x: { state: string }) => x.state), ['inconclusive', 'not_disaster_related', 'needs_review', 'confirmed_by_reviewer'])
  assert.equal(h[3].reviewedByName, 'Admin' === h[3].reviewedByName ? 'Admin' : h[3].reviewedByName); assert.ok(h[3].reviewedBy && h[3].createdAt && h[3].acknowledgedLimitations)
  assert.equal((await post(reviewRoute, '/x', { state: 'bogus' }, RESPONDER, ctx(id))).status, 400)
  assert.equal((await post(reviewRoute, '/x', { state: 'inconclusive', note: 'x'.repeat(1001) }, RESPONDER, ctx(id))).status, 400)
  assert.equal((await post(reviewRoute, '/x', { state: 'inconclusive' }, RESPONDER, ctx('00000000-0000-0000-0000-000000000000'))).status, 404)
})
test('review: confirming needs a real note and an acknowledgement of the limitations; unusable and failed analyses cannot be confirmed', async () => {
  setSatelliteProviders([fakeProvider()])
  const id = (await analyse()).body.analysis.id
  const r1 = await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer' }, RESPONDER, ctx(id)); assert.equal(r1.status, 400); assert.equal(r1.body.code, 'note_required')
  const r2 = await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'long enough note here' }, RESPONDER, ctx(id)); assert.equal(r2.status, 400); assert.equal(r2.body.code, 'ack_required')
  assert.equal((await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'long enough note here', acknowledgedLimitations: 'yes' }, RESPONDER, ctx(id))).status, 400)
  assert.equal((await j(await analysisRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(id)))).body.analysis.reviewState, 'needs_review', 'rejected attempts leave the state alone')
  // unusable: 92% of the after image is cloud, leaving ~8% usable
  setSatelliteProviders([fakeProvider({ load: (s, g) => { const l = require_floodPair(s, g); if (s.access?.role === 'after') for (let i = 0; i < l.flags.length; i++) if (i % 100 < 92) l.flags[i] = 2; return l } })])
  const u = (await analyse()).body.analysis
  assert.equal(u.quality.rating, 'unusable')
  assert.equal((await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'long enough note here', acknowledgedLimitations: true }, RESPONDER, ctx(u.id))).body.code, 'cannot_confirm_unusable')
  assert.equal((await post(reviewRoute, '/x', { state: 'inconclusive', note: 'too cloudy' }, RESPONDER, ctx(u.id))).status, 200)
  // failed
  setSatelliteProviders([fakeProvider({ load: () => { throw new ProviderError('unavailable', 'x', 503) } })])
  const f = (await analyse()).body.analysisId
  assert.equal((await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'long enough note here', acknowledgedLimitations: true }, RESPONDER, ctx(f))).body.code, 'cannot_confirm')
})

test('links: a finding can be attached to an incident report, a zone and a hazard; unknown records, repeats and failed runs are refused', async () => {
  setSatelliteProviders([fakeProvider()])
  const id = (await analyse()).body.analysis.id
  const store = getStore()
  const report = (await store.listReports({}))[0], zone = (await store.listZones({ includeHidden: true }))[0]
  assert.ok(report && zone, 'demo data has reports and zones')
  setRoutingDeps({ loadHazards: async () => ({ hazards: [{ id: 'route_hazards:H1' } as never], skipped: [], sources: [], loadedAt: new Date().toISOString() }) })
  const l1 = await post(linksRoute, '/x', { targetType: 'report', targetId: report.id, note: 'Same area as the flooding report' }, RESPONDER, ctx(id))
  assert.equal(l1.status, 201); assert.equal(l1.body.link.targetType, 'report'); assert.ok(l1.body.link.linkedByName && l1.body.link.createdAt)
  assert.equal((await post(linksRoute, '/x', { targetType: 'zone', targetId: zone.id }, ADMIN, ctx(id))).status, 201)
  assert.equal((await post(linksRoute, '/x', { targetType: 'hazard', targetId: 'route_hazards:H1' }, RESPONDER, ctx(id))).status, 201)
  assert.equal((await post(linksRoute, '/x', { targetType: 'report', targetId: report.id }, RESPONDER, ctx(id))).body.code, 'already_linked')
  assert.equal((await post(linksRoute, '/x', { targetType: 'report', targetId: 'no-such-report' }, RESPONDER, ctx(id))).body.code, 'target_not_found')
  assert.equal((await post(linksRoute, '/x', { targetType: 'hazard', targetId: 'route_hazards:NOPE' }, RESPONDER, ctx(id))).status, 404)
  assert.equal((await post(linksRoute, '/x', { targetType: 'dispatch', targetId: 'x' }, RESPONDER, ctx(id))).status, 400)
  const view = (await j(await analysisRoute.GET(call('/x', { as: RESPONDER }) as never, ctx(id)))).body.analysis
  assert.equal(view.links.length, 3)
  const byReport = await j(await analysesRoute.GET(call(`/api/satellite/analyses?targetType=report&targetId=${report.id}`, { as: RESPONDER }) as never))
  assert.deepEqual(byReport.body.analyses.map((a: { id: string }) => a.id), [id])
  assert.equal((await j(await analysesRoute.GET(call('/api/satellite/analyses?targetType=report&targetId=other', { as: RESPONDER }) as never))).body.analyses.length, 0)
  assert.equal((await j(await analysesRoute.GET(call('/api/satellite/analyses?targetType=bogus', { as: RESPONDER }) as never))).status, 400)
  setSatelliteProviders([fakeProvider({ load: () => { throw new ProviderError('unavailable', 'x', 503) } })])
  const failed = (await analyse()).body.analysisId
  assert.equal((await post(linksRoute, '/x', { targetType: 'report', targetId: report.id }, RESPONDER, ctx(failed))).body.code, 'cannot_link')
})

test('upload: two user GeoTIFFs are analysed end to end; declared metadata and licence confirmation are recorded; files are not stored', async () => {
  const bbox: [number, number, number, number] = [67, 24.8, 67.02, 24.82], W = 20, H = 20
  const bands = (water: boolean) => { const mk = (f: (c: number, r: number) => number) => { const a = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) a[r * W + c] = f(c, r); return a }; const lake = (c: number, r: number) => water && c >= 5 && c < 15 && r >= 5 && r < 15; return [mk((c, r) => (lake(c, r) ? 0.08 : 0.1)), mk((c, r) => (lake(c, r) ? 0.05 : 0.09)), mk((c, r) => (lake(c, r) ? 0.03 : 0.36)), mk((c, r) => (lake(c, r) ? 0.02 : 0.22))] }
  const declare = (date: string) => ({ kind: 'optical', platform: 'PlanetScope', acquiredAt: date, bands: ['green', 'red', 'nir', 'swir'], licenseConfirmed: true })
  const form = async (confirmed = true) => { const f = new FormData(); f.set('params', JSON.stringify({ provider: 'user-upload', collection: 'user-optical', aoi: { type: 'bbox', bbox }, uploads: { before: declare('2026-08-10'), after: { ...declare('2026-09-20'), licenseConfirmed: confirmed } } })); f.set('before', new File([await makeTiff(bbox, W, H, bands(false))], 'before.tif')); f.set('after', new File([await makeTiff(bbox, W, H, bands(true))], 'after.tif')); return f }
  const ok = await j(await analysesRoute.POST(call('/x', { method: 'POST', raw: await form(), as: RESPONDER }) as never))
  assert.equal(ok.status, 201, JSON.stringify(ok.body))
  const a = ok.body.analysis
  assert.equal(a.provider, 'user-upload'); assert.equal(a.before.declaredByUser, true); assert.match(a.uploadFingerprints.before, /^[0-9a-f]{64}$/); assert.notEqual(a.uploadFingerprints.before, a.uploadFingerprints.after)
  assert.ok(a.stats.classes[3].pixels > 0); assert.ok(a.quality.checks.some((c: { code: string }) => c.code === 'no_cloud_mask_before')); assert.ok(a.quality.checks.some((c: { code: string }) => c.code === 'declared_metadata_after'))
  assert.ok(!JSON.stringify(a).includes('"buffer"'))
  const refused = await j(await analysesRoute.POST(call('/x', { method: 'POST', raw: await form(false), as: RESPONDER }) as never))
  assert.equal(refused.status, 400); assert.equal(refused.body.code, 'license_not_confirmed')
  const f = new FormData(); f.set('params', JSON.stringify({ provider: 'user-upload', collection: 'user-optical', aoi: { type: 'bbox', bbox } }))
  assert.equal((await analysesRoute.POST(call('/x', { method: 'POST', raw: f, as: RESPONDER }) as never)).status, 400)
  assert.equal((await analysesRoute.POST(call('/x', { method: 'POST', raw: 'not json', headers: { 'content-type': 'application/json' }, as: RESPONDER }) as never)).status, 400)
})
test('demonstration mode: synthetic results are labelled everywhere and can never be confirmed', async () => {
  // Memory store = demo data mode, so the demonstration provider is available through the real registry.
  const s = await post(searchRoute, '/s', searchBody({ provider: 'demo' }))
  assert.equal(s.status, 200); assert.equal(s.body.synthetic, true); assert.equal(s.body.before[0].synthetic, true)
  const a = await analyse({ provider: 'demo', beforeSceneId: s.body.before[0].id, afterSceneId: s.body.after[0].id })
  assert.equal(a.status, 201, JSON.stringify(a.body))
  assert.equal(a.body.analysis.synthetic, true); assert.match(a.body.analysis.findings[0], /^DEMONSTRATION/); assert.ok(a.body.analysis.quality.checks.some((c: { code: string }) => c.code === 'synthetic_data'))
  assert.ok(a.body.analysis.stats.classes[3].pixels > 0, 'the synthetic flood is detected')
  const c = await post(reviewRoute, '/x', { state: 'confirmed_by_reviewer', note: 'trying to confirm demo data', acknowledgedLimitations: true }, RESPONDER, ctx(a.body.analysis.id))
  assert.equal(c.status, 409); assert.equal(c.body.code, 'cannot_confirm_synthetic')
})
import { floodPair as require_floodPair } from './satellite.helpers'
