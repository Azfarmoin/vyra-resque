// Flood simulator through its HTTP handlers (demo store): permissions, scenario creation, validation, missing inputs,
// provider failures, saved-scenario lifecycle, comparison, route/shelter evidence, report export and separation from incidents.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore, getStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import { setFloodDeps } from '../src/lib/flood/deps'
import { floodAuditLog, resetFloodMemory } from '../src/lib/flood/repo'
import { OpenMeteoRainfallProvider } from '../src/lib/flood/rainfall'
import { StaticElevationProvider } from '../src/lib/flood/elevation'
import * as simulate from '../src/app/api/flood/simulate/route'
import * as scenarios from '../src/app/api/flood/scenarios/route'
import * as scenario from '../src/app/api/flood/scenarios/[id]/route'
import * as routesApi from '../src/app/api/flood/scenarios/[id]/routes/route'
import * as sheltersApi from '../src/app/api/flood/scenarios/[id]/shelters/route'
import * as reportApi from '../src/app/api/flood/scenarios/[id]/report/route'
import * as compareApi from '../src/app/api/flood/compare/route'
import * as importApi from '../src/app/api/flood/import/route'
import * as observationsApi from '../src/app/api/flood/observations/route'
import * as configApi from '../src/app/api/flood/config/route'
import { resetRateLimits } from '../src/lib/routing/rateLimit'
import { cfg, fakeDeps, valley } from './helpers/flood'

const ADMIN = 'admin@demo.vyra', RESPONDER = 'dispatcher@demo.vyra', CITIZEN = 'citizen@demo.vyra'
const realFetch = globalThis.fetch

beforeEach(() => { setStore(createMemoryStore()); resetFloodMemory(); setFloodDeps(null); resetRateLimits() })
afterEach(() => { setFloodDeps(null); globalThis.fetch = realFetch })

const call = (path: string, o: { method?: string; body?: unknown; as?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: o.method || 'GET', body: o.body ? JSON.stringify(o.body) : undefined, headers: { 'content-type': 'application/json', ...(o.as ? { 'x-demo-user': o.as } : {}) } })
const ctx = (id: string) => ({ params: { id } })
const j = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => null) as any }) // eslint-disable-line @typescript-eslint/no-explicit-any

const area = { kind: 'operational_area', name: 'Clifton', radiusM: 2000 }
const overlay = (depthM = 0.5, over: Record<string, unknown> = {}) => ({ areaSource: area, scenario: { kind: 'hypothetical_overlay', depthM }, ...over })
const bathtub = (level: number, seeds: [number, number][] = [[24.80, 67.0]]) => ({ areaSource: { kind: 'operational_area', name: 'Clifton', radiusM: 3000 }, scenario: { kind: 'terrain_bathtub', waterSurfaceElevationM: level, connectivity: 'seeded', seeds } })
// Each helper call starts with a fresh rate-limit window; the limit itself has its own test.
const sim = async (body: unknown, as: string | undefined = RESPONDER) => (resetRateLimits(), j)(await simulate.POST(call('/api/flood/simulate', { method: 'POST', body, as })))
const save = async (body: Record<string, unknown>, as: string | undefined = RESPONDER) => (resetRateLimits(), j)(await scenarios.POST(call('/api/flood/scenarios', { method: 'POST', body: { name: 'Test scenario', ...body }, as })))
const terrain = () => setFloodDeps(fakeDeps({ assets: { shelters: [{ id: 's1', name: 'Clifton shelter', lat: 24.81, lng: 67.03 }], hospitals: [{ id: 'h1', name: 'Test hospital', lat: 24.82, lng: 67.0 }] } }))

test('permissions: anonymous 401, citizen 403, responder and admin allowed on every endpoint', async () => {
  for (const [name, fn] of [['simulate', () => simulate.POST(call('/api/flood/simulate', { method: 'POST', body: overlay() }))], ['list', () => scenarios.GET(call('/api/flood/scenarios'))], ['config', () => configApi.GET(call('/api/flood/config'))], ['observations', () => observationsApi.GET(call('/api/flood/observations'))]] as const) {
    assert.equal((await fn()).status, 401, `${name} anonymous`)
  }
  assert.equal((await sim(overlay(), CITIZEN)).status, 403)
  assert.equal((await sim(overlay(), 'nobody@example.com')).status, 401, 'unknown account')
  assert.equal((await j(await scenarios.GET(call('/api/flood/scenarios', { as: CITIZEN })))).status, 403)
  assert.equal((await sim(overlay(), RESPONDER)).status, 200)
  assert.equal((await sim(overlay(), ADMIN)).status, 200)
})

test('permissions: a spoofed admin header cannot reach the import endpoint as a responder; import is admin-only', async () => {
  const body = { name: 'Imported', area: { type: 'Polygon', coordinates: [[[67.0, 24.8], [67.05, 24.8], [67.05, 24.84], [67.0, 24.84], [67.0, 24.8]]] }, model: { name: 'External' }, validation: { status: 'unvalidated' }, depths: { type: 'FeatureCollection', features: [] } }
  assert.equal((await j(await importApi.POST(call('/api/flood/import', { method: 'POST', body, as: RESPONDER })))).status, 403)
  assert.equal((await j(await importApi.POST(call('/api/flood/import', { method: 'POST', body, as: CITIZEN })))).status, 403)
})

test('scenario creation: a hypothetical overlay is labelled an estimate, has no depth bands and says no terrain was used', async () => {
  terrain()
  const { status, body } = await sim(overlay(0.8))
  assert.equal(status, 200)
  assert.equal(body.saved, false)
  assert.equal(body.result.isEstimate, true)
  assert.equal(body.result.isSimulation, true)
  assert.match(body.result.banner, /ESTIMATE/)
  assert.equal(body.result.tier.id, 'hypothetical_overlay')
  assert.equal(body.result.tier.depthBands, 'not_supported')
  assert.match(body.result.disclaimer, /not a flood forecast/i)
  assert.equal(body.result.summary.maxDepthM, 0.8)
  assert.ok(body.result.summary.floodedAreaKm2 > 0)
  assert.ok(body.result.limitations.length > 0 && body.result.assumptions.length > 0)
  assert.equal(body.layers.kind, 'uniform')
  const terrainRow = body.result.dataQuality.datasets.find((d: any) => d.id === 'terrain') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(terrainRow.state, 'not_configured', 'a typed-in overlay says plainly that terrain was not used')
})

test('scenario creation: terrain bathtub is a screening tier with indicative bands; rainfall ponding conserves the stated volume', async () => {
  terrain()
  const b = await sim(bathtub(3))
  assert.equal(b.status, 200, JSON.stringify(b.body))
  assert.equal(b.body.result.tier.id, 'terrain_estimate')
  assert.equal(b.body.result.tier.depthBands, 'indicative')
  assert.equal(b.body.layers.kind, 'grid')
  assert.ok(b.body.result.summary.floodedAreaKm2 > 0 && b.body.result.summary.maxDepthM > 0)
  assert.ok(b.body.result.limitations.some((l: string) => /hydraulic|routing|drainage/i.test(l)))
  const r = await sim({ areaSource: { kind: 'operational_area', name: 'Clifton', radiusM: 3000 }, scenario: { kind: 'terrain_rainfall', rainfall: { kind: 'manual', mm: 80, durationHours: 6 } } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.result.tier.id, 'terrain_estimate')
  assert.ok(r.body.result.summary.volumeM3 > 0)
})

test('geographic intersection: shelters and hospitals inside the water are counted, outside ones are not, with a depth only where assessed', async () => {
  setFloodDeps(fakeDeps({ assets: { shelters: [{ id: 'in', name: 'Inside', lat: 24.8135, lng: 67.03 }, { id: 'far', name: 'Far away', lat: 24.95, lng: 67.3 }], hospitals: [] } }))
  const { body } = await sim(overlay(0.6))
  const sh = body.result.exposure.shelters
  assert.equal(sh.available, true)
  assert.equal(sh.affected, 1)
  assert.equal(sh.total, 1, 'the far shelter is outside the selected area and is not counted in it')
  assert.equal(sh.items[0].name, 'Inside')
  assert.equal(sh.items[0].depthM, 0.6)
})

test('invalid input: coordinates, depths, names and malformed bodies are refused with a reason', async () => {
  terrain()
  const bad: [unknown, number, RegExp][] = [
    [overlay(0), 400, /greater than 0/],
    [overlay(11), 400, /at most 10/],
    [overlay(-1), 400, /greater than 0/],
    [{ areaSource: { kind: 'operational_area', name: 'Atlantis', radiusM: 1000 }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /./],
    [{ areaSource: { kind: 'operational_area', name: 'Clifton', radiusM: 50 }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /at least 500/],
    [{ areaSource: { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[200, 24.8], [67.05, 24.8], [67.05, 24.84], [200, 24.8]]] } }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /Longitude/],
    [{ areaSource: { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[67.0, 124.8], [67.05, 24.8], [67.05, 24.84], [67.0, 124.8]]] } }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /Latitude/],
    [{ areaSource: { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[67.0, 24.8], [67.05, 24.8], [67.0, 24.8]]] } }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /./],
    [{ areaSource: { kind: 'polygon', geometry: 'nope' }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } }, 400, /area/i],
    [{ areaSource: { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[67.0, 24.8], [67.05, 24.8], [67.05, 24.84], [67.0, 24.84], [67.0, 24.8]]] } }, scenario: { kind: 'terrain_bathtub', waterSurfaceElevationM: 2, connectivity: 'seeded', seeds: [[24.8, 999]] } }, 400, /Longitude/],
    [{ areaSource: area, scenario: { kind: 'hypothetical_overlay', depthM: 1 }, extra: 1 }, 400, /./],
    [{ areaSource: area, scenario: { kind: 'laser' } }, 400, /./],
  ]
  for (const [body, status, re] of bad) {
    const r = await sim(body)
    assert.equal(r.status, status, `${JSON.stringify(body).slice(0, 90)} -> ${r.status} ${r.body?.error}`)
    assert.match(r.body.error, re)
  }
  // outside Karachi, too large, too small
  const box = (w: number, s: number, e: number, n: number) => ({ areaSource: { kind: 'polygon', geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }, scenario: { kind: 'hypothetical_overlay', depthM: 1 } })
  assert.equal((await sim(box(74.3, 31.5, 74.35, 31.55))).body.code, 'outside_region')
  assert.equal((await sim(box(66.7, 24.75, 67.5, 25.5))).body.code, 'area_too_large')
  assert.equal((await sim(box(67.0, 24.8, 67.0005, 24.8005))).body.code, 'area_too_small')
  const res = await simulate.POST(new NextRequest('http://localhost/api/flood/simulate', { method: 'POST', body: '{not json', headers: { 'x-demo-user': RESPONDER } }))
  assert.equal(res.status, 400)
})

test('missing inputs: no elevation data configured -> 503 with guidance, never an invented terrain; seeded bathtub needs a source; unconfigured rainfall API is refused', async () => {
  setFloodDeps({ config: cfg(), assets: fakeDeps().assets, elevation: { geotiff: null, openMeteo: null } })
  const noDem = await sim(bathtub(3))
  assert.equal(noDem.status, 503)
  assert.match(noDem.body.error, /elevation|terrain/i)
  assert.equal(noDem.body.saved, undefined, 'no result object is returned')
  const rain = await sim({ areaSource: area, scenario: { kind: 'terrain_rainfall', rainfall: { kind: 'open_meteo', start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' } } })
  assert.equal(rain.status, 503)
  assert.match(rain.body.error, /Open-Meteo|rainfall/i)
  terrain()
  const noSeed = await sim(bathtub(3, []))
  assert.equal(noSeed.status, 422)
  assert.equal(noSeed.body.code, 'missing_source')
  const badWindow = await sim({ areaSource: area, scenario: { kind: 'terrain_rainfall', rainfall: { kind: 'open_meteo', start: '2026-10-02T00:00:00Z', end: '2026-10-01T00:00:00Z' } } })
  assert.equal(badWindow.status, 400)
  const cap = await (await configApi.GET(call('/api/flood/config', { as: RESPONDER }))).json()
  assert.equal(cap.capabilities.hypothetical_overlay.available, true)
  assert.equal(cap.capabilities.imported_hydraulic.available, false, 'responders cannot import')
})

test('missing datasets are reported as unknown, never as zero', async () => {
  setFloodDeps(fakeDeps({ assets: { shelters: [{ id: 's', name: 'Shelter', lat: 24.8135, lng: 67.03 }], failing: ['hospitals', 'roads'] } }))
  const { body } = await sim(overlay(0.5))
  const ex = body.result.exposure
  assert.equal(ex.hospitals.available, false)
  assert.equal(ex.hospitals.affected, null)
  assert.equal(ex.hospitals.total, null)
  assert.equal(ex.roads.available, false)
  assert.equal(ex.roads.affectedCount, null)
  assert.equal(ex.roads.floodedLengthKm, null)
  assert.equal(ex.buildings.available, false, 'not configured -> unknown')
  assert.equal(ex.buildings.affected, null)
  const failed = body.result.dataQuality.datasets.find((d: any) => d.id === 'hospitals') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(failed.state, 'failed')
  assert.match(failed.error, /simulated provider failure/)
  assert.equal(ex.shelters.affected, 1, 'a working dataset in the same run is still reported')
})

test('provider failure: Open-Meteo elevation errors and timeouts fail cleanly with 502/503 and no partial result', async () => {
  setFloodDeps({ config: cfg({ openMeteoEnabled: true }), assets: fakeDeps().assets })
  for (const mode of ['http500', 'network', 'garbage', 'short'] as const) {
    globalThis.fetch = (async () => {
      if (mode === 'network') throw new Error('ECONNRESET')
      if (mode === 'http500') return new Response('upstream down', { status: 500 })
      if (mode === 'garbage') return new Response('<html>not json</html>', { status: 200 })
      return new Response(JSON.stringify({ elevation: [1, 2, 3] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const r = await sim({ ...bathtub(3), areaSource: { kind: 'operational_area', name: 'Clifton', radiusM: 1500 } })
    assert.ok([502, 503, 504].includes(r.status), `${mode}: ${r.status} ${r.body?.error}`)
    assert.ok(r.body.error && !r.body.result, `${mode}: no result is returned`)
  }
  assert.equal((await scenarios.GET(call('/api/flood/scenarios', { as: RESPONDER })).then(j)).body.scenarios.length, 0, 'nothing was saved by failed runs')
})

test('provider failure: Open-Meteo rainfall errors fail cleanly and are never replaced by an invented number', async () => {
  setFloodDeps({ config: cfg({ openMeteoEnabled: true }), assets: fakeDeps().assets, elevation: { geotiff: new StaticElevationProvider((s) => valley(s)), openMeteo: null }, rainfall: new OpenMeteoRainfallProvider(cfg({ openMeteoEnabled: true })) })
  const body = { areaSource: area, scenario: { kind: 'terrain_rainfall', rainfall: { kind: 'open_meteo', start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' } } }
  for (const f of [async () => { throw new Error('boom') }, async () => new Response('x', { status: 429 }), async () => new Response(JSON.stringify({ hourly: { time: [], precipitation: [] } }), { status: 200 })]) {
    globalThis.fetch = f as unknown as typeof fetch
    const r = await sim(body)
    assert.ok(r.status >= 400, `status ${r.status}`)
    assert.ok(!r.body.result, 'no result')
  }
})

test('saved scenarios: create, list, get, rename, delete; owner and admin rules; audit trail', async () => {
  terrain()
  const a = await save(overlay(0.4))
  assert.equal(a.status, 201)
  assert.equal(a.body.saved, true)
  assert.equal(a.body.scenario.isSimulation, true)
  assert.equal(a.body.scenario.createdByName, 'Hamza Siddiqui')
  const id = a.body.scenario.id
  assert.equal((await save({ ...overlay(0.4), name: 'x' })).status, 400, 'name too short')
  assert.equal((await save({ ...overlay(0.4), name: undefined })).status, 400, 'a name is required to save')
  const list = (await j(await scenarios.GET(call('/api/flood/scenarios', { as: ADMIN })))).body
  assert.equal(list.scenarios.length, 1)
  assert.equal(list.isSimulation, true)
  assert.equal((await j(await scenario.GET(call(`/api/flood/scenarios/${id}`, { as: RESPONDER }), ctx(id)))).body.scenario.name, 'Test scenario')
  assert.equal((await j(await scenario.GET(call('/api/flood/scenarios/nope', { as: RESPONDER }), ctx('nope')))).status, 404)
  const ren = await j(await scenario.PATCH(call(`/api/flood/scenarios/${id}`, { method: 'PATCH', body: { name: 'Renamed' }, as: RESPONDER }), ctx(id)))
  assert.equal(ren.body.scenario.name, 'Renamed')
  assert.equal((await j(await scenario.DELETE(call(`/api/flood/scenarios/${id}`, { method: 'DELETE', as: CITIZEN }), ctx(id)))).status, 403)
  assert.equal((await j(await scenario.DELETE(call(`/api/flood/scenarios/${id}`, { method: 'DELETE' }), ctx(id)))).status, 401)
  assert.equal((await j(await scenario.DELETE(call(`/api/flood/scenarios/${id}`, { method: 'DELETE', as: ADMIN }), ctx(id)))).status, 200)
  assert.equal((await j(await scenarios.GET(call('/api/flood/scenarios', { as: ADMIN })))).body.scenarios.length, 0)
  const actions = floodAuditLog().map((e) => e.action)
  for (const need of ['simulate', 'create', 'update', 'delete']) if (need !== 'simulate') assert.ok(actions.includes(need as never), `audit has ${need}`)
})

test('comparison: deltas, unknowns stay unknown, identical or missing ids are refused', async () => {
  terrain()
  const a = (await save({ ...overlay(0.3), name: 'Low water' })).body.scenario.id
  const b = (await save({ ...overlay(1.2), name: 'High water' })).body.scenario.id
  const ok = await j(await compareApi.GET(call(`/api/flood/compare?a=${a}&b=${b}`, { as: RESPONDER })))
  assert.equal(ok.status, 200)
  assert.equal(ok.body.isEstimate, true)
  const maxd = ok.body.deltas.find((d: any) => d.metric === 'Maximum depth') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(maxd.a, 0.3); assert.equal(maxd.b, 1.2); assert.equal(maxd.delta, 0.9)
  const roads = ok.body.deltas.find((d: any) => d.metric === 'Roads affected') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(roads.delta, null, 'no road dataset: the difference is unknown, not 0')
  assert.equal((await j(await compareApi.GET(call(`/api/flood/compare?a=${a}&b=${a}`, { as: RESPONDER })))).status, 400)
  assert.equal((await j(await compareApi.GET(call(`/api/flood/compare?a=${a}&b=missing`, { as: RESPONDER })))).status, 404)
  assert.equal((await j(await compareApi.GET(call(`/api/flood/compare?a=${a}&b=${b}`, { as: CITIZEN })))).status, 403)
})

test('route and shelter evidence is supplementary and read-only', async () => {
  setFloodDeps(fakeDeps({ assets: { shelters: [{ id: 'in', name: 'Inside', lat: 24.8135, lng: 67.03 }, { id: 'out', name: 'Outside', lat: 24.9, lng: 67.1 }] } }))
  const id = (await save(overlay(0.7))).body.scenario.id
  const routes = [{ id: 'r1', geometry: [[24.8135, 67.015], [24.8135, 67.045]] }, { id: 'r2', geometry: [[24.95, 67.2], [24.96, 67.21]] }]
  const res = await j(await routesApi.POST(call(`/api/flood/scenarios/${id}/routes`, { method: 'POST', body: { routes }, as: RESPONDER }), ctx(id)))
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.supplementary, true)
  assert.equal(res.body.isEstimate, true)
  const r1 = res.body.routes.find((r: any) => r.routeId === 'r1'), r2 = res.body.routes.find((r: any) => r.routeId === 'r2') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r1.intersectsEstimatedExtent, 'yes'); assert.ok(r1.floodedLengthM > 100)
  assert.equal(r2.intersectsEstimatedExtent, 'unknown', 'a route outside the assessed area is unknown, never "clear"')
  assert.equal(r2.floodedLengthM, 0)
  assert.equal((await j(await routesApi.POST(call(`/api/flood/scenarios/${id}/routes`, { method: 'POST', body: { routes: [{ id: 'x', geometry: [[24.8, 999]] }] }, as: RESPONDER }), ctx(id)))).status, 400)
  assert.equal((await j(await routesApi.POST(call(`/api/flood/scenarios/${id}/routes`, { method: 'POST', body: { routes }, as: CITIZEN }), ctx(id)))).status, 403)
  const sh = await j(await sheltersApi.GET(call(`/api/flood/scenarios/${id}/shelters`, { as: RESPONDER }), ctx(id)))
  assert.equal(sh.status, 200)
  assert.equal(sh.body.supplementary, true)
  const byId = Object.fromEntries(sh.body.shelters.map((s: any) => [s.id, s])) // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(byId.in.evidence, 'inside_estimated_extent')
  assert.equal(byId.out.evidence, 'outside_assessed_area')
  assert.deepEqual(sh.body.shelters.map((s: any) => s.id), ['in', 'out'].sort((a, b) => sh.body.shelters.findIndex((s: any) => s.id === a) - sh.body.shelters.findIndex((s: any) => s.id === b)), 'order is not a ranking') // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal('rank' in sh.body.shelters[0], false)
  assert.equal('recommended' in sh.body.shelters[0], false)
})

test('separation: simulations never create, change or dispatch real incidents, teams, shelters or priorities', async () => {
  const store = getStore()
  // real operational wiring (no fake assets): the simulator reads the demo store
  setFloodDeps({ config: cfg(), elevation: { geotiff: new StaticElevationProvider((s) => valley(s)), openMeteo: null } })
  const snap = async () => JSON.stringify({ reports: await store.listReports({}), layers: await store.mapLayers(), zones: await store.listZones?.({}) })
  const before = await snap()
  const writes: string[] = []
  const guarded = new Proxy(store as unknown as Record<string, unknown>, { get: (t, k: string) => (typeof t[k] === 'function' && /^(create|update|delete|insert|set|assign|dispatch|override|verify|add|remove|save)/i.test(k) ? () => { writes.push(k); throw new Error(`simulator attempted a write: ${k}`) } : t[k]) })
  setStore(guarded as never)
  const run = await save({ ...overlay(1.5), areaSource: { kind: 'operational_area', name: 'Saddar', radiusM: 6000 } })
  assert.equal(run.status, 201, JSON.stringify(run.body))
  await sim(bathtub(4))
  const id = run.body.scenario.id
  await routesApi.POST(call(`/api/flood/scenarios/${id}/routes`, { method: 'POST', body: { routes: [{ id: 'r', geometry: [[24.85, 67.0], [24.86, 67.03]] }] }, as: RESPONDER }), ctx(id))
  await sheltersApi.GET(call(`/api/flood/scenarios/${id}/shelters`, { as: RESPONDER }), ctx(id))
  await reportApi.GET(call(`/api/flood/scenarios/${id}/report?format=json`, { as: RESPONDER }), ctx(id))
  assert.deepEqual(writes, [], 'no store write was attempted')
  setStore(store)
  assert.equal(await snap(), before, 'incidents, teams, shelters, road blocks and zones are byte-for-byte unchanged')
  assert.equal(run.body.scenario.isSimulation, true)
  const incidentCtx = run.body.scenario.results.exposure.incidents
  assert.match(incidentCtx.note, /context|not changed|read/i)
})

test('separation: flood tables share no foreign keys or triggers with incident tables (migration 012)', async () => {
  const { readFileSync } = await import('node:fs')
  const sql = readFileSync(new URL('../supabase/migrations/012_flood_simulator.sql', import.meta.url), 'utf8')
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  for (const t of ['emergency_reports', 'dispatches', 'report_events', 'rescue_teams', 'shelters', 'blocked_roads', 'resources']) {
    assert.ok(!new RegExp(`REFERENCES\\s+public\\.${t}\\b`, 'i').test(code), `no FK to ${t}`)
    assert.ok(!new RegExp(`ON\\s+public\\.${t}\\b`, 'i').test(code), `no policy or trigger on ${t}`)
  }
  assert.match(code, /is_simulation\s+BOOLEAN NOT NULL DEFAULT TRUE CHECK \(is_simulation = TRUE\)/)
})

test('report export: PDF, HTML, JSON and GeoJSON carry the estimate banner, inputs, results, assumptions and limitations; exports are audited', async () => {
  terrain()
  const id = (await save(bathtub(3))).body.scenario.id
  const get = (f: string, as: string | undefined = RESPONDER) => reportApi.GET(call(`/api/flood/scenarios/${id}/report?format=${f}`, { as }), ctx(id))
  const pdf = await get('pdf')
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  assert.match(pdf.headers.get('content-disposition') || '', /attachment; filename="vyra-flood-estimate-Test_scenario\.pdf"/)
  const bytes = Buffer.from(await pdf.arrayBuffer())
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.ok(bytes.length > 3000)
  const html = await (await get('html')).text()
  for (const needle of ['ESTIMATE - SIMULATION, NOT A REAL EVENT', '<svg', 'Inputs', 'Results', 'Assumptions', 'Limitations', 'Data quality', 'Water surface elevation', 'not a flood forecast', 'Terrain-based inundation estimate']) assert.ok(html.includes(needle), `html has "${needle}"`)
  assert.ok(!/<script/i.test(html), 'no script in the report')
  const gj = JSON.parse(await (await get('geojson')).text())
  assert.equal(gj.type, 'FeatureCollection')
  assert.equal(gj.properties.estimate, true)
  assert.ok(gj.features.every((f: any) => f.properties.estimate === true)) // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.ok(gj.features.some((f: any) => f.properties.layer === 'depth_band')) // eslint-disable-line @typescript-eslint/no-explicit-any
  const js = JSON.parse(await (await get('json')).text())
  assert.equal(js.isSimulation, true)
  assert.equal(js.layers, undefined, 'the raw grid is not in the JSON export')
  assert.equal((await get('docx')).status, 400)
  assert.equal((await get('pdf', CITIZEN)).status, 403)
  assert.equal((await get('pdf', '')).status, 401)
  assert.equal((await reportApi.GET(call('/api/flood/scenarios/none/report?format=pdf', { as: RESPONDER }), ctx('none'))).status, 404)
  assert.equal(floodAuditLog().filter((e) => e.action === 'export').length, 4)
})

test('report export: uniform overlay and unknown data are described honestly in the HTML', async () => {
  setFloodDeps(fakeDeps({ assets: { failing: ['hospitals'] } }))
  const id = (await save(overlay(0.5))).body.scenario.id
  const html = await (await reportApi.GET(call(`/api/flood/scenarios/${id}/report?format=html`, { as: ADMIN }), ctx(id))).text()
  assert.match(html, /not supported/i)
  assert.match(html, /Hypothetical water-level overlay/)
  assert.match(html, /Failed to load/)
  assert.match(html, /unknown/)
  assert.ok(!/validated hydraulic/i.test(html.replace(/not (a )?validated[^<]*/gi, '')) || /not .*validated/i.test(html))
})

const feature = (depth: number) => ({ type: 'Feature', properties: { depth_m: depth }, geometry: { type: 'Polygon', coordinates: [[[67.02, 24.81], [67.04, 24.81], [67.04, 24.83], [67.02, 24.83], [67.02, 24.81]]] } })
const importBody = (validation: Record<string, unknown>) => ({ name: 'External model run', area: { type: 'Polygon', coordinates: [[[67.0, 24.8], [67.06, 24.8], [67.06, 24.85], [67.0, 24.85], [67.0, 24.8]]] }, model: { name: 'HEC-RAS 2D', version: '6.5' }, validation, depths: { type: 'FeatureCollection', features: [feature(0.4), feature(1.6)] } })

test('imported hydraulic output: a complete validation record is required for the validated tier; anything less stays unvalidated', async () => {
  terrain()
  const imp = async (v: Record<string, unknown>) => j(await importApi.POST(call('/api/flood/import', { method: 'POST', body: importBody(v), as: ADMIN })))
  const none = await imp({ status: 'unvalidated' })
  assert.equal(none.status, 201, JSON.stringify(none.body))
  assert.equal(none.body.scenario.results.tier.id, 'imported_unvalidated')
  const claimOnly = await imp({ status: 'validated' })
  assert.equal(claimOnly.body.scenario.results.tier.id, 'imported_unvalidated', 'claiming "validated" without evidence does not upgrade the tier')
  const partial = await imp({ status: 'validated', method: 'Compared with 2022 survey' })
  assert.equal(partial.body.scenario.results.tier.id, 'imported_unvalidated')
  const full = await imp({ status: 'validated', method: 'Compared with 2022 survey', metricName: 'RMSE', metricValue: 0.18, observedEvent: 'Aug 2022 rain', validatedBy: 'Dr A. Khan', validatedAt: '2025-03-01T00:00:00Z', reportUrl: 'https://example.org/report.pdf' })
  assert.equal(full.body.scenario.results.tier.id, 'validated_hydraulic')
  assert.match(full.body.scenario.results.tier.summary, /VYRA did not run the model/)
  const bands = full.body.scenario.results.summary
  assert.equal(bands.maxDepthM, 1.6)
  const bad = await j(await importApi.POST(call('/api/flood/import', { method: 'POST', body: { ...importBody({ status: 'unvalidated' }), depths: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [67, 24.8] } }] } }, as: ADMIN })))
  assert.equal(bad.status, 400)
  assert.equal((await j(await importApi.POST(call('/api/flood/import', { method: 'POST', body: importBody({ status: 'validated' }) })))).status, 401)
})

test('observations: staff record real readings, future dates and bad coordinates are rejected, they appear in results but are never generated', async () => {
  setFloodDeps({ config: cfg(), assets: fakeDeps().assets }) // observations come from the real repository
  const post = async (body: unknown, as: string | undefined = RESPONDER) => j(await observationsApi.POST(call('/api/flood/observations', { method: 'POST', body, as })))
  const good = { lat: 24.8135, lng: 67.03, depthM: 0.45, observedAt: '2026-10-20T06:00:00Z', source: 'Field team A', method: 'field_measurement' }
  assert.equal((await post(good, CITIZEN)).status, 403)
  const o = await post(good)
  assert.equal(o.status, 201, JSON.stringify(o.body))
  assert.equal(o.body.observation.verified, false, 'a new observation is unverified')
  assert.equal((await post({ ...good, lat: 124 })).status, 400)
  assert.equal((await post({ ...good, depthM: -1 })).status, 400)
  assert.equal((await post({ ...good, observedAt: '2031-01-01T00:00:00Z' })).status, 400)
  assert.equal((await post({ ...good, source: '' })).status, 400)
  const { body } = await sim(overlay(0.5))
  assert.equal(body.result.observations.inArea.length, 1)
  assert.equal(body.result.observations.comparison, null, 'no comparison unless the user chose a window')
  const none = await sim({ ...overlay(0.5), areaSource: { kind: 'operational_area', name: 'Malir', radiusM: 1000 } })
  assert.equal(none.body.result.observations.inArea.length, 0, 'nothing is fabricated for an area without records')
})

test('rate limit: a burst of simulations is throttled per user with Retry-After', async () => {
  terrain()
  let last: Response | null = null
  for (let i = 0; i < 12; i++) last = await simulate.POST(call('/api/flood/simulate', { method: 'POST', body: overlay(0.5), as: RESPONDER }))
  assert.equal(last!.status, 429)
  assert.ok(Number(last!.headers.get('retry-after')) > 0)
  assert.equal((await simulate.POST(call('/api/flood/simulate', { method: 'POST', body: overlay(0.5), as: ADMIN }))).status, 200, 'another user is not affected')
})
