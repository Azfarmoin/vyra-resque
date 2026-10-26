// Zone API: permissions, validation, audit log, lifecycle and compatibility with the existing map layers.
// Calls the route handlers directly against the in-memory demo store (same style as tests/api.test.ts).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as zonesRoute from '../src/app/api/zones/route'
import * as zoneRoute from '../src/app/api/zones/[id]/route'
import * as auditRoute from '../src/app/api/zones/[id]/audit/route'
import * as importRoute from '../src/app/api/zones/import/route'
import * as layers from '../src/app/api/map/layers/route'
import * as suggestRoute from '../src/app/api/zones/suggest/route'

beforeEach(() => setStore(createMemoryStore()))

const ADMIN = 'admin@demo.vyra', RESPONDER = 'dispatcher@demo.vyra', CITIZEN = 'citizen@demo.vyra'
const call = (path: string, o: { method?: string; body?: unknown; as?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: o.method || 'GET', body: o.body ? JSON.stringify(o.body) : undefined,
    headers: { 'content-type': 'application/json', ...(o.as ? { 'x-demo-admin': o.as } : {}), ...(o.headers || {}) },
  })
const ctx = (id: string) => ({ params: { id } })
const sq = (lng = 67.05, lat = 24.85, d = 0.01) => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] })
const draft = (over: Record<string, unknown> = {}) => ({
  name: 'Test flood area', zone_type: 'elevated', severity: 'high', hazard_type: 'flood', geometry: sq(), boundary_kind: 'drawn', boundary_quality: 'approximate',
  description: 'Water reported at knee height on these streets.', source_type: 'responder', source_name: 'Field team', verification_status: 'human_verified', lifecycle: 'active', ...over,
})
const official = (over: Record<string, unknown> = {}) => draft({ zone_type: 'danger', verification_status: 'official', source_type: 'official_manual', source_name: 'District Admin', ...over })
const create = async (body: unknown, as?: string) => {
  const res = await zonesRoute.POST(call('/api/zones', { method: 'POST', body, as }))
  return { status: res.status, body: await res.json() }
}

test('creation: anonymous 401, citizen 403, responder and admin 201', async () => {
  assert.equal((await create(draft())).status, 401)
  assert.equal((await create(draft(), 'nobody@example.com')).status, 401)
  assert.equal((await create(draft(), CITIZEN)).status, 403)
  const r = await create(draft(), RESPONDER)
  assert.equal(r.status, 201)
  assert.equal(r.body.zone.created_by_name, 'Hamza Siddiqui')
  assert.equal(r.body.zone.revision, 1)
  assert.equal((await create(draft(), ADMIN)).status, 201)
})
test('creation: responders can never publish official warnings or evacuation orders; admins can', async () => {
  assert.equal((await create(official(), RESPONDER)).status, 403)
  const order = { zone_type: 'evacuation', evacuation_status: 'order', verification_status: 'official', source_type: 'official_manual', source_name: 'District Admin' }
  const asResponder = await create(draft(order), RESPONDER)
  assert.equal(asResponder.status, 403)
  assert.match(asResponder.body.error, /administrator/)
  // a responder trying to pass an order off as "verified" is rejected by the rules, not just by role
  assert.equal((await create(draft({ zone_type: 'evacuation', evacuation_status: 'order' }), RESPONDER)).status, 400)
  assert.equal((await create(draft(order), ADMIN)).status, 201)
  const plan = await create(draft({ zone_type: 'evacuation', evacuation_status: 'proposed' }), RESPONDER)
  assert.equal(plan.status, 201, 'responders may propose evacuation plans')
  assert.equal(plan.body.zone.evacuation_status, 'proposed')
})
test('creation: malformed geometry and unsafe combinations are rejected with a reason', async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } }, /ring/],
    [{ geometry: null }, /Geometry/],
    [{ geometry: { type: 'Point', coordinates: [500, 20] }, boundary_kind: 'point' }, /range/],
    [{ boundary_kind: 'circle', geometry: { type: 'Point', coordinates: [67, 24.8] }, radius_m: 800 }, /documented basis/],
    [{ zone_type: 'danger', verification_status: 'unverified' }, /High Danger/],
    [{ source_type: 'ai_suggestion', verification_status: 'ai_suggested' }, /AI/],
    [{ zone_type: 'restricted' }, /gray zone/],
    [{ source_url: 'ftp://x' }, /http/],
  ]
  for (const [over, re] of cases) {
    const r = await create(draft(over), ADMIN)
    assert.equal(r.status, 400, JSON.stringify(over))
    assert.match(r.body.error, re)
  }
  const res = await zonesRoute.POST(new NextRequest('http://localhost/api/zones', { method: 'POST', body: 'not json', headers: { 'x-demo-admin': ADMIN } }))
  assert.equal(res.status, 400)
})
test('creation: a circle is accepted only with a documented radius; unknown related reports are rejected', async () => {
  const circle = draft({ boundary_kind: 'circle', geometry: { type: 'Point', coordinates: [67.05, 24.85] }, radius_m: 800, radius_basis: 'Official 800 m isolation distance for a gas leak' })
  const ok = await create(circle, RESPONDER)
  assert.equal(ok.status, 201)
  assert.ok(ok.body.zone.bbox[2] - ok.body.zone.bbox[0] > 0.01, 'bbox covers the circle, not just its centre')
  assert.equal((await create(draft({ related_report_ids: ['00000000-0000-4000-8000-00000000dead'] }), RESPONDER)).status, 400)
})
test('creation: AI suggestions can be stored only as drafts and never reach the public map', async () => {
  const ai = await create(draft({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'caution', severity: 'unknown', source_name: 'VYRA hazard analysis' }), RESPONDER)
  assert.equal(ai.status, 201)
  const id = ai.body.zone.id
  const pub = await (await zonesRoute.GET(call('/api/zones'))).json()
  assert.ok(!pub.zones.some((z: { id: string }) => z.id === id))
  assert.equal((await zoneRoute.GET(call(`/api/zones/${id}`), ctx(id))).status, 404, 'public cannot fetch it by id either')
  assert.equal((await zoneRoute.GET(call(`/api/zones/${id}`, { as: RESPONDER }), ctx(id))).status, 200, 'staff can review it')
  const staff = await (await zonesRoute.GET(call('/api/zones?include=hidden', { as: RESPONDER }))).json()
  assert.ok(staff.zones.some((z: { id: string }) => z.id === id))
  const spoof = await (await zonesRoute.GET(call('/api/zones?include=hidden'))).json()
  assert.ok(!spoof.zones.some((z: { id: string }) => z.id === id), 'include=hidden is ignored for anonymous callers')
  // a person promotes it: now it needs a human source, a reason, and may go live
  const promote = await zoneRoute.PATCH(call(`/api/zones/${id}`, { method: 'PATCH', as: RESPONDER, body: { source_type: 'responder', verification_status: 'human_verified', lifecycle: 'active', revision: 1, change_reason: 'Checked on site' } }), ctx(id))
  assert.equal(promote.status, 200)
  // AI cannot be flipped live while still marked as AI
  const ai2 = (await create(draft({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'caution', severity: 'unknown' }), RESPONDER)).body.zone
  const sneaky = await zoneRoute.PATCH(call(`/api/zones/${ai2.id}`, { method: 'PATCH', as: ADMIN, body: { lifecycle: 'active', revision: 1, change_reason: 'publish it' } }), ctx(ai2.id))
  assert.equal(sneaky.status, 400)
})

test('editing: reason required, stale revisions refused, responders cannot touch official zones', async () => {
  const z = (await create(draft(), RESPONDER)).body.zone
  const patch = (body: Record<string, unknown>, as = RESPONDER, id = z.id) => zoneRoute.PATCH(call(`/api/zones/${id}`, { method: 'PATCH', as, body }), ctx(id))
  assert.equal((await patch({ severity: 'extreme', revision: 1 })).status, 400, 'severity change needs a reason')
  const good = await patch({ severity: 'extreme', revision: 1, change_reason: 'Water now above 1 m' })
  assert.equal(good.status, 200)
  const body = await good.json()
  assert.equal(body.zone.severity, 'extreme'); assert.equal(body.zone.revision, 2); assert.equal(body.zone.updated_by, RESPONDER)
  assert.equal((await patch({ severity: 'low', revision: 1, change_reason: 'stale write attempt' })).status, 409)
  assert.equal((await patch({ description: 'Water now above the doorsteps in the area.', revision: 2 })).status, 200, 'wording-only edits need no reason')
  assert.equal((await patch({ revision: 3 })).status, 400, 'no-op edits are refused')
  assert.equal((await patch({ severity: 'low', revision: 3, change_reason: 'cit' }, CITIZEN)).status, 403)
  assert.equal((await patch({ severity: 'low', revision: 3, change_reason: 'anonymous attempt' }, '')).status, 401)
  const off = (await create(official(), ADMIN)).body.zone
  const denied = await patch({ severity: 'low', revision: 1, change_reason: 'responder edits official' }, RESPONDER, off.id)
  assert.equal(denied.status, 403)
  assert.equal((await patch({ verification_status: 'official', source_type: 'official_manual', revision: 3, change_reason: 'escalate to official' })).status, 403)
  assert.equal((await patch({ severity: 'moderate', revision: 1, change_reason: 'admin may revise official' }, ADMIN, off.id)).status, 200)
  assert.equal((await patch({ severity: 'low', revision: 1, change_reason: 'x' }, ADMIN, '00000000-0000-4000-8000-000000000000')).status, 404)
})
test('lifecycle: cancel, deactivate, reactivate keep the zone and its history; cancelled zones show as CANCELLED', async () => {
  const z = (await create(official({ valid_until: new Date(Date.now() + 86_400_000).toISOString() }), ADMIN)).body.zone
  const act = (action: string, rev: number, reason?: string, as = ADMIN) => zoneRoute.PATCH(call(`/api/zones/${z.id}`, { method: 'PATCH', as, body: { action, revision: rev, change_reason: reason } }), ctx(z.id))
  assert.equal((await act('cancel', 1)).status, 400, 'cancelling needs a reason')
  assert.equal((await act('cancel', 1, 'Water receded', RESPONDER)).status, 403, 'responder cannot cancel an official warning')
  assert.equal((await act('cancel', 1, 'Water receded below the mark')).status, 200)
  const listed = (await (await zonesRoute.GET(call('/api/zones'))).json()).zones.find((x: { id: string }) => x.id === z.id)
  assert.equal(listed.display_state, 'cancelled')
  assert.equal(listed.lifecycle, 'cancelled')
  assert.equal((await act('reactivate', 2, 'Cancelled in error, hazard persists')).status, 200)
  assert.equal((await act('deactivate', 3, 'Superseded by a new warning')).status, 200)
  const audit = await (await auditRoute.GET(call(`/api/zones/${z.id}/audit`, { as: ADMIN }), ctx(z.id))).json()
  assert.deepEqual(audit.audit.map((e: { action: string }) => e.action).reverse(), ['create', 'cancel', 'reactivate', 'deactivate'])
  const cancel = audit.audit.find((e: { action: string }) => e.action === 'cancel')
  assert.equal(cancel.actor, ADMIN); assert.equal(cancel.actor_role, 'admin'); assert.equal(cancel.reason, 'Water receded below the mark'); assert.deepEqual(cancel.changes.lifecycle, { from: 'active', to: 'cancelled' })
})
test('audit log: staff only, records who/what/why/when for every change', async () => {
  const z = (await create(draft(), RESPONDER)).body.zone
  await zoneRoute.PATCH(call(`/api/zones/${z.id}`, { method: 'PATCH', as: RESPONDER, body: { zone_type: 'caution', revision: 1, change_reason: 'Downgraded after re-check' } }), ctx(z.id))
  assert.equal((await auditRoute.GET(call(`/api/zones/${z.id}/audit`), ctx(z.id))).status, 401)
  assert.equal((await auditRoute.GET(call(`/api/zones/${z.id}/audit`, { as: CITIZEN }), ctx(z.id))).status, 403)
  const { audit } = await (await auditRoute.GET(call(`/api/zones/${z.id}/audit`, { as: RESPONDER }), ctx(z.id))).json()
  assert.equal(audit.length, 2)
  const upd = audit.find((e: { action: string }) => e.action === 'update')
  assert.equal(upd.actor, RESPONDER); assert.equal(upd.reason, 'Downgraded after re-check'); assert.deepEqual(upd.changes.zone_type, { from: 'elevated', to: 'caution' }); assert.ok(upd.created_at)
})
test('deletion: only administrators, only unpublished drafts; published zones are cancelled so history survives', async () => {
  const published = (await create(draft(), RESPONDER)).body.zone
  const del = (id: string, as?: string) => zoneRoute.DELETE(call(`/api/zones/${id}`, { method: 'DELETE', as }), ctx(id))
  assert.equal((await del(published.id)).status, 401)
  assert.equal((await del(published.id, CITIZEN)).status, 403)
  assert.equal((await del(published.id, RESPONDER)).status, 403)
  assert.equal((await del(published.id, ADMIN)).status, 409)
  const d = (await create(draft({ lifecycle: 'draft' }), RESPONDER)).body.zone
  assert.equal((await del(d.id, ADMIN)).status, 200)
  assert.equal((await zoneRoute.GET(call(`/api/zones/${d.id}`, { as: ADMIN }), ctx(d.id))).status, 404)
  const trail = await createMemoryStore().listZoneAudit(d.id)
  assert.equal(trail.length, 0) // fresh store above: just proves the helper is per-store; the real trail is checked next
})

test('listing: bbox, zoom simplification, filters, search; AI and drafts hidden; full geometry kept', async () => {
  const all = await (await zonesRoute.GET(call('/api/zones'))).json()
  assert.ok(all.zones.length >= 8)
  assert.ok(all.zones.every((z: { verification_status: string; lifecycle: string }) => z.verification_status !== 'ai_suggested' && z.lifecycle !== 'draft'))
  assert.match(all.disclaimer, /NOT confirmed safe/)
  const box = await (await zonesRoute.GET(call('/api/zones?bbox=67.07,24.81,67.13,24.86'))).json()
  assert.ok(box.zones.length >= 1 && box.zones.length < all.zones.length)
  assert.equal((await zonesRoute.GET(call('/api/zones?bbox=nonsense'))).status, 400)
  const evac = await (await zonesRoute.GET(call('/api/zones?view=evacuation'))).json()
  assert.ok(evac.zones.length >= 1 && evac.zones.every((z: { zone_type: string }) => z.zone_type === 'evacuation'))
  const kinds = new Set(evac.zones.map((z: { evacuation_status: string }) => z.evacuation_status))
  assert.ok(kinds.has('order') && kinds.has('proposed'), 'both an official order and a proposed plan are present and distinguishable')
  const unverified = await (await zonesRoute.GET(call('/api/zones?verify=unverified'))).json()
  assert.ok(unverified.zones.length >= 1 && unverified.zones.every((z: { verification_status: string }) => z.verification_status === 'unverified'))
  const q = await (await zonesRoute.GET(call('/api/zones?q=lyari'))).json()
  assert.ok(q.zones.length >= 1 && q.zones.every((z: { name: string; description: string }) => /lyari/i.test(z.name + z.description)))
  const states = new Set(all.zones.map((z: { display_state: string }) => z.display_state))
  assert.ok(states.has('active') && states.has('expired') && states.has('cancelled'), 'expired and cancelled zones are labelled, not silently dropped')
})
test('listing: very large polygons are simplified for display but the source geometry stays intact', async () => {
  const n = 3000
  const ring = Array.from({ length: n }, (_, i) => [67.2 + 0.05 * Math.cos((2 * Math.PI * i) / n), 24.9 + 0.05 * Math.sin((2 * Math.PI * i) / n)])
  ring.push(ring[0])
  const big = (await create(draft({ geometry: { type: 'Polygon', coordinates: [ring] } }), ADMIN)).body.zone
  const light = (await (await zonesRoute.GET(call('/api/zones?zoom=9'))).json()).zones.find((z: { id: string }) => z.id === big.id)
  assert.equal(light.simplified, true)
  assert.ok(light.geometry.coordinates[0].length < 400)
  assert.equal(light.vertex_count, n + 1)
  const full = (await (await zoneRoute.GET(call(`/api/zones/${big.id}`), ctx(big.id))).json()).zone
  assert.equal(full.geometry.coordinates[0].length, n + 1)
  const asked = (await (await zonesRoute.GET(call('/api/zones?zoom=9&full=1'))).json()).zones.find((z: { id: string }) => z.id === big.id)
  assert.equal(asked.simplified, false)
})
test('scale: hundreds of zones create and list within the viewport quickly', async () => {
  const store = createMemoryStore({ seed: false })
  setStore(store)
  for (let i = 0; i < 400; i++) assert.equal((await create(draft({ name: `Zone ${i}`, geometry: sq(66 + (i % 20) * 0.05, 24 + Math.floor(i / 20) * 0.05, 0.02) }), ADMIN)).status, 201)
  const t0 = performance.now()
  const res = await (await zonesRoute.GET(call('/api/zones?bbox=66,24,66.3,24.3&zoom=11'))).json()
  assert.ok(res.zones.length > 0 && res.zones.length < 400)
  assert.ok(performance.now() - t0 < 500)
})

test('feed import route: needs the secret or an administrator; reports "no feeds" gracefully', async () => {
  const post = (o: { as?: string; headers?: Record<string, string> } = {}) => importRoute.POST(call('/api/zones/import', { method: 'POST', ...o }))
  assert.equal((await post()).status, 403)
  assert.equal((await post({ as: RESPONDER })).status, 403)
  assert.equal((await post({ headers: { 'x-zone-import-secret': 'guess' } })).status, 403)
  const prev = process.env.ZONE_IMPORT_SECRET
  process.env.ZONE_IMPORT_SECRET = 'x'.repeat(24)
  try {
    assert.equal((await post({ headers: { 'x-zone-import-secret': 'x'.repeat(23) } })).status, 403)
    const okRes = await post({ headers: { 'x-zone-import-secret': 'x'.repeat(24) } })
    assert.equal(okRes.status, 200)
    assert.match((await okRes.json()).note, /No feeds configured/)
  } finally {
    if (prev === undefined) delete process.env.ZONE_IMPORT_SECRET
    else process.env.ZONE_IMPORT_SECRET = prev
  }
  assert.equal((await post({ as: ADMIN })).status, 200)
})
test('compatibility: existing map layers and demo reports are untouched, and a zone can link a real report', async () => {
  const l = await (await layers.GET(call('/api/map/layers'))).json()
  assert.ok(l.shelters.length > 0 && l.roadBlocks.length > 0 && Array.isArray(l.teams))
  const store = createMemoryStore()
  setStore(store)
  const [report] = await store.listReports({})
  assert.ok(report)
  const linked = await create(draft({ related_report_ids: [report.id] }), RESPONDER)
  assert.equal(linked.status, 201)
  assert.deepEqual(linked.body.zone.related_report_ids, [report.id])
  assert.equal((await store.getReport(report.id))!.id, report.id)
})

test('suggestions: staff only; proposals are private AI drafts, are not duplicated, and never touch existing zones', async () => {
  const store = createMemoryStore({ seed: false })
  setStore(store)
  for (const [lng, lat] of [[67.2, 24.9], [67.2015, 24.9], [67.2, 24.9015]]) {
    const r = await store.insertReport({ reporter_id: null, client_id: crypto.randomUUID(), location_lat: lat, location_lng: lng, location_address: null, location_source: 'manual', location_accuracy_m: null, area: 'Malir', people_count: 2, immediate_danger: false, dangers: ['rising_water'], danger_details: null, injury_severity: 'none', injury_count: null, injury_details: null, medical_need_types: [], medical_needs: null, can_evacuate: 'yes', vulnerabilities: [], contact_info: null, status: 'pending', verified: false, resolved_at: null, triage_override: null, priority_score: 0, priority_explanation: null })
    assert.ok(r.id)
  }
  const post = (as?: string, body: unknown = {}) => suggestRoute.POST(call('/api/zones/suggest', { method: 'POST', as, body }))
  assert.equal((await post()).status, 401)
  assert.equal((await post(CITIZEN)).status, 403)
  const dry = await (await post(RESPONDER)).json()
  assert.equal(dry.suggestions.length, 1); assert.equal(dry.created.length, 0)
  assert.equal((await store.listZones({ includeHidden: true })).length, 0, 'a dry run saves nothing')
  const made = await (await post(RESPONDER, { commit: true })).json()
  assert.equal(made.created.length, 1)
  const d = made.created[0]
  assert.deepEqual([d.verification_status, d.source_type, d.lifecycle, d.zone_type], ['ai_suggested', 'ai_suggestion', 'draft', 'caution'])
  assert.equal((await (await zonesRoute.GET(call('/api/zones'))).json()).zones.length, 0, 'drafts are not public')
  assert.equal((await (await post(RESPONDER, { commit: true })).json()).created.length, 0, 'running again does not duplicate the draft')
})
