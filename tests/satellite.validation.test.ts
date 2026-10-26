// Date validation, area validation, parameter validation.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDay, validateAoi, validateOpticalParams, validateRanges, validateSarParams } from '../src/lib/satellite/validation'
import { NOW } from './satellite.helpers'

const ok = { start: '2026-08-01', end: '2026-08-20' }, ok2 = { start: '2026-09-10', end: '2026-09-30' }
const errs = (b: unknown, a: unknown, c: 'sentinel-2-l2a' | 'sentinel-1' | 'landsat-c2-l2' = 'sentinel-2-l2a') => validateRanges(b, a, c, NOW)

test('dates: valid before/after ranges pass', () => assert.deepEqual(errs(ok, ok2), []))
test('dates: impossible calendar days are rejected, not rolled over', () => {
  assert.equal(parseDay('2026-02-30'), null); assert.equal(parseDay('2026-13-01'), null); assert.equal(parseDay('2025-02-29'), null)
  assert.notEqual(parseDay('2024-02-29'), null)
  assert.ok(errs({ start: '2026-02-30', end: '2026-03-02' }, ok2).some((e) => /real date/.test(e)))
})
test('dates: wrong formats and non-strings are rejected', () => {
  for (const bad of ['01/08/2026', '2026-8-1', '2026-08-01T00:00:00Z', '', null, 20260801, undefined]) assert.ok(errs({ start: bad, end: '2026-08-20' }, ok2).length > 0, String(bad))
  assert.ok(errs(null, ok2).length > 0); assert.ok(errs(ok, 'x').length > 0)
})
test('dates: start after end, future dates, and over-long ranges are rejected', () => {
  assert.ok(errs({ start: '2026-08-20', end: '2026-08-01' }, ok2).some((e) => /after the end date/.test(e)))
  assert.ok(errs(ok, { start: '2026-10-20', end: '2026-10-30' }).some((e) => /in the future/.test(e)))
  assert.ok(errs({ start: '2026-01-01', end: '2026-08-20' }, ok2).some((e) => /longer than 45 days/.test(e)))
  assert.deepEqual(errs(ok, { start: '2026-10-20', end: '2026-10-25' }), [], 'today is allowed')
})
test('dates: before must end before after starts; overlapping or reversed periods are rejected', () => {
  assert.ok(errs(ok, { start: '2026-08-10', end: '2026-08-30' }).some((e) => /must end before the after period starts/.test(e)))
  assert.ok(errs(ok2, ok).some((e) => /must end before/.test(e)))
  assert.ok(errs(ok, { start: '2026-08-20', end: '2026-08-30' }).some((e) => /must end before/.test(e)), 'same day is overlap')
})
test('dates: nothing before the mission start of each collection', () => {
  assert.ok(errs({ start: '2015-01-01', end: '2015-01-10' }, { start: '2015-02-01', end: '2015-02-10' }).some((e) => /no imagery before 2015-06-23/.test(e)))
  assert.ok(errs({ start: '2013-01-01', end: '2013-01-10' }, { start: '2013-02-01', end: '2013-02-10' }, 'landsat-c2-l2').some((e) => /2013-03-18/.test(e)))
  assert.deepEqual(errs({ start: '2014-11-01', end: '2014-11-10' }, { start: '2014-12-01', end: '2014-12-10' }, 'sentinel-1'), [])
})
test('area: boxes and polygons are accepted and measured', () => {
  const a = validateAoi({ type: 'bbox', bbox: [67, 24.8, 67.04, 24.84] })
  assert.ok(a.ok && a.areaKm2 > 15 && a.areaKm2 < 22)
  const p = validateAoi({ type: 'Polygon', coordinates: [[[67, 24.8], [67.04, 24.8], [67.02, 24.84], [67, 24.8]]] })
  assert.ok(p.ok && p.polygon && p.bbox[2] === 67.04)
})
test('area: empty, malformed, out-of-range, reversed, tiny and huge areas are rejected with a reason', () => {
  const bad: [unknown, RegExp][] = [
    [null, /Choose an area/], [{ type: 'circle' }, /box or a polygon/], [{ type: 'bbox', bbox: [1, 2, 3] }, /four numbers/], [{ type: 'bbox', bbox: ['a', 1, 2, 3] }, /four numbers/],
    [{ type: 'bbox', bbox: [67, 24, 66, 25] }, /no size/], [{ type: 'bbox', bbox: [67, 24, 67, 25] }, /no size/], [{ type: 'bbox', bbox: [170, 24, 190, 25] }, /outside valid/], [{ type: 'bbox', bbox: [67, 91, 68, 92] }, /outside valid/],
    [{ type: 'bbox', bbox: [67, 24, 67.0001, 24.0001] }, /too small/], [{ type: 'bbox', bbox: [60, 20, 70, 30] }, /too large/],
    [{ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }, /three corners/], [{ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 95], [0, 0]]] }, /outside valid/],
    [{ type: 'bbox', bbox: [NaN, 1, 2, 3] }, /./],
  ]
  for (const [input, re] of bad) { const r = validateAoi(input); assert.ok(!r.ok && re.test(r.errors.join(' ')), JSON.stringify(input)) }
})
test('parameters: defaults apply, out-of-range values are refused', () => {
  const o = validateOpticalParams({}); assert.ok(o.ok && o.value.index === 'mndwi' && o.value.waterThreshold === 0)
  assert.ok(!validateOpticalParams({ index: 'savi' }).ok); assert.ok(!validateOpticalParams({ waterThreshold: 3 }).ok); assert.ok(!validateOpticalParams({ minClusterPixels: 0 }).ok); assert.ok(!validateOpticalParams({ waterThreshold: 'x' }).ok)
  const s = validateSarParams({}); assert.ok(s.ok && s.value.polarization === 'VV' && s.value.waterThresholdDb === -18)
  assert.ok(!validateSarParams({ polarization: 'HH' }).ok); assert.ok(!validateSarParams({ waterThresholdDb: 5 }).ok); assert.ok(!validateSarParams({ speckleWindow: 4 }).ok); assert.ok(!validateSarParams({ changeDb: 0 }).ok)
})
