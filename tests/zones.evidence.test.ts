import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convexHull, suggestChanges, zoneEvidence, type EvidenceReport } from '../src/lib/zones/evidence'
import { validateZoneInput } from '../src/lib/zones/rules'
import type { DisasterZone, ZoneGeometry } from '../src/lib/zones/types'

const now = Date.now()
const rep = (id: string, lng: number, lat: number, o: Partial<EvidenceReport> = {}): EvidenceReport => ({ id, lat, lng, verified: false, created_at: new Date(now - 3_600_000).toISOString(), status: 'pending', ...o })
const sq = (lng: number, lat: number, d = 0.01): ZoneGeometry => ({ type: 'Polygon', coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] })
const zone = (o: Partial<DisasterZone> = {}): DisasterZone => ({
  id: 'z1', name: 'Zone', zone_type: 'elevated', severity: 'high', hazard_type: 'flood', geometry: sq(67, 24.8), boundary_kind: 'drawn', boundary_quality: 'approximate', radius_m: null, radius_basis: null,
  description: 'Water on the street here.', precautions: null, status_detail: null, evacuation_status: null, source_type: 'responder', source_name: 'Team', source_url: null, external_id: null, feed_id: null,
  verification_status: 'human_verified', lifecycle: 'active', valid_from: new Date(now - 1e8).toISOString(), valid_until: null, related_report_ids: [], related_shelter_ids: [], related_road_ids: [],
  bbox: [67, 24.8, 67.01, 24.81], revision: 1, change_reason: null, source_updated_at: null, created_by: null, created_by_name: null, updated_by: null, created_at: '', updated_at: '', ...o,
})

test('evidence counts linked + inside reports once, ignores resolved/cancelled, splits verified', () => {
  const rs = [rep('a', 67.005, 24.805, { verified: true }), rep('b', 67.006, 24.806), rep('c', 70, 30), rep('d', 67.005, 24.807, { status: 'resolved' }), rep('e', 67.007, 24.806, { created_at: new Date(now - 5 * 86_400_000).toISOString() })]
  const e = zoneEvidence(zone({ related_report_ids: ['a', 'c'] }), rs, now)
  assert.deepEqual([e.total, e.linked, e.inside, e.verified, e.unverified, e.last24h], [4, 2, 3, 1, 3, 3])
})
test('hull: collinear or too few points give no area', () => {
  assert.equal(convexHull([[0, 0], [1, 1], [2, 2]]), null)
  assert.equal(convexHull([[0, 0], [1, 1]]), null)
  assert.equal(convexHull([[0, 0], [2, 0], [1, 1], [1, 0.2]])!.length, 3)
})
test('new area: needs enough weighted reports close together; verified count double; no boundary from a straight line', () => {
  assert.equal(suggestChanges([], [rep('a', 67.2, 24.9), rep('b', 67.2005, 24.9005)], {}, now).length, 0)
  const three = [rep('a', 67.2, 24.9), rep('b', 67.2015, 24.9), rep('c', 67.2, 24.9015)]
  const s = suggestChanges([], three, {}, now)
  assert.equal(s.length, 1); assert.equal(s[0].kind, 'new'); assert.equal(s[0].geometry!.type, 'Polygon')
  assert.equal(suggestChanges([], [rep('a', 67.2, 24.9, { verified: true }), rep('b', 67.2015, 24.9)], {}, now).length, 0, 'two points cannot form an area even with enough weight')
  assert.equal(suggestChanges([], [rep('a', 67.2, 24.9), rep('b', 67.201, 24.9), rep('c', 67.202, 24.9)], {}, now).length, 0, 'collinear points: no invented boundary')
  assert.equal(suggestChanges([], [...three.map((r) => ({ ...r, created_at: new Date(now - 3 * 86_400_000).toISOString() }))], {}, now).length, 0, 'old reports do not count')
  assert.equal(suggestChanges([zone({ geometry: sq(67.19, 24.89, 0.03), bbox: [67.19, 24.89, 67.22, 24.92] })], three, {}, now).filter((x) => x.kind === 'new').length, 0, 'already inside a zone')
})
test('extend: reports just outside an unofficial zone propose a hull; official zones only get a review note', () => {
  const outside = [rep('a', 67.0125, 24.805), rep('b', 67.0128, 24.806), rep('c', 67.0126, 24.807)]
  const [ext] = suggestChanges([zone()], outside, {}, now)
  assert.equal(ext.kind, 'extend'); assert.equal(ext.zone_id, 'z1'); assert.ok(ext.geometry)
  const [off] = suggestChanges([zone({ verification_status: 'official', source_type: 'official_manual' })], outside, {}, now)
  assert.equal(off.kind, 'review_official'); assert.equal(off.geometry, null)
  assert.equal(suggestChanges([zone({ lifecycle: 'cancelled' })], outside, {}, now).filter((x) => x.kind === 'extend').length, 0)
})
test('quiet zone: suggests a review, and says absence of reports is not safety; never suggests when never reported', () => {
  const old = [rep('a', 67.005, 24.805, { created_at: new Date(now - 4 * 86_400_000).toISOString() })]
  const [q] = suggestChanges([zone()], old, {}, now)
  assert.equal(q.kind, 'review_quiet'); assert.match(q.basis, /NOT evidence the area is safe/)
  assert.equal(suggestChanges([zone()], [], {}, now).length, 0)
  assert.equal(suggestChanges([zone({ verification_status: 'official', source_type: 'official_manual' })], old, {}, now).length, 0)
})
test('every geometry suggestion becomes a valid AI draft and can never be public or official', () => {
  const three = [rep('a', 67.2, 24.9), rep('b', 67.2015, 24.9), rep('c', 67.2, 24.9015)]
  const [s] = suggestChanges([], three, {}, now)
  const v = validateZoneInput({ name: s.title, zone_type: 'caution', severity: 'unknown', hazard_type: 'other', geometry: s.geometry, description: s.basis, source_type: 'ai_suggestion', source_name: 'VYRA report analysis', verification_status: 'ai_suggested', lifecycle: 'draft', related_report_ids: s.report_ids })
  assert.ok(v.ok, v.errors.join(' | '))
  assert.equal(validateZoneInput({ ...v.value, lifecycle: 'active' }).ok, false)
})
