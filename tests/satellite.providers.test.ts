// Provider layer: configuration states, invalid provider responses, unavailable imagery, real GeoTIFF reads, uploads.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fromArrayBuffer } from 'geotiff'
import { planetaryComputer } from '../src/lib/satellite/providers/planetaryComputer'
import { cdseSentinelHub } from '../src/lib/satellite/providers/cdse'
import { demoEnabled, demoProvider } from '../src/lib/satellite/providers/demo'
import { describeUpload, uploadProvider } from '../src/lib/satellite/providers/userUpload'
import { ProviderError, type ProviderDeps } from '../src/lib/satellite/providers/types'
import { makeGrid } from '../src/lib/satellite/raster/grid'
import { describeTiff, readBandOnGrid, transformFor } from '../src/lib/satellite/raster/geotiffIo'
import { AnalysisError } from '../src/lib/satellite/quality'
import { FLAG } from '../src/lib/satellite/types'
import { makeTiff, NOW } from './satellite.helpers'

const reply = (body: unknown, status = 200, raw = false) => new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let calls: { url: string; init?: RequestInit }[] = []
const deps = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ProviderDeps => ({
  fetch: (async (u: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(u), init }); return handler(String(u), init) }) as typeof fetch,
  openTiff: async () => { throw new Error('no network in tests') }, now: () => NOW,
})
beforeEach(() => { calls = [] })

const item = (id: string, over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => ({
  id, bbox: [66.9, 24.7, 67.2, 25.0], properties: { datetime: '2026-08-10T05:30:00Z', platform: 'Sentinel-2A', 'eo:cloud_cover': 12, 'proj:epsg': 32642, 's2:processing_baseline': '05.11', ...props },
  assets: { B03: { href: 'https://x/B03.tif' }, B04: { href: 'https://x/B04.tif' }, B08: { href: 'https://x/B08.tif' }, B11: { href: 'https://x/B11.tif' }, SCL: { href: 'https://x/SCL.tif' } }, ...over,
})
const REQ = { collection: 'sentinel-2-l2a' as const, bbox: [67, 24.8, 67.04, 24.84] as [number, number, number, number], start: '2026-08-01', end: '2026-08-20' }

test('Planetary Computer: parses scenes and keeps the original metadata as received', async () => {
  const p = planetaryComputer(deps(() => reply({ features: [item('S2-A')] })))
  const r = await p.search({ ...REQ, maxCloud: 40 })
  assert.equal(r.scenes.length, 1)
  const s = r.scenes[0]
  assert.equal(s.cloudCover, 12); assert.equal(s.crs, 'EPSG:32642'); assert.equal(s.platform, 'Sentinel-2A'); assert.equal(s.resolutionM, 10)
  assert.equal((s.original.properties as Record<string, unknown>)['eo:cloud_cover'], 12)
  assert.match(s.license, /open/i)
  const body = JSON.parse(String(calls[0].init?.body))
  assert.deepEqual(body.collections, ['sentinel-2-l2a']); assert.equal(body.query['eo:cloud_cover'].lte, 40); assert.match(body.datetime, /^2026-08-01T00:00:00Z\/2026-08-20T23:59:59Z$/)
})
test('Planetary Computer: unusable items are skipped and counted; items outside the date range are ignored', async () => {
  const feats = [item('ok'), item('no-date', {}, { datetime: 'garbage' }), item('bad-cloud', {}, { 'eo:cloud_cover': 250 }), item('str-cloud', {}, { 'eo:cloud_cover': 'lots' }), item('no-assets', { assets: {} }), null, 'junk', item('late', {}, { datetime: '2026-09-05T00:00:00Z' })]
  const r = await planetaryComputer(deps(() => reply({ features: feats }))).search(REQ)
  assert.deepEqual(r.scenes.map((s) => s.id), ['ok'])
  assert.equal(r.skipped, 6)
  assert.ok(r.notes.some((n) => /unusable/.test(n)) && r.notes.some((n) => /outside the requested dates/.test(n)))
})
test('Planetary Computer: invalid provider responses become clear errors, never crashes or fake empties', async () => {
  const cases: [Response, string, RegExp][] = [
    [reply('<html>oops</html>', 200, true), 'invalid_response', /not valid JSON/], [reply({ nope: 1 }), 'invalid_response', /not with a list/], [reply({ features: 'x' }), 'invalid_response', /not with a list/], [reply([]), 'invalid_response', /not with a list/],
    [reply({}, 500), 'unavailable', /HTTP 500/], [reply({}, 429), 'rate_limited', /rate limiting/], [reply({}, 401), 'auth_failed', /refused/], [reply({}, 404), 'not_found', /no such/],
  ]
  for (const [res, code, re] of cases) {
    await assert.rejects(planetaryComputer(deps(() => res.clone())).search(REQ), (e: unknown) => e instanceof ProviderError && e.code === code && re.test(e.message))
  }
  await assert.rejects(planetaryComputer(deps(() => { throw new TypeError('fetch failed') })).search(REQ), (e: unknown) => e instanceof ProviderError && e.code === 'unavailable' && /Could not reach/.test(e.message))
  await assert.rejects(planetaryComputer(deps(() => reply({ id: 'x', properties: {} }))).getScene('sentinel-2-l2a', 'x'), /missing required information/)
})
test('Planetary Computer: a provider that never answers times out instead of hanging', async () => {
  const slow = deps((_u, init) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
  const { httpJson } = await import('../src/lib/satellite/providers/types')
  await assert.rejects(httpJson(slow, 'https://x', {}, 30), (e: unknown) => e instanceof ProviderError && /did not answer in time/.test(e.message))
})
test('Planetary Computer: Sentinel-1 scenes carry orbit geometry; Landsat searches are limited to Landsat 8/9', async () => {
  const sar = { id: 'S1', bbox: [66.9, 24.7, 67.2, 25], properties: { datetime: '2026-08-10T01:00:00Z', platform: 'SENTINEL-1A', 'sat:orbit_state': 'descending', 'sat:relative_orbit': 12, 'sar:polarizations': ['VV', 'VH'] }, assets: { vv: { href: 'https://x/vv.tif' }, vh: { href: 'https://x/vh.tif' } } }
  const r = await planetaryComputer(deps(() => reply({ features: [sar] }))).search({ ...REQ, collection: 'sentinel-1' })
  assert.equal(r.scenes[0].orbitDirection, 'descending'); assert.equal(r.scenes[0].relativeOrbit, 12); assert.equal(r.scenes[0].cloudCover, null); assert.deepEqual(r.scenes[0].polarizations, ['VV', 'VH'])
  assert.equal(JSON.parse(String(calls[0].init?.body)).collections[0], 'sentinel-1-rtc')
  await planetaryComputer(deps(() => reply({ features: [] }))).search({ ...REQ, collection: 'landsat-c2-l2' })
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)).query.platform.in, ['landsat-8', 'landsat-9'])
})

test('CDSE: without credentials the provider says so and makes NO network request', async () => {
  const p = cdseSentinelHub(deps(() => reply({})), {} as unknown as NodeJS.ProcessEnv)
  const st = p.status()
  assert.equal(st.state, 'missing_credentials'); assert.deepEqual(st.missing, ['CDSE_CLIENT_ID', 'CDSE_CLIENT_SECRET']); assert.match(st.message, /Credentials missing/)
  await assert.rejects(p.search({ ...REQ }), (e: unknown) => e instanceof ProviderError && e.code === 'missing_credentials')
  assert.equal(calls.length, 0)
  assert.equal(cdseSentinelHub(deps(() => reply({})), { CDSE_CLIENT_ID: 'a' } as unknown as NodeJS.ProcessEnv).status().missing.join(), 'CDSE_CLIENT_SECRET')
})
test('CDSE: with credentials it signs in, searches the catalogue and reports bad sign-in and bad data', async () => {
  const env = { CDSE_CLIENT_ID: 'id', CDSE_CLIENT_SECRET: 'secret' } as unknown as NodeJS.ProcessEnv
  const good = deps((u) => (u.includes('openid-connect') ? reply({ access_token: 't0k', expires_in: 600 }) : reply({ features: [{ id: 'C1', bbox: [66.9, 24.7, 67.2, 25], properties: { datetime: '2026-08-10T05:30:00Z', platform: 'sentinel-2a', 'eo:cloud_cover': 3 } }] })))
  const r = await cdseSentinelHub(good, env).search(REQ)
  assert.equal(r.scenes[0].provider, 'cdse-sentinelhub')
  assert.equal(new Headers(calls[1].init?.headers).get('authorization'), 'Bearer t0k')
  assert.match(String(calls[0].init?.body), /client_credentials/)
  await assert.rejects(cdseSentinelHub(deps(() => reply({}, 401)), env).search(REQ), (e: unknown) => e instanceof ProviderError && e.code === 'auth_failed')
  await assert.rejects(cdseSentinelHub(deps(() => reply({ no_token: true })), env).search(REQ), /did not return an access token/)
  await assert.rejects(cdseSentinelHub(deps((u) => (u.includes('openid') ? reply({ access_token: 't' }) : reply({ features: 5 }))), env).search(REQ), /not with a list/)
  await assert.rejects(cdseSentinelHub(good, env).search({ ...REQ, collection: 'landsat-c2-l2' }), (e: unknown) => e instanceof ProviderError && e.code === 'unsupported')
})
test('CDSE: a Process API reply that is not a readable GeoTIFF, or the wrong size, is an invalid response', async () => {
  const env = { CDSE_CLIENT_ID: 'id', CDSE_CLIENT_SECRET: 'secret' } as unknown as NodeJS.ProcessEnv
  const g = makeGrid([67, 24.8, 67.01, 24.81], 10, 20)
  const sc = { id: 'C1', provider: 'cdse-sentinelhub' as const, collection: 'sentinel-2-l2a' as const, kind: 'optical' as const, platform: 'x', acquiredAt: '2026-08-10T05:30:00.000Z', resolutionM: 10, cloudCover: 1, footprintBbox: null, license: '', attribution: '', original: {} }
  const mk = (res: () => Response) => cdseSentinelHub(deps((u) => (u.includes('openid') ? reply({ access_token: 't' }) : res())), env)
  await assert.rejects(mk(() => new Response('not a tiff', { status: 200 })).load(sc, g), (e: unknown) => e instanceof ProviderError && e.code === 'invalid_response')
  const wrongSize = await makeTiff([67, 24.8, 67.01, 24.81], 3, 3, Array.from({ length: 7 }, () => new Float32Array(9)))
  await assert.rejects(mk(() => new Response(wrongSize, { status: 200 })).load(sc, g), /requested/)
  const wrongBands = await makeTiff([67, 24.8, 67.01, 24.81], g.width, g.height, Array.from({ length: 2 }, () => new Float32Array(g.width * g.height)))
  await assert.rejects(mk(() => new Response(wrongBands, { status: 200 })).load(sc, g), /expected bands/)
  await assert.rejects(mk(() => new Response('', { status: 429 })).load(sc, g), (e: unknown) => e instanceof ProviderError && e.code === 'rate_limited')
})
test('CDSE: a valid Process API reply is converted to bands and quality flags', async () => {
  const env = { CDSE_CLIENT_ID: 'id', CDSE_CLIENT_SECRET: 'secret' } as unknown as NodeJS.ProcessEnv
  const bbox: [number, number, number, number] = [67, 24.8, 67.01, 24.81], g = makeGrid(bbox, 10, 16), n = g.width * g.height
  const band = (v: number) => new Float32Array(n).fill(v)
  const scl = band(4); scl[0] = 9; scl[1] = 3; const mask = band(1); mask[2] = 0
  const tif = await makeTiff(bbox, g.width, g.height, [band(0.05), band(0.1), band(0.09), band(0.36), band(0.22), scl, mask])
  const p = cdseSentinelHub(deps((u) => (u.includes('openid') ? reply({ access_token: 't' }) : new Response(tif, { status: 200 }))), env)
  const l = await p.load({ id: 'C1', provider: 'cdse-sentinelhub', collection: 'sentinel-2-l2a', kind: 'optical', platform: 'x', acquiredAt: '2026-08-10T05:30:00.000Z', resolutionM: 10, cloudCover: 1, footprintBbox: null, license: '', attribution: '', original: {} }, g)
  assert.ok(l.flags[0] & FLAG.CLOUD); assert.ok(l.flags[1] & FLAG.SHADOW); assert.ok(l.flags[2] & FLAG.NODATA); assert.equal(l.flags[5], 0)
  assert.ok(Math.abs(l.bands.nir![5] - 0.36) < 1e-5); assert.ok(l.maskAvailable)
})

test('GeoTIFF read: values land on the right cells of the grid (north-up, WGS84)', async () => {
  const bbox: [number, number, number, number] = [67, 24.8, 67.02, 24.82], W = 20, H = 20
  const a = new Float32Array(W * H); for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) a[r * W + c] = c < 10 ? 1 : 2 // west half 1, east half 2
  for (const i of [0, 1, W, W + 1]) a[i] = 7 // north-west 2x2 block (the grid is coarser than the raster)
  const tiff = await fromArrayBuffer(await makeTiff(bbox, W, H, [a]))
  const g = makeGrid(bbox, 10, 10)
  const out = await readBandOnGrid(tiff, g, { resample: 'nearest' })
  assert.equal(out[0], 7, 'first cell is the north-west corner'); assert.equal(out[g.width - 1], 2, 'north-east is east half'); assert.equal(out[(g.height - 1) * g.width], 1, 'south-west is west half')
  assert.equal(out.filter((v) => Number.isNaN(v)).length, 0)
})
test('GeoTIFF read: a different (smaller) footprint leaves uncovered cells as NaN, and a disjoint AOI is refused', async () => {
  const tiff = await fromArrayBuffer(await makeTiff([67, 24.8, 67.01, 24.82], 10, 20, [new Float32Array(200).fill(5)]))
  const g = makeGrid([67, 24.8, 67.02, 24.82], 10, 10)
  const out = await readBandOnGrid(tiff, g, { resample: 'bilinear' })
  assert.ok(out.some((v) => v === 5) && out.some((v) => Number.isNaN(v)))
  await assert.rejects(readBandOnGrid(tiff, makeGrid([80, 10, 80.02, 10.02], 10, 10)), (e: unknown) => e instanceof AnalysisError && e.code === 'outside_footprint')
})
test('GeoTIFF read: nodata values, scale and offset are applied', async () => {
  const bbox: [number, number, number, number] = [67, 24.8, 67.02, 24.82]
  const a = new Float32Array(100).fill(2000); a[0] = -9999
  const tiff = await fromArrayBuffer(await makeTiff(bbox, 10, 10, [a], { nodata: -9999 }))
  const out = await readBandOnGrid(tiff, makeGrid(bbox, 10, 10), { resample: 'nearest', scale: 0.0001, offset: -0.1 })
  assert.ok(Number.isNaN(out[0])); assert.ok(Math.abs(out[50] - 0.1) < 1e-6)
})
test('GeoTIFF read: UTM rasters are reprojected onto the lon/lat grid', async () => {
  const xf = transformFor(32642)!, [x0, y0] = xf.fwd(66.995, 24.795), [x1, y1] = xf.fwd(67.025, 24.825)
  const W = 30, H = 30, a = new Float32Array(W * H).fill(3)
  const raw = await makeTiff([x0, y0, x1, y1], W, H, [a], { epsg: 32642 })
  // writeArrayBuffer stores a geographic key for the helper; patch the metadata path by describing with an override
  const tiff = await fromArrayBuffer(raw)
  const info = await describeTiff(tiff, 32642)
  assert.ok(Math.abs(info.bboxWgs84[0] - 66.995) < 1e-3 && Math.abs(info.bboxWgs84[3] - 24.825) < 1e-3)
  const out = await readBandOnGrid(tiff, makeGrid([67, 24.8, 67.02, 24.82], 10, 10), { resample: 'bilinear', epsg: 32642 })
  assert.ok(out.every((v) => Math.abs(v - 3) < 1e-4))
})
test('GeoTIFF read: unsupported coordinate systems are refused rather than misplaced', async () => {
  const tiff = await fromArrayBuffer(await makeTiff([0, 0, 1000, 1000], 10, 10, [new Float32Array(100)], { epsg: 3857 }))
  await assert.rejects(describeTiff(tiff), (e: unknown) => e instanceof AnalysisError && e.code === 'unsupported_crs')
})

const decl = (over: Record<string, unknown> = {}) => ({ kind: 'optical' as const, platform: 'PlanetScope', acquiredAt: '2026-08-10', bands: ['green', 'red', 'nir', 'swir'] as never, licenseConfirmed: true, ...over })
test('upload: metadata is recorded as declared, with a hash; the licence confirmation is mandatory', async () => {
  const buf = await makeTiff([67, 24.8, 67.02, 24.82], 10, 10, Array.from({ length: 4 }, () => new Float32Array(100)))
  const s = await describeUpload(buf, decl(), 'before.tif', NOW)
  assert.equal(s.declaredByUser, true); assert.equal(s.provider, 'user-upload'); assert.equal(s.collection, 'user-optical'); assert.match(String(s.original.sha256), /^[0-9a-f]{64}$/)
  assert.equal((s.original.declared as { platform: string }).platform, 'PlanetScope'); assert.match(s.crs!, /4326/)
  await assert.rejects(describeUpload(buf, decl({ licenseConfirmed: false }), 'a.tif', NOW), (e: unknown) => e instanceof AnalysisError && e.code === 'license_not_confirmed')
})
test('upload: bad declarations and unreadable files are rejected with a reason', async () => {
  const buf = await makeTiff([67, 24.8, 67.02, 24.82], 10, 10, Array.from({ length: 4 }, () => new Float32Array(100)))
  const bad: [Record<string, unknown>, RegExp][] = [[{ platform: '' }, /platform/], [{ acquiredAt: '2026-02-31' }, /real date/], [{ acquiredAt: '2027-01-01' }, /future/], [{ kind: 'x' }, /optical or radar/], [{ bands: ['green', 'green', 'red', 'nir'] }, /once/], [{ bands: ['vv', 'vh', 'red', 'nir'] }, /once/], [{ bands: ['green', 'red', 'nir'] }, /4 band/]]
  for (const [o, re] of bad) await assert.rejects(describeUpload(buf, decl(o), 'a.tif', NOW), (e: unknown) => e instanceof AnalysisError && re.test(e.message), JSON.stringify(o))
  await assert.rejects(describeUpload(new TextEncoder().encode('hello world').buffer as ArrayBuffer, decl(), 'a.tif', NOW), /could not be read as a GeoTIFF/)
})
test('upload: bands are read in the declared order and flagged "no cloud mask"; dB radar is converted to linear power', async () => {
  const bbox: [number, number, number, number] = [67, 24.8, 67.02, 24.82]
  const mk = (v: number) => new Float32Array(100).fill(v)
  const optical = await describeUpload(await makeTiff(bbox, 10, 10, [mk(0.1), mk(0.09), mk(0.36), mk(0.22)]), decl(), 'b.tif', NOW)
  const g = makeGrid(bbox, 10, 10), l = await uploadProvider().load(optical, g)
  assert.ok(Math.abs(l.bands.nir![0] - 0.36) < 1e-5 && Math.abs(l.bands.green![0] - 0.1) < 1e-5); assert.equal(l.maskAvailable, false)
  const radar = await describeUpload(await makeTiff(bbox, 10, 10, [mk(-10)]), { kind: 'sar', platform: 'X-band', acquiredAt: '2026-08-10', bands: ['vv'], sarUnit: 'db', licenseConfirmed: true }, 's.tif', NOW)
  assert.ok(Math.abs((await uploadProvider().load(radar, g)).bands.vv![0] - 0.1) < 1e-4)
  await assert.rejects(uploadProvider().search(REQ as never), /no catalogue/)
})
test('demo provider: disabled by default, clearly labelled and synthetic when on', async () => {
  assert.equal(demoEnabled({} as unknown as NodeJS.ProcessEnv), false); assert.equal(demoEnabled({ SATELLITE_DEMO_MODE: 'true' } as unknown as NodeJS.ProcessEnv), true); assert.equal(demoEnabled({} as unknown as NodeJS.ProcessEnv, 'demo'), true)
  const off = demoProvider(() => false)
  assert.equal(off.status().state, 'disabled'); await assert.rejects(off.search(REQ), /off/)
  const on = demoProvider(() => true)
  assert.equal(on.status().state, 'ready'); assert.match(on.status().name, /DEMONSTRATION/)
  const r = await on.search(REQ); assert.equal(r.scenes[0].synthetic, true); assert.match(r.scenes[0].license, /not real/i); assert.equal(r.scenes[0].platform, 'SYNTHETIC-DEMO')
  await assert.rejects(on.search({ ...REQ, collection: 'landsat-c2-l2' }), /Sentinel-2 style/)
})
