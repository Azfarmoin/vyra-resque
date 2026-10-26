// AI photo analysis: schema validation, safety filters, model call (mock fetch), combining, suggestion merging.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeImage, photoModelName } from '../src/lib/photoAnalysis/model'
import { sanitizeOutput, STANDARD_LIMITATIONS } from '../src/lib/photoAnalysis/safety'
import { ModelOutputSchema, TOOL_JSON_SCHEMA, type ModelOutput } from '../src/lib/photoAnalysis/schema'
import { combineAnalyses } from '../src/lib/photoAnalysis/combine'
import { applySuggestions, defaultPick, previewAnalysis, WAITING_TEXT } from '../src/lib/photoAnalysis/client'
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_REPORT } from '../src/lib/attachments'
import { callFor, mockAnthropic, SCENARIOS } from './fixtures/photoScenarios'

const IMG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const ENV = { ANTHROPIC_API_KEY: 'test-key', VYRA_AI_MODEL: 'mock-vision-1' } as unknown as NodeJS.ProcessEnv
const call = (input: unknown, extra: Parameters<typeof analyzeImage>[2] = {}) => analyzeImage(IMG, 'image/png', { env: ENV, fetchImpl: mockAnthropic(input), ...extra })

test('reuses the configured provider: key, model and base URL come from the existing env vars; image is sent as base64 with a forced tool call', async () => {
  const calls: { body: Record<string, unknown> }[] = []
  const out = await analyzeImage(IMG, 'image/png', { env: { ...ENV, ANTHROPIC_BASE_URL: 'https://proxy.example/' } as NodeJS.ProcessEnv, fetchImpl: mockAnthropic(SCENARIOS.flood, calls) })
  assert.equal(out.ok, true)
  const body = calls[0].body as { model: string; tool_choice: { name: string }; messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] }
  assert.equal(body.model, 'mock-vision-1')
  assert.equal(body.tool_choice.name, 'submit_photo_analysis')
  assert.equal(body.messages[0].content[0].type, 'image')
  assert.equal(body.messages[0].content[0].source!.media_type, 'image/png')
  assert.equal(Buffer.from(body.messages[0].content[0].source!.data, 'base64').length, IMG.length)
  assert.equal(photoModelName({} as NodeJS.ProcessEnv), 'claude-sonnet-5-5') // same default as the existing AI feature
})

test('not configured: a clear state, no network call', async () => {
  let called = false
  const out = await analyzeImage(IMG, 'image/png', { env: {} as NodeJS.ProcessEnv, fetchImpl: (async () => { called = true; return new Response('{}') }) as typeof fetch })
  assert.equal(out.ok, false)
  assert.equal((out as { state: string }).state, 'not_configured')
  assert.equal(called, false)
})

for (const [name, expectType, sev] of [['flood', 'flooding', 'moderate'], ['fire', 'fire', 'high'], ['structural', 'building_collapse', 'high'], ['blockedRoad', 'road_blockage', 'low']] as const) {
  test(`scenario ${name}: validated, structured, with provenance and always review_required`, async () => {
    const out = await call(SCENARIOS[name])
    assert.equal(out.ok, true)
    const r = (out as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result
    assert.ok(r.detected_incident_types.includes(expectType))
    assert.equal(r.suggested_severity, sev)
    assert.equal(r.review_required, true)
    assert.equal(r.analysis_status, 'completed')
    assert.equal(r.model_provider, 'anthropic')
    assert.equal(r.model_version, 'mock-vision-1')
    assert.ok(Date.parse(r.analyzed_at!) > 0)
    for (const l of STANDARD_LIMITATIONS) assert.ok(r.limitations.includes(l)) // old/edited/unrelated, never "safe", needs a person
  })
}

test('no disaster evidence: no severity, nothing invented', async () => {
  const r = (callFor('none') as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result
  assert.deepEqual(r.detected_incident_types, ['no_disaster_evidence'])
  assert.equal(r.suggested_severity, 'not_determined')
  assert.deepEqual(r.possible_hazards, [])
})

test('ambiguous image: the model\'s "high" severity is ignored when it reports nothing identifiable', () => {
  const r = (callFor('ambiguous') as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result
  assert.deepEqual(r.detected_incident_types, ['unclear'])
  assert.equal(r.suggested_severity, 'not_determined')
  assert.equal(r.confidence, 'low')
})

test('malformed model output is rejected safely (missing fields, numeric confidence, wrong enum, no tool call, HTTP error, network error)', async () => {
  const bad: unknown[] = [
    { ...SCENARIOS.flood, confidence: 0.93 }, // numbers are not accepted as "calibrated" confidence
    { ...SCENARIOS.flood, confidence: undefined },
    { ...SCENARIOS.flood, detected_incident_types: ['alien_invasion'] },
    { ...SCENARIOS.flood, suggested_severity: 'catastrophic' },
    { ...SCENARIOS.flood, visual_observations: 'water' },
    'not even an object',
  ]
  for (const b of bad) {
    const out = await call(b)
    assert.equal(out.ok, false)
    assert.equal((out as { state: string }).state, 'invalid_output')
  }
  const noTool = await analyzeImage(IMG, 'image/png', { env: ENV, fetchImpl: (async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'hello' }] }), { status: 200 })) as typeof fetch })
  assert.equal((noTool as { state: string }).state, 'invalid_output')
  const http = await analyzeImage(IMG, 'image/png', { env: ENV, fetchImpl: (async () => new Response('x', { status: 529 })) as typeof fetch })
  assert.equal((http as { state: string }).state, 'unavailable')
  const net = await analyzeImage(IMG, 'image/png', { env: ENV, fetchImpl: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
  assert.equal((net as { state: string }).state, 'unavailable')
})

test('AI timeout: aborts and reports unavailable', async () => {
  const slow: typeof fetch = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))
  const t0 = Date.now()
  const out = await analyzeImage(IMG, 'image/png', { env: ENV, fetchImpl: slow, timeoutMs: 30 })
  assert.equal(out.ok, false)
  assert.match((out as { reason: string }).reason, /too long/)
  assert.ok(Date.now() - t0 < 1000)
})

const raw = (over: Partial<ModelOutput>): ModelOutput => ({ ...SCENARIOS.flood, ...over })

test('safety: statements that a building or road is safe are removed and reported', () => {
  const { result, removed } = sanitizeOutput(raw({
    visual_observations: ['The bridge is safe to cross.', 'Water covers the road.', 'The building looks structurally sound.'],
    suggested_description: 'Flooded road. The area appears safe. Water is visible.',
  }))
  assert.deepEqual(result.visual_observations, ['Water covers the road.'])
  assert.equal(result.suggested_description, 'Flooded road. Water is visible.')
  assert.equal(removed, 3)
  assert.ok(result.limitations.some((l) => /removed/.test(l)))
})

test('safety: no identifying people, no medical diagnosis, no location guesses', () => {
  const { result } = sanitizeOutput(raw({
    visual_observations: ['A person is standing on a roof.', 'The man is identified as John Smith.', 'He has a broken leg and a concussion.', 'The photo was taken in Lyari near the old bridge.', 'Coordinates appear to be 24.8, 67.0.'],
    possible_hazards: ['This is in Karachi, somewhere in Saddar.'],
  }))
  assert.deepEqual(result.visual_observations, ['A person is standing on a roof.'])
  assert.deepEqual(result.possible_hazards, [])
})

test('safety: markup and control characters are stripped, text is capped, duplicates merged, "no evidence" cannot sit beside a real incident', () => {
  const { result } = sanitizeOutput(raw({
    detected_incident_types: ['flooding', 'no_disaster_evidence', 'flooding'],
    visual_observations: ['<img src=x onerror=alert(1)>Water‮ on road', 'water on road', 'x'.repeat(2000)],
  }))
  assert.deepEqual(result.detected_incident_types, ['flooding'])
  assert.equal(result.visual_observations[0], 'Water on road')
  assert.equal(result.visual_observations.length, 2)
  assert.ok(result.visual_observations[1].length <= 240)
})

test('zod schema and tool JSON schema list the same fields (they cannot drift apart)', () => {
  const zodKeys = Object.keys(ModelOutputSchema.shape).sort()
  assert.deepEqual(Object.keys(TOOL_JSON_SCHEMA.properties).sort(), zodKeys)
})

test('multiple photos: per-photo sources, same hazard counted once, conflicts flagged, no assumption of one event', () => {
  const ph = (id: string, label: string, name: keyof typeof SCENARIOS) => ({ attachment_id: id, label, result: (callFor(name) as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result })
  const same = combineAnalyses([ph('a', 'Photo 1', 'flood'), ph('b', 'Photo 2', 'flood')])
  assert.equal(same.hazards.filter((h) => /road access may be obstructed/i.test(h.text)).length, 1)
  assert.deepEqual(same.hazards.find((h) => /road access/i.test(h.text))!.photos, ['Photo 1', 'Photo 2'])
  assert.ok(same.notes[0].match(/not assumed to show the same event/i))

  const mixed = combineAnalyses([ph('a', 'Photo 1', 'flood'), ph('b', 'Photo 2', 'none'), ph('c', 'Photo 3', 'fire')])
  assert.ok(mixed.conflicts.some((c) => /Photo 2 show no disaster evidence/.test(c)))
  assert.ok(mixed.conflicts.some((c) => /flooding.*fire/.test(c)))
  assert.ok(mixed.conflicts.some((c) => /different severity/.test(c)))
  assert.equal(mixed.highest_suggested_severity, 'high')
  assert.deepEqual(mixed.incident_types.find((t) => t.type === 'fire')!.photos, ['Photo 3'])

  const partial = combineAnalyses([ph('a', 'Photo 1', 'flood'), { attachment_id: 'f', label: 'Photo 2', result: { ...ph('f', 'x', 'flood').result, analysis_status: 'failed' } }])
  assert.equal(partial.analyzed_count, 1)
  assert.ok(partial.notes.some((n) => /no completed analysis/.test(n)))
})

test('applying suggestions never overwrites what the user typed, only adds', () => {
  const items = [{ attachment_id: 'a', label: 'Photo 1', result: (callFor('flood') as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result }]
  const typed = { dangers: ['trapped'], dangerDetails: 'Family on the first floor.', urgency: '' }
  const a = applySuggestions(typed, items, defaultPick(items))
  assert.ok(a.fields.dangerDetails.startsWith('Family on the first floor.'))
  assert.match(a.fields.dangerDetails, /Floodwater reported on road/)
  assert.deepEqual(a.fields.dangers, ['trapped', 'rising_water', 'blocked_road'])
  assert.deepEqual(a.marks.dangers, ['rising_water', 'blocked_road']) // flagged as AI suggestions
  assert.equal(a.marks.dangerDetails, true)
  assert.equal(a.fields.urgency, 'medium')
  // a rating the user already chose is kept
  const b = applySuggestions({ ...typed, urgency: 'critical' }, items, defaultPick(items))
  assert.equal(b.fields.urgency, 'critical')
  assert.equal(b.marks.urgency, false)
  // applying twice does not duplicate the text
  const c = applySuggestions(a.fields, items, defaultPick(items))
  assert.equal(c.fields.dangerDetails, a.fields.dangerDetails)
})

test('user edits and unticked suggestions are respected; multiple photos are labelled by source', () => {
  const r = (n: keyof typeof SCENARIOS) => (callFor(n) as { result: import('../src/lib/photoAnalysis/schema').PhotoAnalysisResult }).result
  const items = [{ attachment_id: 'a', label: 'Photo 1', result: r('flood') }, { attachment_id: 'b', label: 'Photo 2', result: r('fire') }]
  const pick = defaultPick(items)
  pick.text.a = 'Water up to car doors (my edit).'
  pick.types.b = [] // reporter unticked "fire"
  pick.urgency = false
  const a = applySuggestions({ dangers: [], dangerDetails: '', urgency: '' }, items, pick)
  assert.ok(a.fields.dangerDetails.includes('[Photo 1] Water up to car doors (my edit).'))
  assert.ok(a.fields.dangerDetails.includes('[Photo 2] Building fire'))
  assert.ok(!a.fields.dangers.includes('fire'))
  assert.equal(a.fields.urgency, '')
  // only photos the reporter included
  const only = applySuggestions({ dangers: [], dangerDetails: '', urgency: '' }, [items[0]], defaultPick([items[0]]))
  assert.ok(!only.fields.dangerDetails.includes('Photo 2'))
})

test('client preview: offline is "waiting", never a fake result; server/network failures keep the form usable', async () => {
  let called = false
  const off = await previewAnalysis(new Blob([IMG], { type: 'image/png' }), { online: false, fetchImpl: (async () => { called = true; return new Response('{}') }) as typeof fetch })
  assert.equal(off.status, 'waiting')
  assert.equal(off.reason, WAITING_TEXT)
  assert.equal(off.result, null)
  assert.equal(called, false)

  const dropped = await previewAnalysis(new Blob([IMG]), { fetchImpl: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch })
  assert.equal(dropped.status, 'waiting')
  const busy = await previewAnalysis(new Blob([IMG]), { fetchImpl: (async () => new Response(JSON.stringify({ error: 'Too many' }), { status: 429 })) as typeof fetch })
  assert.equal(busy.status, 'waiting')
  const rejected = await previewAnalysis(new Blob([IMG]), { fetchImpl: (async () => new Response(JSON.stringify({ error: 'Only JPEG, PNG or WebP photos are accepted' }), { status: 415 })) as typeof fetch })
  assert.equal(rejected.status, 'failed')
  const ok = await previewAnalysis(new Blob([IMG]), { token: 't', fetchImpl: (async (_u, init) => {
    assert.equal((init!.headers as Record<string, string>)['X-Analysis-Consent'], 'yes')
    assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer t')
    return new Response(JSON.stringify({ analysis: { analysis_status: 'completed', result: (callFor('flood') as { result: object }).result } }), { status: 200 })
  }) as typeof fetch })
  assert.equal(ok.status, 'completed')
  const notCfg = await previewAnalysis(new Blob([IMG]), { fetchImpl: (async () => new Response(JSON.stringify({ analysis: { analysis_status: 'failed', state: 'not_configured', failure_reason: 'Not set up' } }), { status: 200 })) as typeof fetch })
  assert.equal(notCfg.status, 'not_configured')
})

test('photo limits default to 5 MB and 8 photos (configurable only downwards from the storage limit)', () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 5 * 1024 * 1024)
  assert.equal(MAX_ATTACHMENTS_PER_REPORT, 8)
})
