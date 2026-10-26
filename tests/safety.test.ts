// Reviewed safety content: structure, hazard-specific rules, the deterministic "what now" checklist and cross-links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GUIDES, HAZARD_IDS, getGuide, guideFromLabel, guidesForDangers, searchGuides, DANGER_TO_GUIDE, ZONE_HAZARD_TO_GUIDE, SCENE_IDS, SCENES } from '../src/lib/safety'
import { buildChecklist, DEFAULT_ANSWERS, type NowAnswers } from '../src/lib/safety/rules'
import { isStale, lintGuide } from '../src/lib/safety/lint'
import { WAITING_COMMON } from '../src/lib/safety/content/common'
import { EMERGENCY_NUMBER } from '../src/lib/safety/config'
import { DANGERS } from '../src/lib/constants'

test('all 12 required categories exist, once each, with a guide object', () => {
  assert.equal(GUIDES.length, 12)
  assert.deepEqual([...GUIDES.map((g) => g.id)].sort(), [...HAZARD_IDS].sort())
  for (const id of HAZARD_IDS) assert.equal(getGuide(id)!.id, id)
  assert.equal(getGuide('nope'), null)
})
test('every guide passes the content lint (all four phases, sources, illustrations, hazard-specific required advice)', () => {
  for (const g of GUIDES) assert.deepEqual(lintGuide(g), [], g.id)
})
test('every illustration id used exists and has a description; every scene is used at least once', () => {
  const used = new Set(GUIDES.flatMap((g) => [...g.before, ...g.during, ...g.after, ...g.waiting.flatMap((w) => w.steps)].map((s) => s.scene)))
  for (const s of used) assert.ok(SCENES[s], s)
  for (const id of SCENE_IDS) assert.ok(SCENES[id].length > 30)
  assert.deepEqual(SCENE_IDS.filter((s) => !used.has(s)), [], 'unused illustrations are dead weight offline')
})
test('step ids are unique inside each guide; titles are short (readable under stress)', () => {
  for (const g of GUIDES) {
    const steps = [...g.before, ...g.during, ...g.after].map((s) => s.id)
    assert.equal(new Set(steps).size, steps.length, g.id)
    for (const s of [...g.before, ...g.during, ...g.after]) assert.ok(s.title.length <= 60, `${g.id}/${s.id}`)
  }
})
test('the most urgent life-safety action is first in DURING for the headline hazards', () => {
  const first = (id: string) => getGuide(id)!.during[0].title.toLowerCase()
  assert.match(first('flood'), /higher ground/)
  assert.match(first('earthquake'), /drop, cover and hold on/)
  assert.match(first('fire'), /get out/)
  assert.match(first('tsunami'), /inland and uphill/)
  assert.match(first('landslide'), /move out of the path/)
  assert.match(first('chemical'), /official instructions/)
})
test('hazard-specific advice does not leak across hazards (no generic advice that is dangerous elsewhere)', () => {
  const text = (id: string) => JSON.stringify(getGuide(id)).toLowerCase()
  assert.ok(!/drop, cover/.test(text('fire')), 'drop-cover-hold-on belongs to earthquakes, not fires')
  assert.ok(!/higher ground/.test(text('earthquake').replace(/inland and uphill|tsunami/g, '')) || /tsunami/.test(text('earthquake')))
  assert.ok(!/move to higher ground|go to higher ground/.test(text('heat')))
  assert.ok(!/seal(s|ed)? .*gaps/.test(text('flood')))
  assert.ok(!/crawl/.test(text('chemical')), 'crawling low is fire advice; gas can behave differently')
  assert.ok(!/stay low/.test(text('chemical')))
  assert.ok(!/(^|[^o] )light a match/.test(JSON.stringify([getGuide('earthquake'), getGuide('collapse')]).replace(/Do not light a match/g, '')))
})
test('waiting-for-rescue: safety first, no unsafe rescue, trapped guidance differs from shelter guidance', () => {
  for (const g of GUIDES) {
    const all = g.waiting.flatMap((w) => w.steps)
    const body = JSON.stringify(all)
    assert.match(body, /Do not (go into danger|enter|go back|go in|go out|approach|touch)/i, g.id)
    assert.ok(!/wait (here|where you are) (even )?(if|while).*danger/i.test(body))
  }
  const quake = getGuide('earthquake')!
  const trapped = JSON.stringify(quake.waiting.find((w) => w.id === 'trapped')!.steps)
  const shelter = JSON.stringify(quake.waiting.find((w) => w.id === 'shelter')!.steps)
  assert.match(trapped, /tap|whistle/i); assert.ok(!/tap|whistle/i.test(shelter))
  assert.match(shelter, /Register/)
  for (const g of GUIDES.filter((x) => x.id !== 'tsunami')) assert.ok(g.waiting.length >= 1)
  assert.deepEqual(WAITING_COMMON.map((s) => s.id), ['common-tell', 'common-battery', 'common-norescue'])
  assert.match(JSON.stringify(WAITING_COMMON[0]), /landmark/)
  assert.match(JSON.stringify(WAITING_COMMON[0]), /how many people/)
})
test('no invented emergency numbers in guide text; the number comes from configuration', () => {
  for (const g of GUIDES) assert.ok(!/\b(911|999|112|1122)\b/.test(JSON.stringify(g)), g.id)
  assert.equal(typeof EMERGENCY_NUMBER, 'string')
})
test('sources: every guide has trusted https sources, a check date, and says it is not yet expert-reviewed', () => {
  for (const g of GUIDES) {
    assert.ok(g.sources.length >= 2 && g.sources.every((s) => s.org && s.url.startsWith('https://')), g.id)
    assert.ok(g.sources.some((s) => s.checked), g.id)
    assert.equal(g.expert_reviewed, null, 'nobody has reviewed these yet; an administrator sets this')
  }
})
test('outdated content indicator', () => {
  const g = getGuide('flood')!
  assert.equal(isStale(g, Date.parse(g.content_checked_on) + 30 * 86_400_000), false)
  assert.equal(isStale(g, Date.parse(g.content_checked_on) + 400 * 86_400_000), true)
  assert.equal(isStale({ ...g, expert_reviewed: { by: 'X', on: '2030-01-01' } }, Date.parse('2030-06-01')), false)
})

// ---------- checklist ----------
const A = (o: Partial<NowAnswers> = {}): NowAnswers => ({ ...DEFAULT_ANSWERS, ...o })
test('checklist is deterministic and never empty for any hazard and any combination of answers', () => {
  let n = 0
  for (const hazard of [null, ...HAZARD_IDS]) for (const danger of [false, true]) for (const situation of ['none', 'trapped', 'injured', 'both'] as const) for (const waiting of [false, true]) for (const online of [false, true]) {
    const a = A({ hazard, danger, situation, waiting, online })
    const r = buildChecklist(a)
    assert.ok(r.items.length >= 2, JSON.stringify(a))
    assert.deepEqual(buildChecklist(a), r)
    assert.equal(new Set(r.items.map((i) => i.id)).size, r.items.length, 'duplicate ids ' + JSON.stringify(a))
    assert.ok(r.items.every((i) => i.text.length > 10))
    n++
  }
  assert.equal(n, 13 * 2 * 4 * 2 * 2)
})
test('immediate danger: urgent first, tells people to reach safety and call, never to wait where they are', () => {
  for (const hazard of HAZARD_IDS) {
    const r = buildChecklist(A({ hazard, danger: true, waiting: true, situation: 'both' }))
    assert.equal(r.urgent, true)
    assert.equal(r.items[0].tone, 'urgent'); assert.match(r.items[0].text, /safest place/i); assert.match(r.items[1].text, /emergency service/i)
    const g = getGuide(hazard)!
    for (const w of g.quick.waiting) assert.ok(!r.items.some((i) => i.text === w), `${hazard}: must not tell someone in danger to wait`)
    assert.ok(r.items.some((i) => /Do not wait where you are/.test(i.text)))
    assert.ok(g.quick.danger.every((t) => r.items.some((i) => i.text === t)))
  }
})
test('trapped and injured answers add the hazard-specific lines; waiting adds waiting lines only when not in danger', () => {
  const t = buildChecklist(A({ hazard: 'collapse', situation: 'trapped' }))
  assert.ok(t.items.some((i) => /match/.test(i.text)))
  const inj = buildChecklist(A({ hazard: 'road', situation: 'injured' }))
  assert.ok(inj.items.some((i) => /Do not move an injured person/.test(i.text)))
  const w = buildChecklist(A({ hazard: 'flood', waiting: true }))
  assert.ok(w.items.some((i) => /higher ground or upper floor/.test(i.text)))
  assert.equal(w.urgent, false)
})
test('offline: checklist still works and says reports are saved and live warnings are unavailable', () => {
  const r = buildChecklist(A({ hazard: 'fire', danger: true, online: false }))
  assert.ok(r.items.some((i) => i.id === 'offline' && /saved on this device/.test(i.text)))
  assert.ok(r.notes.some((n) => /internet connection/.test(n)) && r.notes.some((n) => /may be old/.test(n)))
  assert.ok(!r.items.some((i) => i.id === 'online'))
  assert.ok(buildChecklist(A({ online: true })).items.some((i) => i.id === 'online' && i.link?.href === '/report'))
})
test('with no disaster chosen it still gives safe generic first steps, with no hazard-specific claims', () => {
  const r = buildChecklist(A({ danger: true }))
  assert.match(r.items.map((i) => i.text).join(' '), /Choose the type of disaster/)
  const tr = buildChecklist(A({ situation: 'trapped' }))
  assert.ok(tr.items.some((i) => /nose and mouth/.test(i.text)))
})

// ---------- links from the rest of VYRA ----------
test('every VYRA report danger and every zone hazard maps to a guide or to none, never to an unknown id', () => {
  for (const d of Object.keys(DANGERS)) assert.ok(d in DANGER_TO_GUIDE, `unmapped danger ${d}`)
  for (const v of [...Object.values(DANGER_TO_GUIDE), ...Object.values(ZONE_HAZARD_TO_GUIDE)]) assert.ok(v === null || getGuide(v), String(v))
  assert.deepEqual(guidesForDangers(['rising_water', 'drowning', 'fire', 'none']).sort(), ['fire', 'flood'])
  assert.equal(ZONE_HAZARD_TO_GUIDE.structural, 'collapse'); assert.equal(ZONE_HAZARD_TO_GUIDE.flood, 'flood')
})
test('photo-analysis labels map to a guide pointer only', () => {
  assert.equal(guideFromLabel('Possible flooded street'), 'urban-flood')
  assert.equal(guideFromLabel('smoke and flames'), 'fire')
  assert.equal(guideFromLabel('fallen power line'), 'electrical')
  assert.equal(guideFromLabel('a cat'), null)
})
test('search and category filter', () => {
  assert.ok(searchGuides('manhole', 'all').some((g) => g.id === 'urban-flood'))
  assert.ok(searchGuides('', 'water').every((g) => g.group === 'water') && searchGuides('', 'water').length === 3)
  assert.equal(searchGuides('zzzz', 'all').length, 0)
  assert.equal(searchGuides('', 'all').length, 12)
})
test('lint catches bad content (so a broken edit cannot be published)', () => {
  const g = structuredClone(getGuide('earthquake')!)
  g.during = g.during.filter((s) => !/hold on/i.test(JSON.stringify(s)))
  g.during[0].scene = 'nope' as never
  g.sources = []
  g.quick.danger = []
  const errs = lintGuide(g).join(' | ')
  assert.match(errs, /unknown illustration/); assert.match(errs, /Drop, Cover and Hold On/i); assert.match(errs, /sources/); assert.match(errs, /quick\.danger/)
  const num = structuredClone(getGuide('fire')!)
  num.during[0].do.push('Call 999 immediately.')
  assert.match(lintGuide(num).join(' '), /emergency number/)
})

// ---------- administrator content management ----------
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as contentRoute from '../src/app/api/safety/content/route'
import * as hazardRoute from '../src/app/api/safety/content/[hazard]/route'
import * as revRoute from '../src/app/api/safety/content/[hazard]/revisions/route'
import { mergePublished } from '../src/lib/safety/merge'
import { toPublished, validateSafetySave } from '../src/lib/safety/admin'

const req = (path: string, o: { method?: string; body?: unknown; as?: string } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: o.method || 'GET', body: o.body ? JSON.stringify(o.body) : undefined, headers: { 'content-type': 'application/json', ...(o.as ? { 'x-demo-admin': o.as } : {}) } })
const put = (hazard: string, body: unknown, as?: string) => hazardRoute.PUT(req(`/api/safety/content/${hazard}`, { method: 'PUT', body, as }), { params: { hazard } })
const edited = () => { const g = structuredClone(getGuide('flood')!); g.during[0].do.push('Warn your neighbours as you go.'); return g }

test('admin content: only administrators can write; the public sees only reviewed, published guides', async () => {
  setStore(createMemoryStore())
  const body = { action: 'publish', content: edited(), reviewed_by: 'Dr A. Khan, PDMA', reviewed_on: '2026-10-20', change_reason: 'Added neighbour warning' }
  assert.equal((await put('flood', body)).status, 401)
  assert.equal((await put('flood', body, 'citizen@demo.vyra')).status, 403)
  assert.equal((await put('flood', body, 'dispatcher@demo.vyra')).status, 403)
  assert.equal((await (await contentRoute.GET(req('/api/safety/content'))).json()).items.length, 0)
  assert.equal((await contentRoute.GET(req('/api/safety/content?all=1'))).status, 401)
  assert.equal((await put('flood', body, 'admin@demo.vyra')).status, 200)
  const pub = (await (await contentRoute.GET(req('/api/safety/content'))).json()).items
  assert.equal(pub.length, 1); assert.deepEqual(pub[0].content.expert_reviewed, { by: 'Dr A. Khan, PDMA', on: '2026-10-20' })
  assert.ok(pub[0].content.during[0].do.includes('Warn your neighbours as you go.'))
})
test('admin content: drafts are private; publishing needs a reviewer, a date and a reason; unsafe content is refused', async () => {
  setStore(createMemoryStore())
  const as = 'admin@demo.vyra'
  assert.equal((await put('flood', { action: 'publish', content: edited(), change_reason: 'ok reason' }, as)).status, 400, 'no reviewer')
  assert.equal((await put('flood', { action: 'publish', content: edited(), reviewed_by: 'X Y', reviewed_on: '2999-01-01', change_reason: 'ok reason' }, as)).status, 400, 'future review date')
  assert.equal((await put('flood', { action: 'publish', content: edited(), reviewed_by: 'X Y', reviewed_on: '2026-10-01' }, as)).status, 400, 'no reason')
  const unsafe = edited(); unsafe.during = unsafe.during.filter((s) => !/floodwater/i.test(JSON.stringify(s)))
  const refused = await put('flood', { action: 'publish', content: unsafe, reviewed_by: 'X Y', reviewed_on: '2026-10-01', change_reason: 'trim steps' }, as)
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /floodwater/)
  const wrong = structuredClone(edited()); wrong.id = 'fire' as never
  assert.equal((await put('flood', { action: 'save_draft', content: wrong, change_reason: 'wrong id' }, as)).status, 400)
  assert.equal((await put('nope', { action: 'save_draft', content: edited(), change_reason: 'bad category' }, as)).status, 400)
  assert.equal((await put('flood', { action: 'save_draft', content: edited(), change_reason: 'work in progress' }, as)).status, 200)
  assert.equal((await (await contentRoute.GET(req('/api/safety/content'))).json()).items.length, 0, 'a draft is not public')
})
test('admin content: revision history, retire reverts to the built-in guide, and drafts cannot unpublish a live guide', async () => {
  setStore(createMemoryStore())
  const as = 'admin@demo.vyra'
  await put('fire', { action: 'save_draft', content: structuredClone(getGuide('fire')!), change_reason: 'first draft' }, as)
  assert.equal((await put('fire', { action: 'publish', content: structuredClone(getGuide('fire')!), reviewed_by: 'Fire Service HQ', reviewed_on: '2026-10-10', change_reason: 'reviewed by fire service' }, as)).status, 200)
  assert.equal((await put('fire', { action: 'save_draft', content: structuredClone(getGuide('fire')!), change_reason: 'sneaky draft' }, as)).status, 409)
  assert.equal((await put('fire', { action: 'retire', change_reason: 'out of date, rewriting' }, as)).status, 200)
  assert.equal((await put('fire', { action: 'retire', change_reason: 'retire twice' }, as)).status, 409)
  assert.equal((await (await contentRoute.GET(req('/api/safety/content'))).json()).items.length, 0)
  const revs = (await (await revRoute.GET(req('/api/safety/content/fire/revisions', { as }), { params: { hazard: 'fire' } })).json()).revisions
  assert.deepEqual(revs.map((r: { status: string }) => r.status), ['retired', 'published', 'draft'])
  assert.equal((await revRoute.GET(req('/api/safety/content/fire/revisions'), { params: { hazard: 'fire' } })).status, 401)
})
test('client merge: a published guide replaces the built-in one only when it passes the content checks', () => {
  const good = { hazard_id: 'flood', content: { ...edited(), expert_reviewed: { by: 'R', on: '2026-10-01' } }, revision: 2, published_at: '2026-10-02T00:00:00Z' }
  assert.equal(mergePublished([good]).find((g) => g.id === 'flood')!.expert_reviewed!.by, 'R')
  const broken = structuredClone(good); broken.content.sources = []
  assert.equal(mergePublished([broken]).find((g) => g.id === 'flood')!.expert_reviewed, null, 'falls back to the built-in guide')
  const mismatch = { ...good, hazard_id: 'fire' }
  assert.equal(mergePublished([mismatch]).find((g) => g.id === 'fire')!.title, getGuide('fire')!.title)
  assert.equal(mergePublished([]).length, 12)
  assert.equal(toPublished({ hazard_id: 'flood', content: edited(), status: 'published', revision: 1, reviewed_by: null, reviewed_on: null, change_reason: 'x', updated_by: null, created_at: '', updated_at: '', published_at: null }), null, 'no review record, not public')
  assert.equal(validateSafetySave({ hazard_id: 'flood', action: 'retire', change_reason: 'no content needed' }).ok, true)
})
