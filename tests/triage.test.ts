import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triageReport, withTriage, compareByTriage } from '../src/lib/triage'
import type { ReportRow } from '../src/lib/types'

const now = new Date('2026-10-17T12:00:00Z')
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()

const base: ReportRow = {
  id: 'base',
  reporter_id: null,
  client_id: null,
  location_lat: 24.86,
  location_lng: 67.0,
  location_address: null,
  location_source: 'gps',
  location_accuracy_m: 10,
  area: 'Saddar',
  people_count: 1,
  immediate_danger: false,
  dangers: ['none'],
  danger_details: null,
  injury_severity: 'none',
  injury_count: null,
  injury_details: null,
  medical_need_types: [],
  medical_needs: null,
  can_evacuate: 'yes',
  vulnerabilities: [],
  contact_info: null,
  status: 'pending',
  verified: true,
  resolved_at: null,
  triage_override: null,
  priority_score: 0,
  priority_explanation: null,
  created_at: at(0),
  updated_at: at(0),
}
const run = (o: Partial<ReportRow>) => triageReport({ ...base, ...o }, { now })

test('a report with no risk factors is low priority', () => {
  const t = run({})
  assert.equal(t.suggestedPriority, 'low')
  assert.deepEqual(t.unknowns, [])
})

test('every factor has points and a reason, and they add up to the score', () => {
  const t = run({ dangers: ['fire'], people_count: 5, injury_severity: 'serious' })
  assert.ok(t.factors.length >= 3)
  for (const f of t.factors) assert.ok(f.points > 0 && f.category && f.detail)
  assert.equal(t.score, t.factors.reduce((s, f) => s + f.points, 0))
})

test('any immediate threat to life is at least high, even with a low score', () => {
  const t = run({ dangers: ['gas_leak'] })
  assert.ok(t.score < 45)
  assert.equal(t.suggestedPriority, 'high')
  assert.equal(t.safetyRules.length, 1)
})

test('threat to life plus people who cannot evacuate is critical', () => {
  const t = run({ dangers: ['rising_water'], can_evacuate: 'no' })
  assert.equal(t.suggestedPriority, 'critical')
})

test('missing information is never treated as low risk', () => {
  const t = run({ dangers: [], injury_severity: 'unknown', people_count: null, can_evacuate: 'unknown' })
  assert.equal(t.unknowns.length, 4)
  assert.notEqual(t.suggestedPriority, 'low')
  assert.ok(t.flags.some((f) => f.startsWith('Verify')))
})

test('waiting time raises open reports and stops once resolved', () => {
  assert.equal(run({ created_at: at(90) }).score - run({}).score, 9)
  assert.ok(run({ created_at: at(90) }).flags.some((f) => f.includes('Not picked up')))
  assert.equal(run({ created_at: at(1000) }).factors.find((f) => f.key === 'waiting')!.points, 15)
  const resolved = run({ created_at: at(90), status: 'resolved', resolved_at: at(60) })
  assert.equal(resolved.waitingMinutes, 30)
  assert.ok(!resolved.factors.some((f) => f.key === 'waiting'))
})

test('more people means more points', () => {
  assert.ok(run({ people_count: 30 }).score > run({ people_count: 3 }).score)
})

test('life-sustaining medical needs outweigh other needs', () => {
  const dialysis = run({ medical_need_types: ['dialysis'] }).factors.find((f) => f.key === 'medical')!
  const other = run({ medical_need_types: ['mental_health'] }).factors.find((f) => f.key === 'medical')!
  assert.ok(dialysis.points > other.points)
})

test('free-text cues add points that are labelled as text-derived', () => {
  const f = run({ danger_details: 'my father is unconscious' }).factors.find((x) => x.key === 'keywords')
  assert.match(f!.detail, /free text/)
})

test('a responder override becomes the effective priority and keeps the suggestion', () => {
  const r = withTriage({ ...base, triage_override: { priority: 'critical', reason: 'Called back, child not breathing', by: 'Ops', at: at(0) } }, { now })
  assert.equal(r.priority, 'critical')
  assert.equal(r.overridden, true)
  assert.equal(r.triage.suggestedPriority, 'low')
})

test('queue order: priority, then score, then longest waiting', () => {
  const items = [
    withTriage({ ...base, id: 'a', created_at: at(5) }, { now }),
    withTriage({ ...base, id: 'b', dangers: ['drowning'], can_evacuate: 'no' }, { now }),
    withTriage({ ...base, id: 'c', created_at: at(6) }, { now }),
  ].sort(compareByTriage)
  assert.deepEqual(items.map((i) => i.id), ['b', 'c', 'a'])
})
