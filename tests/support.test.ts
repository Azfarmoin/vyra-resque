// Support requests ("Contact us"), FAQ search and emergency content, against the in-memory demo database.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { setStore } from '../src/lib/db'
import { createMemoryStore } from '../src/lib/db/memoryStore'
import * as support from '../src/app/api/support/route'
import * as supportId from '../src/app/api/support/[id]/route'
import { checkRateLimit, recordSubmission, resetDemoSupport, resetRateLimits, spamVerdict } from '../src/lib/supportServer'
import { SUPPORT_REF_RE, supportInputSchema } from '../src/lib/support'
import { FAQ_CATEGORIES, FAQ_ITEMS, filterFaq } from '../src/lib/content/faq'
import { CONTENT_REVIEWED, OFFICIAL_CONTACTS, PRECAUTIONS } from '../src/lib/content/precautions'

beforeEach(() => {
  setStore(createMemoryStore())
  resetDemoSupport()
  resetRateLimits()
})

let n = 0
const valid = (over: Record<string, unknown> = {}) => ({
  name: 'Bilal Ahmed',
  email: 'bilal@example.com',
  subject: `Cannot see my report ${++n}`,
  category: 'report_problem',
  message: `My report status page shows nothing at all, case ${n}.`,
  report_reference: '3f9a1c',
  elapsed_ms: 9000,
  ...over,
})
const post = (body: unknown, who?: string, ip = '10.0.0.1') =>
  support.POST(new NextRequest('http://localhost/api/support', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(who ? { 'x-demo-user': who } : {}) } }))
const list = (scope: string, who?: string) =>
  support.GET(new NextRequest(`http://localhost/api/support?scope=${scope}`, { headers: who ? { 'x-demo-user': who } : {} }))
const patch = (id: string, body: unknown, who?: string) =>
  supportId.PATCH(new NextRequest(`http://localhost/api/support/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(who ? { 'x-demo-user': who } : {}) } }), { params: { id } })
const json = (r: Response) => r.json()

// ------------------------------------------------------------------ validation

test('support: validation rules (shared by the form and the API)', () => {
  assert.ok(supportInputSchema.safeParse(valid()).success)
  const bad = (over: Record<string, unknown>) => supportInputSchema.safeParse(valid(over)).success
  assert.equal(bad({ name: ' ' }), false)
  assert.equal(bad({ name: 'A' }), false)
  assert.equal(bad({ subject: 'ab' }), false)
  assert.equal(bad({ message: 'too short' }), false)
  assert.equal(bad({ message: 'x '.repeat(2100) }), false)
  assert.equal(bad({ category: 'billing' }), false)
  assert.equal(bad({ category: '' }), false)
  assert.equal(bad({ email: 'not-an-email' }), false)
  assert.equal(bad({ report_reference: 'no spaces allowed!' }), false)
  assert.equal(bad({ message: 'see http://a.com http://b.com http://c.com for details please' }), false)
  // optional fields may be empty; email is lower-cased, reference upper-cased
  const ok = supportInputSchema.parse(valid({ email: '', report_reference: '' }))
  assert.equal(ok.email, null)
  assert.equal(ok.report_reference, null)
  assert.equal(supportInputSchema.parse(valid({ email: 'A@B.CO' })).email, 'a@b.co')
  assert.equal(supportInputSchema.parse(valid()).report_reference, '3F9A1C')
})

test('support: the API rejects invalid input with field details', async () => {
  const res = await post(valid({ subject: '', email: 'nope', category: 'x' }))
  assert.equal(res.status, 400)
  const body = await json(res)
  const paths = body.details.map((d: { path: string }) => d.path)
  assert.ok(['subject', 'email', 'category'].every((p) => paths.includes(p)), JSON.stringify(paths))
  assert.equal((await post('not json at all')).status, 400)
  assert.equal((await list('all', undefined)).status, 401)
})

// ------------------------------------------------------------------ saving, reference, duplicates

test('support: a valid request is saved and answered with a reference ID', async () => {
  const res = await post(valid(), 'citizen@demo.vyra')
  assert.equal(res.status, 201)
  const body = await json(res)
  assert.match(body.reference, SUPPORT_REF_RE)
  assert.equal(body.duplicate, false)
  const mine = await json(await list('mine', 'citizen@demo.vyra'))
  assert.equal(mine.requests.length, 1)
  assert.equal(mine.requests[0].reference, body.reference)
  assert.equal(mine.requests[0].status, 'open')
  assert.ok(!('sender_key' in mine.requests[0]) && !('content_hash' in mine.requests[0]), 'internal columns are never returned')
})

test('support: people without an account can send a request too', async () => {
  const res = await post(valid())
  assert.equal(res.status, 201)
  const all = await json(await list('all', 'admin@demo.vyra'))
  assert.equal(all.requests.length, 1)
  assert.equal(all.requests[0].user_id, null)
})

test('support: sending the same message twice does not create a second request', async () => {
  const body = valid()
  const first = await json(await post(body))
  const second = await post(body)
  assert.equal(second.status, 200)
  const again = await json(second)
  assert.equal(again.duplicate, true)
  assert.equal(again.reference, first.reference)
  assert.equal((await json(await list('all', 'admin@demo.vyra'))).requests.length, 1)
})

// ------------------------------------------------------------------ spam and rate limits

test('support: honeypot, speed and link spam are refused', async () => {
  assert.equal((await post(valid({ website: 'http://spam.example' }))).status, 400)
  assert.equal((await post(valid({ elapsed_ms: 300 }))).status, 400)
  assert.equal((await post(valid({ elapsed_ms: undefined }))).status, 400)
  assert.equal((await post(valid({ message: 'a'.repeat(40) }))).status, 400)
  assert.equal((await post(valid({ message: 'ababababab '.repeat(2) + 'zzzzzzzzzzzzzzzzzzzz' }))).status, 400)
  assert.equal((await json(await list('all', 'admin@demo.vyra'))).requests.length, 0, 'nothing refused was stored')
  assert.equal(spamVerdict({ elapsed_ms: 5000 }, { message: 'Real sentence about my report.', subject: 'Help', name: 'Ann' }), null)
})

test('support: rate limit - 10 seconds apart and 5 per hour per sender', async () => {
  assert.equal((await post(valid())).status, 201)
  const tooSoon = await post(valid())
  assert.equal(tooSoon.status, 429)
  assert.ok(Number(tooSoon.headers.get('retry-after')) > 0)
  assert.equal((await post(valid(), undefined, '10.0.0.2')).status, 201, 'another sender is not affected')

  const t0 = 1_000_000_000_000
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit('k', '', t0 + i * 20_000).ok, true)
    recordSubmission('k', '', t0 + i * 20_000)
  }
  const blocked = checkRateLimit('k', '', t0 + 200_000)
  assert.equal(blocked.ok, false)
  assert.equal(checkRateLimit('k', '', t0 + 61 * 60_000).ok, true, 'allowed again after the hour')
})

// ------------------------------------------------------------------ access control

test('support: users see only their own requests', async () => {
  const mineRef = (await json(await post(valid(), 'citizen@demo.vyra'))).reference
  await post(valid(), 'neighbour@demo.vyra', '10.0.0.9')
  const a = (await json(await list('mine', 'citizen@demo.vyra'))).requests
  const b = (await json(await list('mine', 'neighbour@demo.vyra'))).requests
  assert.equal(a.length, 1)
  assert.equal(b.length, 1)
  assert.equal(a[0].reference, mineRef)
  assert.notEqual(a[0].reference, b[0].reference)
  assert.equal((await list('mine')).status, 401, 'anonymous cannot list')
  assert.equal((await list('all', 'citizen@demo.vyra')).status, 403, 'a citizen cannot ask for everything')
  assert.equal((await list('all', 'dispatcher@demo.vyra')).status, 403, 'responders are not support staff')
})

test('support: only administrators can update, and only status and category', async () => {
  const ref = (await json(await post(valid(), 'citizen@demo.vyra'))).reference
  const id = (await json(await list('mine', 'citizen@demo.vyra'))).requests.find((r: { reference: string }) => r.reference === ref).id

  assert.equal((await patch(id, { status: 'resolved' })).status, 401)
  assert.equal((await patch(id, { status: 'resolved' }, 'citizen@demo.vyra')).status, 403, 'the owner cannot change status')
  assert.equal((await patch(id, { status: 'resolved' }, 'dispatcher@demo.vyra')).status, 403)

  const done = await patch(id, { status: 'in_progress', category: 'privacy' }, 'admin@demo.vyra')
  assert.equal(done.status, 200)
  const row = (await json(done)).request
  assert.equal(row.status, 'in_progress')
  assert.equal(row.category, 'privacy')
  assert.equal(row.message.startsWith('My report status'), true, 'message untouched')

  assert.equal((await patch(id, { status: 'archived' }, 'admin@demo.vyra')).status, 400)
  assert.equal((await patch(id, { category: 'billing' }, 'admin@demo.vyra')).status, 400)
  assert.equal((await patch(id, { message: 'rewritten' }, 'admin@demo.vyra')).status, 400, 'nothing else can be edited')
  assert.equal((await patch('00000000-0000-4000-8000-000000000000', { status: 'resolved' }, 'admin@demo.vyra')).status, 404)

  // the owner sees the new status
  assert.equal((await json(await list('mine', 'citizen@demo.vyra'))).requests[0].status, 'in_progress')
})

// ------------------------------------------------------------------ FAQ

test('faq: search and category filters', () => {
  assert.ok(FAQ_ITEMS.length >= 15)
  assert.equal(new Set(FAQ_ITEMS.map((i) => i.id)).size, FAQ_ITEMS.length, 'ids are unique (they are used as anchors)')
  for (const i of FAQ_ITEMS) assert.ok(FAQ_CATEGORIES.some((c) => c.id === i.category), i.id)
  assert.ok(filterFaq(FAQ_ITEMS, 'pictures').some((i) => i.id === 'upload-pictures'))
  assert.ok(filterFaq(FAQ_ITEMS, 'SHELTER').some((i) => i.id === 'shelters'))
  assert.ok(filterFaq(FAQ_ITEMS, 'blocked roads').some((i) => i.id === 'blocked-roads'))
  assert.equal(filterFaq(FAQ_ITEMS, 'zzzqqq').length, 0)
  assert.equal(filterFaq(FAQ_ITEMS, '').length, FAQ_ITEMS.length)
  const privacy = filterFaq(FAQ_ITEMS, '', 'privacy')
  assert.ok(privacy.length > 0 && privacy.every((i) => i.category === 'privacy'))
  assert.equal(filterFaq(FAQ_ITEMS, 'shelter', 'privacy').length, 0)
  for (const cat of FAQ_CATEGORIES) assert.ok(FAQ_ITEMS.some((i) => i.category === cat.id), `category ${cat.id} has questions`)
})

test('faq: required topics are covered and AI is not overstated', () => {
  const text = FAQ_ITEMS.map((i) => `${i.question} ${i.answer.join(' ')}`).join(' ').toLowerCase()
  for (const topic of ['submit', 'picture', 'status', 'shelter', 'blocked road', 'accura', 'privacy', 'precaution']) assert.ok(text.includes(topic), topic)
  const ai = FAQ_ITEMS.find((i) => i.id === 'ai-accuracy')!.answer.join(' ').toLowerCase()
  assert.ok(ai.includes('can be wrong') && ai.includes('official emergency guidance'))
})

test('content: every internal link points at a page that exists', () => {
  const links = [...FAQ_ITEMS.flatMap((i) => i.links ?? [])]
  const pageExists = (href: string) => {
    const path = href.split('#')[0].replace(/^\//, '')
    return existsSync(join(__dirname, '..', 'src', 'app', path, 'page.tsx')) || (path === '' && existsSync(join(__dirname, '..', 'src', 'app', 'page.tsx')))
  }
  for (const l of links) assert.ok(pageExists(l.href), `missing page for ${l.href}`)
  for (const l of links.filter((x) => x.href.includes('#'))) {
    const id = l.href.split('#')[1]
    assert.ok(PRECAUTIONS.some((c) => c.id === id), `missing anchor ${id}`)
  }
})

// ------------------------------------------------------------------ emergency precautions

test('precautions: required categories, and only sourced emergency numbers', () => {
  const ids = PRECAUTIONS.map((c) => c.id)
  for (const id of ['preparedness', 'flood', 'fire', 'earthquake', 'storm', 'landslide', 'firstaid']) assert.ok(ids.includes(id), id)
  assert.match(CONTENT_REVIEWED, /^\d{4}-\d{2}-\d{2}$/)
  for (const c of OFFICIAL_CONTACTS) {
    assert.match(c.number, /^(\d{2,4}|\+92 \(21\) \d{4})$/)
    assert.match(c.sourceUrl, /^https:\/\/[^\s]+\.(gov|gos)\.pk\//, 'sources are official government sites')
    assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(c.source.length > 5)
  }
  // no phone-number-like text hides inside the general guidance
  const prose = PRECAUTIONS.flatMap((c) => c.groups.flatMap((g) => g.items)).join(' ')
  assert.ok(!/\b\d{3,}\b/.test(prose), 'general guidance contains no phone numbers')
  const all = prose.toLowerCase()
  for (const phrase of ['evacuation order', 'floodwater', 'power line', 'unstable', 'trained']) assert.ok(all.includes(phrase) || all.includes(phrase.replace('unstable', 'damaged')), phrase)
  assert.ok(all.includes('never enter') || all.includes('entering floodwater, a burning building'), 'tells people not to enter danger to rescue someone')
  // "safe" may only appear in conditions ("until officials say it is safe", "check that the place is safe"), never as a claim
  const claims = all.replace(/(unless|before|until|claims about|check that)[^.]*safe/g, '')
  assert.ok(!/\b(is|are) (completely |totally )?safe\b/.test(claims), 'does not declare places safe')
})

// ------------------------------------------------------------------ no email, no new secrets

test('support: no email sending code, packages or settings were added', () => {
  const root = join(__dirname, '..')
  const files = [
    'src/lib/support.ts', 'src/lib/supportServer.ts', 'src/lib/supportClient.ts', 'src/app/api/support/route.ts', 'src/app/api/support/[id]/route.ts',
    'src/app/contact/page.tsx', 'src/app/admin/support/page.tsx', 'supabase/migrations/007_support_requests.sql', '.env.example',
  ]
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8').replace(/^\s*(\/\/|--|#).*$/gm, '') // ignore comments that say "no email"
    assert.ok(!/nodemailer|sendgrid|mailgun|smtp|resend|gmail|googleapis|mailto:|sendmail|postmark|\bses\b/i.test(src), `${f} must not contain email delivery code`)
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ')
  assert.ok(!/mail|smtp|sendgrid|resend|googleapis/i.test(deps))
})

test('navigation: header and footer link to the three new pages', () => {
  const header = readFileSync(join(__dirname, '..', 'src/components/common/SiteHeader.tsx'), 'utf8')
  const footer = readFileSync(join(__dirname, '..', 'src/components/common/SiteFooter.tsx'), 'utf8')
  for (const href of ['/faq', '/contact', '/precautions']) {
    assert.ok(header.includes(`'${href}'`), `header ${href}`)
    assert.ok(footer.includes(`"${href}"`), `footer ${href}`)
  }
  assert.ok(statSync(join(__dirname, '..', 'src/app/admin/support/page.tsx')).isFile())
  assert.ok(readdirSync(join(__dirname, '..', 'supabase/migrations')).includes('007_support_requests.sql'))
})
