// Zone rules, geometry, clustering, feeds and offline snapshots. Pure logic: needs no Next.js, Supabase or browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areaKm2, bboxOfGeometry, circleBBox, closeRing, geometryErrors, labelPoint, parseBBox, pointInZone, simplifyGeometry, toleranceForZoom } from '../src/lib/zones/geometry'
import { clusterPoints, labelPriority, placeLabels } from '../src/lib/zones/cluster'
import {
  diffZone, displayState, freshnessOf, isPubliclyVisible, matchesSearch, matchesVerify, matchesView, needsReason, validateZoneInput, writeDenial, ZONE_STYLES, GRACE_MS,
} from '../src/lib/zones/rules'
import { featureToZone, loadFeedConfigs, markFeedFailure, reconcileFeed, importFeed, type FeedConfig, type FeedFeature, type ImportStore } from '../src/lib/zones/feeds'
import { EMPTY_SNAPSHOT, mergeSnapshot, uncoveredFraction } from '../src/lib/zones/snapshot'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import type { DisasterZone, ZoneGeometry } from '../src/lib/zones/types'

const square = (lng: number, lat: number, d = 0.01): ZoneGeometry => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] })
const base = (over: Record<string, unknown> = {}) => ({
  name: 'Test zone', zone_type: 'elevated', severity: 'high', hazard_type: 'flood', geometry: square(67, 24.8), boundary_kind: 'drawn', boundary_quality: 'approximate',
  description: 'Water is rising along the street.', source_type: 'responder', source_name: 'Field team', verification_status: 'human_verified', lifecycle: 'active', ...over,
})
const ok = (over?: Record<string, unknown>) => { const r = validateZoneInput(base(over)); assert.ok(r.ok, r.errors.join(' | ')); return r.value! }
const bad = (over: Record<string, unknown>, fragment: RegExp) => {
  const r = validateZoneInput(base(over))
  assert.equal(r.ok, false, 'should have been rejected')
  assert.ok(r.errors.some((e) => fragment.test(e)), `expected /${fragment}/ in: ${r.errors.join(' | ')}`)
}

// ---------------- geometry ----------------
test('geometry: valid shapes pass, malformed ones are described, never thrown', () => {
  assert.deepEqual(geometryErrors(square(67, 24.8)), [])
  assert.deepEqual(geometryErrors({ type: 'Point', coordinates: [67, 24.8] }), [])
  assert.deepEqual(geometryErrors({ type: 'LineString', coordinates: [[67, 24], [67.1, 24.1]] }), [])
  for (const g of [null, undefined, 'x', {}, { type: 'Polygon' }, { type: 'Circle', coordinates: [] }, { type: 'Point', coordinates: [200, 10] }, { type: 'Point', coordinates: [10, 95] }, { type: 'Point', coordinates: ['a', 'b'] }, { type: 'Point', coordinates: [NaN, 1] }, { type: 'LineString', coordinates: [[1, 1]] }, { type: 'Polygon', coordinates: [] }, { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }]) {
    assert.ok(geometryErrors(g).length > 0, `expected errors for ${JSON.stringify(g)}`)
  }
})
test('geometry: open rings, bow-ties and repeated points are rejected; closeRing repairs only openness', () => {
  assert.match(geometryErrors({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })[0], /not closed/)
  assert.match(geometryErrors({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] })[0], /crosses itself/)
  assert.match(geometryErrors({ type: 'Polygon', coordinates: [[[0, 0], [0, 0], [1, 0], [1, 1], [0, 0]]] })[0], /repeated/)
  const open: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  assert.deepEqual(geometryErrors({ type: 'Polygon', coordinates: [closeRing(open)] }), [])
  assert.deepEqual(closeRing(closeRing(open)), closeRing(open))
})
test('geometry: bbox, circle bbox, parseBBox, area, containment', () => {
  const bb = bboxOfGeometry(square(67, 24.8))
  assert.deepEqual([bb[0], bb[1]], [67, 24.8])
  assert.ok(Math.abs(bb[2] - 67.01) < 1e-9 && Math.abs(bb[3] - 24.81) < 1e-9)
  const cb = circleBBox([67, 24.8], 1000)
  assert.ok(cb[0] < 67 && cb[2] > 67 && cb[1] < 24.8 && cb[3] > 24.8)
  assert.deepEqual(parseBBox('1,2,3,4'), [1, 2, 3, 4])
  for (const b of ['', 'a,b,c,d', '1,2,3', '3,2,1,4', '1,-91,3,4', null]) assert.equal(parseBBox(b as string), null)
  const km2 = areaKm2(square(67, 24.8, 0.01))!
  assert.ok(km2 > 0.9 && km2 < 1.2, `~1 km2 expected, got ${km2}`)
  assert.equal(pointInZone([67.005, 24.805], square(67, 24.8)), true)
  assert.equal(pointInZone([67.5, 24.805], square(67, 24.8)), false)
  assert.equal(pointInZone([67.001, 24.8], { type: 'Point', coordinates: [67, 24.8] }, 500), true)
  assert.equal(pointInZone([67.1, 24.8], { type: 'Point', coordinates: [67, 24.8] }, 500), false)
  assert.equal(pointInZone([67, 24.8], { type: 'Point', coordinates: [67, 24.8] }, null), false, 'no radius = no area')
  const outer = (square(0, 0, 10) as Extract<ZoneGeometry, { type: 'Polygon' }>).coordinates[0]
  const hole: ZoneGeometry = { type: 'Polygon', coordinates: [outer, [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] }
  assert.equal(pointInZone([5, 5], hole), false)
  assert.equal(pointInZone([1, 1], hole), true)
})
test('geometry: label point stays inside concave polygons', () => {
  const c: ZoneGeometry = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [9, 10], [9, 1], [1, 1], [1, 10], [0, 10], [0, 0]]] }
  assert.equal(pointInZone(labelPoint(c), c), true)
})
test('geometry: simplification lightens the display copy and preserves valid closed rings and the original', () => {
  const n = 2000
  const ring: [number, number][] = Array.from({ length: n }, (_, i) => [67 + 0.05 * Math.cos((2 * Math.PI * i) / n) + (i % 2) * 1e-7, 24.8 + 0.05 * Math.sin((2 * Math.PI * i) / n)])
  ring.push(ring[0])
  const g: ZoneGeometry = { type: 'Polygon', coordinates: [ring] }
  const before = JSON.stringify(g)
  const s = simplifyGeometry(g, toleranceForZoom(10))
  assert.equal(JSON.stringify(g), before, 'source geometry untouched')
  assert.ok(s.type === 'Polygon' && s.coordinates[0].length < 300 && s.coordinates[0].length >= 4)
  assert.deepEqual(s.type === 'Polygon' && s.coordinates[0][0], s.type === 'Polygon' && s.coordinates[0].at(-1))
  const small = square(0, 0)
  assert.equal(simplifyGeometry(small, 1), small, 'small shapes are returned as-is')
})

// ---------------- validation / safety rules ----------------
test('rules: a complete, valid zone is accepted and normalised', () => {
  const v = ok({ name: '  Padded  ', extra: 'dropped' })
  assert.equal(v.name, 'Padded')
  assert.equal('extra' in v, false)
  assert.ok(v.valid_from)
})
test('rules: red danger needs official or person-verified information', () => {
  bad({ zone_type: 'danger', verification_status: 'unverified' }, /red High Danger/)
  ok({ zone_type: 'danger', verification_status: 'human_verified' })
  ok({ zone_type: 'danger', verification_status: 'official', source_type: 'official_manual' })
})
test('rules: green shelter zones must be verified; gray zones must explain their status', () => {
  bad({ zone_type: 'shelter', verification_status: 'unverified' }, /verified shelter/)
  bad({ zone_type: 'restricted' }, /exact status of a gray zone/)
  bad({ zone_type: 'restricted', status_detail: 'too short' }, /exact status/)
  ok({ zone_type: 'restricted', status_detail: 'Road closed by police; the extent is not yet surveyed.' })
})
test('rules: blue zones state order vs plan; only official information can be an order', () => {
  bad({ zone_type: 'evacuation' }, /official evacuation order or a proposed plan/)
  bad({ zone_type: 'evacuation', evacuation_status: 'order' }, /Only official information can be an evacuation order/)
  ok({ zone_type: 'evacuation', evacuation_status: 'proposed' })
  ok({ zone_type: 'evacuation', evacuation_status: 'order', verification_status: 'official', source_type: 'official_manual' })
  bad({ zone_type: 'caution', evacuation_status: 'proposed' }, /only applies to evacuation/)
})
test('rules: circles need a justified radius; no invented circles', () => {
  const pt = { type: 'Point', coordinates: [67, 24.8] }
  bad({ boundary_kind: 'circle', geometry: pt }, /radius between/)
  bad({ boundary_kind: 'circle', geometry: pt, radius_m: 500 }, /documented basis/)
  bad({ boundary_kind: 'circle', geometry: pt, radius_m: 500, radius_basis: 'because' }, /documented basis/)
  bad({ boundary_kind: 'circle', geometry: pt, radius_m: -5, radius_basis: 'Official 5 km radius' }, /radius between/)
  bad({ boundary_kind: 'circle', geometry: square(67, 24.8), radius_m: 500, radius_basis: 'Official 500 m warning radius' }, /centre point/)
  bad({ radius_m: 500 }, /only allowed for circle/)
  const c = ok({ boundary_kind: 'circle', geometry: pt, radius_m: 500, radius_basis: 'Official 500 m isolation distance' })
  assert.equal(c.radius_m, 500)
})
test('rules: boundary kind must match the geometry; malformed geometry is rejected with a reason', () => {
  bad({ geometry: { type: 'Point', coordinates: [67, 24.8] } }, /polygon boundary/)
  bad({ boundary_kind: 'road', geometry: square(67, 24.8) }, /must use a line/)
  bad({ geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] } }, /ring/)
  bad({ geometry: undefined }, /Geometry is missing/)
  bad({ geometry: { type: 'Point', coordinates: [999, 999] } }, /within range/)
  ok({ boundary_kind: 'road', geometry: { type: 'LineString', coordinates: [[67, 24.8], [67.01, 24.81]] }, hazard_type: 'infrastructure' })
})
test('rules: official needs an official source and an authority name; AI can only suggest', () => {
  bad({ verification_status: 'official' }, /official source/)
  bad({ verification_status: 'official', source_type: 'official_manual', source_name: '' }, /Name the authority/)
  bad({ source_type: 'official_manual' }, /Official verification status/)
  bad({ source_type: 'ai_suggestion', verification_status: 'ai_suggested' }, /stay drafts/)
  bad({ source_type: 'ai_suggestion', verification_status: 'human_verified', lifecycle: 'draft' }, /together/)
  bad({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'danger' }, /red High Danger/)
  bad({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'evacuation', evacuation_status: 'order' }, /evacuation order/)
  bad({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'shelter' }, /verified shelter/)
  ok({ source_type: 'ai_suggestion', verification_status: 'ai_suggested', lifecycle: 'draft', zone_type: 'caution', severity: 'unknown' })
})
test('rules: dates, urls, text limits', () => {
  bad({ valid_from: '2026-01-02T00:00:00Z', valid_until: '2026-01-01T00:00:00Z' }, /after the start/)
  bad({ valid_until: 'tomorrow-ish' }, /not a valid date/)
  bad({ source_url: 'javascript:alert(1)' }, /http/)
  bad({ name: 'ab' }, /Name must be/)
  bad({ description: 'short' }, /Describe/)
  bad({ zone_type: 'purple' }, /zone type/)
  assert.equal(validateZoneInput(null).ok, false)
  assert.equal(validateZoneInput('x').ok, false)
})

// ---------------- permissions ----------------
test('permissions: who may write what', () => {
  const v = ok()
  const official = ok({ verification_status: 'official', source_type: 'official_manual' })
  const order = ok({ zone_type: 'evacuation', evacuation_status: 'order', verification_status: 'official', source_type: 'official_manual' })
  const plan = ok({ zone_type: 'evacuation', evacuation_status: 'proposed' })
  assert.match(writeDenial(null, v)!, /Sign in/)
  assert.match(writeDenial('citizen', v)!, /Only responders and administrators/)
  assert.equal(writeDenial('responder', v), null)
  assert.equal(writeDenial('responder', plan), null, 'responders may PROPOSE evacuations')
  assert.match(writeDenial('responder', official)!, /administrator can publish official/)
  assert.match(writeDenial('responder', order)!, /administrator can publish official|evacuation order/)
  assert.match(writeDenial('responder', { ...v, evacuation_status: 'order', verification_status: 'human_verified' })!, /evacuation order/)
  assert.equal(writeDenial('admin', official), null)
  assert.equal(writeDenial('admin', order), null)
  // editing an existing official zone
  assert.match(writeDenial('responder', v, { verification_status: 'official', source_type: 'official_manual', evacuation_status: null })!, /administrator can change/)
  assert.match(writeDenial('responder', v, { verification_status: 'human_verified', source_type: 'responder', evacuation_status: 'order' })!, /administrator can change/)
  assert.equal(writeDenial('responder', v, { verification_status: 'unverified', source_type: 'responder', evacuation_status: null }), null)
})
test('permissions: important changes need a recorded reason', () => {
  const a = { ...base(), id: 'x' } as unknown as DisasterZone
  const sevChange = diffZone(a, { ...a, severity: 'low' })
  assert.deepEqual(Object.keys(sevChange), ['severity'])
  assert.equal(needsReason(sevChange), true)
  assert.equal(needsReason(diffZone(a, { ...a, lifecycle: 'cancelled' })), true)
  assert.equal(needsReason(diffZone(a, { ...a, description: 'Other words here, fine.' })), false)
  assert.deepEqual(diffZone(a, { ...a, updated_at: 'now', revision: 9 }), {})
})

// ---------------- lifecycle / visibility / freshness ----------------
const zone = (over: Partial<DisasterZone> = {}): DisasterZone => ({
  ...(ok() as unknown as DisasterZone), id: 'z1', bbox: [67, 24.8, 67.01, 24.81], revision: 1, external_id: null, feed_id: null, source_updated_at: null, created_by: null, created_by_name: null, updated_by: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), valid_from: new Date(Date.now() - 10 * GRACE_MS).toISOString(), ...over,
})
test('lifecycle: expiry is derived from valid_until; cancelled and expired zones stay visible (labelled) for 24 h only', () => {
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  assert.equal(displayState(zone({ valid_until: iso(now + 1000) }), now), 'active')
  assert.equal(displayState(zone({ valid_until: iso(now - 1000) }), now), 'expired')
  assert.equal(displayState(zone({ valid_from: iso(now + 5000) }), now), 'upcoming')
  assert.equal(displayState(zone({ lifecycle: 'cancelled' }), now), 'cancelled')
  assert.equal(isPubliclyVisible(zone({ valid_until: iso(now - 3_600_000) }), now), true)
  assert.equal(isPubliclyVisible(zone({ valid_until: iso(now - GRACE_MS - 1000) }), now), false)
  assert.equal(isPubliclyVisible(zone({ lifecycle: 'cancelled', updated_at: iso(now - 60_000) }), now), true)
  assert.equal(isPubliclyVisible(zone({ lifecycle: 'cancelled', updated_at: iso(now - GRACE_MS - 5000) }), now), false)
  assert.equal(isPubliclyVisible(zone({ lifecycle: 'draft' }), now), false)
  assert.equal(isPubliclyVisible(zone({ verification_status: 'ai_suggested', source_type: 'ai_suggestion', lifecycle: 'active' }), now), false, 'AI suggestions are never public even if mis-stored as active')
})
test('freshness: old data and failed feeds are flagged, never shown as current', () => {
  const now = Date.now()
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString()
  assert.equal(freshnessOf(zone({ updated_at: ago(0.1) }), undefined, now).level, 'fresh')
  assert.equal(freshnessOf(zone({ updated_at: ago(8) }), undefined, now).level, 'aging')
  assert.equal(freshnessOf(zone({ updated_at: ago(30) }), undefined, now).level, 'stale')
  const feed = { feed_id: 'f', name: 'F', last_attempt_at: ago(0.5), last_success_at: ago(5), last_error: 'Feed answered 503', zones_seen: 3, stale_after_minutes: 120 }
  const fz = zone({ feed_id: 'f', updated_at: ago(0.1) })
  assert.equal(freshnessOf(fz, feed, now).level, 'stale')
  assert.equal(freshnessOf(fz, { ...feed, last_success_at: ago(0.2) }, now).level, 'aging')
  assert.equal(freshnessOf(fz, { ...feed, last_success_at: ago(0.2), last_error: null }, now).level, 'fresh')
})

// ---------------- filters, styles ----------------
test('filters: views, verification and search', () => {
  const flood = zone({ hazard_type: 'flood' }), fire = zone({ hazard_type: 'fire', zone_type: 'danger' }), quake = zone({ hazard_type: 'earthquake' })
  const evac = zone({ zone_type: 'evacuation', evacuation_status: 'proposed' }), shelter = zone({ zone_type: 'shelter' })
  const road = zone({ boundary_kind: 'road', geometry: { type: 'LineString', coordinates: [[67, 24.8], [67.1, 24.9]] } })
  assert.equal(matchesView(flood, 'floodfire'), true); assert.equal(matchesView(fire, 'floodfire'), true); assert.equal(matchesView(quake, 'floodfire'), false)
  assert.equal(matchesView(evac, 'evacuation'), true); assert.equal(matchesView(flood, 'evacuation'), false)
  assert.equal(matchesView(shelter, 'shelters'), true); assert.equal(matchesView(shelter, 'hazard'), false)
  assert.equal(matchesView(road, 'roads'), true); assert.equal(matchesView(flood, 'roads'), false)
  assert.equal(matchesView(shelter, 'floodfire'), false)
  assert.equal(matchesVerify(zone({ verification_status: 'official', source_type: 'official_manual' }), 'verified'), true)
  assert.equal(matchesVerify(zone({ verification_status: 'unverified' }), 'verified'), false)
  assert.equal(matchesVerify(zone({ verification_status: 'unverified' }), 'unverified'), true)
  assert.equal(matchesSearch(zone({ name: 'Lyari nullah' }), 'lyari'), true)
  assert.equal(matchesSearch(zone({ name: 'Lyari nullah' }), 'korangi'), false)
  assert.equal(matchesSearch(zone(), '   '), true)
})
test('styles: no two zone types share a pattern, outline or glyph, so colour is never the only cue', () => {
  const s = Object.values(ZONE_STYLES)
  for (const key of ['pattern', 'glyph', 'short', 'colour'] as const) assert.equal(new Set(s.map((x) => x[key])).size, s.length, `${key} must be unique per zone type`)
  assert.equal(new Set(s.map((x) => x.dash ?? 'solid')).size >= 4, true)
  assert.match(ZONE_STYLES.shelter.meaning, /NOT mean the surrounding area is free of hazards/)
})

// ---------------- clustering / labels ----------------
test('cluster: few points are not clustered; many nearby points are; far apart stay single; no points lost', () => {
  const few = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, lat: 24.8, lng: 67 + i * 0.0001 }))
  assert.equal(clusterPoints(few, 10).clusters.length, 0)
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, lat: 24.8 + (i % 20) * 0.0005, lng: 67 + Math.floor(i / 20) * 0.0005 }))
  const r = clusterPoints(many, 11)
  assert.ok(r.clusters.length >= 1 && r.clusters.length < 30)
  assert.equal(r.singles.length + r.clusters.reduce((s, c) => s + c.count, 0), many.length)
  assert.equal(clusterPoints(many, 16).clusters.length, 0, 'close zoom shows every marker')
  const far = [...many, { id: 'far', lat: 30, lng: 70 }]
  assert.ok(clusterPoints(far, 11).singles.some((p) => p.id === 'far'))
})
test('labels: overlapping labels are dropped, higher priority wins, stable order', () => {
  const shown = placeLabels([
    { id: 'a', x: 100, y: 100, w: 80, h: 20, priority: 10 }, { id: 'b', x: 110, y: 105, w: 80, h: 20, priority: 50 }, { id: 'c', x: 300, y: 100, w: 80, h: 20, priority: 1 },
  ])
  assert.deepEqual([...shown].sort(), ['b', 'c'])
  assert.ok(labelPriority('danger', 'official', 'extreme') > labelPriority('caution', 'unverified', 'low'))
})

// ---------------- feeds ----------------
const feed: FeedConfig = { id: 'test-feed', name: 'Test Met Office', url: 'https://example.org/f.json', homepage: 'https://example.org' }
const EXPIRES = new Date(Date.now() + 86_400_000).toISOString() // fixed, so repeated imports see identical data like a real feed
const feat = (id: string, over: Record<string, unknown> = {}, geometry: unknown = square(67, 24.8)): FeedFeature => ({
  type: 'Feature', geometry, properties: { id, name: `Warning ${id}`, description: 'Heavy rain and river flooding expected.', severity: 'severe', hazard: 'River flood', expires: EXPIRES, ...over },
})
const storeFor = () => createMemoryStore({ seed: false }) as unknown as ImportStore & ReturnType<typeof createMemoryStore>

test('feeds: import creates official zones; repeating the import creates no duplicates', async () => {
  const s = storeFor()
  const a = await reconcileFeed(s, feed, [feat('A'), feat('B')])
  assert.deepEqual([a.created, a.updated, a.unchanged], [2, 0, 0])
  const b = await reconcileFeed(s, feed, [feat('A'), feat('B')])
  assert.deepEqual([b.created, b.updated, b.unchanged], [0, 0, 2])
  const zones = await s.listZones({ includeHidden: true })
  assert.equal(zones.length, 2)
  assert.ok(zones.every((z) => z.verification_status === 'official' && z.source_type === 'official_feed' && z.source_name === 'Test Met Office' && z.boundary_quality === 'official'))
  assert.equal(zones[0].hazard_type, 'flood'); assert.equal(zones[0].zone_type, 'danger'); assert.equal(zones[0].severity, 'high')
})
test('feeds: re-importing an unchanged warning (no provider start time) does not bump its revision or timestamps', async () => {
  const s = storeFor()
  await reconcileFeed(s, feed, [feat('A')], Date.now())
  const [first] = await s.listFeedZones(feed.id)
  await new Promise((r) => setTimeout(r, 15))
  const again = await reconcileFeed(s, feed, [feat('A')], Date.now())
  assert.deepEqual([again.created, again.updated, again.unchanged], [0, 0, 1])
  const [second] = await s.listFeedZones(feed.id)
  assert.equal(second.revision, 1); assert.equal(second.valid_from, first.valid_from); assert.equal(second.updated_at, first.updated_at)
})
test('feeds: a revised warning updates the SAME zone, bumps the revision and keeps history', async () => {
  const s = storeFor()
  await reconcileFeed(s, feed, [feat('A')])
  const r = await reconcileFeed(s, feed, [feat('A', { severity: 'extreme', description: 'Upgraded: river will breach embankments tonight.' }, square(67, 24.8, 0.02))])
  assert.deepEqual([r.created, r.updated], [0, 1])
  const [z] = await s.listZones({ includeHidden: true })
  assert.equal(z.revision, 2); assert.equal(z.severity, 'extreme'); assert.match(z.description, /Upgraded/)
  const audit = await s.listZoneAudit(z.id)
  assert.deepEqual(audit.map((e) => e.action).sort(), ['import', 'import_update'])
  const upd = audit.find((e) => e.action === 'import_update')!
  assert.ok('severity' in upd.changes && 'geometry' in upd.changes && 'description' in upd.changes)
})
test('feeds: warnings dropped from a SUCCESSFUL response are deactivated, with history', async () => {
  const s = storeFor()
  await reconcileFeed(s, feed, [feat('A'), feat('B')])
  const r = await reconcileFeed(s, feed, [feat('A')])
  assert.equal(r.expired, 1)
  const zones = await s.listFeedZones(feed.id)
  assert.equal(zones.find((z) => z.external_id === 'B')!.lifecycle, 'deactivated')
  assert.equal(zones.find((z) => z.external_id === 'A')!.lifecycle, 'active')
  assert.ok((await s.listZoneAudit(zones.find((z) => z.external_id === 'B')!.id)).some((e) => e.action === 'expire'))
})
test('feeds: a FAILED fetch never erases or changes zones; it only records the failure for the stale warning', async () => {
  const s = storeFor()
  await reconcileFeed(s, feed, [feat('A'), feat('B')])
  const before = JSON.stringify(await s.listFeedZones(feed.id))
  const down = (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch
  const r = await importFeed(s, feed, down)
  assert.equal(r.ok, false)
  assert.equal(JSON.stringify(await s.listFeedZones(feed.id)), before)
  for (const bodyFn of [async () => new Response('nope', { status: 503 }), async () => new Response('{"not":"geojson"}', { status: 200 }), async () => new Response('<html>', { status: 200 })]) {
    assert.equal((await importFeed(s, feed, bodyFn as unknown as typeof fetch)).ok, false)
  }
  assert.equal(JSON.stringify(await s.listFeedZones(feed.id)), before, 'a malformed response must not wipe zones either')
  const [st] = await s.getFeedStatuses()
  assert.ok(st.last_error && st.last_success_at, 'last success time is preserved next to the error')
  const ok2 = await importFeed(s, feed, (async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [feat('A')] }))) as unknown as typeof fetch)
  assert.equal(ok2.ok, true)
  assert.equal((await s.getFeedStatuses())[0].last_error, null)
})
test('feeds: malformed features are skipped and counted, not imported and not fatal', async () => {
  const s = storeFor()
  const r = await reconcileFeed(s, feed, [
    feat('good'), feat('bad-geom', {}, { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), feat('point', {}, { type: 'Point', coordinates: [67, 24.8] }),
    { type: 'Feature', geometry: square(67, 24.8), properties: {} }, feat('good'),
  ])
  assert.equal(r.created, 1)
  assert.equal(r.skipped.length, 4)
  assert.ok(r.skipped.some((x) => /no id/.test(x.reason)) && r.skipped.some((x) => /invalid geometry/.test(x.reason)) && r.skipped.some((x) => /duplicate id/.test(x.reason)) && r.skipped.some((x) => /radius is not documented/.test(x.reason)))
})
test('feeds: a person who cancelled an imported zone is not overridden by the next refresh', async () => {
  const s = storeFor()
  await reconcileFeed(s, feed, [feat('A')])
  const [z] = await s.listFeedZones(feed.id)
  await s.updateZone(z.id, { lifecycle: 'cancelled', revision: 2 })
  await reconcileFeed(s, feed, [feat('A')])
  assert.equal((await s.getZone(z.id))!.lifecycle, 'cancelled')
})
test('feeds: feature mapping and config parsing are defensive', () => {
  const m = featureToZone(feed, feat('X', { severity: 'orange', hazard: 'Wildfire smoke' }))
  assert.ok('input' in m && m.input.hazard_type === 'fire' && m.input.zone_type === 'danger')
  assert.ok('reason' in featureToZone(feed, { type: 'Feature', geometry: null, properties: { id: 'q' } }))
  assert.deepEqual(loadFeedConfigs('not json'), [])
  assert.deepEqual(loadFeedConfigs('[{"id":"a","name":"x","url":"http://insecure"}]'), [], 'http feeds are refused')
  assert.equal(loadFeedConfigs('[{"id":"ok-1","name":"x","url":"https://x.org/a"}]').length, 1)
  assert.deepEqual(loadFeedConfigs(undefined), [])
})

// ---------------- offline snapshot ----------------
test('snapshot: merge replaces the fetched area, keeps other regions, records coverage and age', () => {
  const z1 = zone({ id: 'near', bbox: [67, 24.8, 67.01, 24.81] }), z2 = zone({ id: 'far', bbox: [70, 30, 70.1, 30.1] })
  let s = mergeSnapshot(EMPTY_SNAPSHOT, { zones: [z1, z2], feeds: [], server_time: 't1' }, null, '2026-10-24T10:00:00Z')
  assert.equal(s.zones.length, 2)
  s = mergeSnapshot(s, { zones: [], feeds: [], server_time: 't2' }, [66.9, 24.7, 67.2, 24.9], '2026-10-24T11:00:00Z')
  assert.deepEqual(s.zones.map((z) => z.id), ['far'], 'zone gone from the server inside the refreshed area is dropped; the other region is kept')
  assert.equal(s.fetched_at, '2026-10-24T11:00:00Z')
  assert.ok(s.coverage.length >= 1)
})
test('snapshot: uncoveredFraction tells the UI when part of the view was never loaded', () => {
  const s = mergeSnapshot(EMPTY_SNAPSHOT, { zones: [], feeds: [], server_time: 't' }, [67, 24, 68, 25], '2026-10-24T10:00:00Z')
  assert.equal(uncoveredFraction(s, [67.1, 24.1, 67.9, 24.9]), 0)
  assert.equal(uncoveredFraction(s, [70, 30, 71, 31]), 1)
  const half = uncoveredFraction(s, [67.5, 24.5, 68.5, 25.5])
  assert.ok(half > 0.5 && half < 0.9)
  assert.equal(uncoveredFraction(EMPTY_SNAPSHOT, [0, 0, 1, 1]), 1)
})

// ---------------- scale ----------------
test('scale: 5,000 zones validate, filter and simplify quickly', () => {
  const t0 = performance.now()
  const zones: DisasterZone[] = []
  for (let i = 0; i < 5000; i++) zones.push(zone({ id: `z${i}`, geometry: square(66 + (i % 100) * 0.02, 24 + Math.floor(i / 100) * 0.02, 0.01), zone_type: i % 3 ? 'elevated' : 'caution', hazard_type: i % 2 ? 'flood' : 'fire' }))
  const visible = zones.filter((z) => matchesView(z, 'floodfire') && isPubliclyVisible(z)).map((z) => simplifyGeometry(z.geometry, toleranceForZoom(10)))
  assert.equal(visible.length, 5000)
  assert.ok(performance.now() - t0 < 1500, `took ${Math.round(performance.now() - t0)} ms`)
})
test('memory store: bbox query returns only intersecting zones and hides drafts/AI from the public list', async () => {
  const s = createMemoryStore()
  const all = await s.listZones({ includeHidden: true })
  const pub = await s.listZones()
  assert.ok(all.length > pub.length)
  assert.ok(pub.every((z) => z.verification_status !== 'ai_suggested' && z.lifecycle !== 'draft'))
  const korangi = await s.listZones({ bbox: [67.07, 24.81, 67.13, 24.86] })
  assert.ok(korangi.length >= 1 && korangi.length < pub.length)
  assert.ok(markFeedFailure)
})
