// The satellite module must never act on an emergency by itself. These tests prove it two ways:
//  1. behaviour: run, review as "Confirmed by Reviewer" and link analyses, then compare every report and zone before and after.
//  2. structure: the satellite code contains no calls that could change reports, zones, dispatches, teams or triage.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getStore } from '../src/lib/db'
import { setSatelliteProviders } from '../src/lib/satellite/providers/registry'
import { setRoutingDeps } from '../src/lib/routing/deps'
import * as analysesRoute from '../src/app/api/satellite/analyses/route'
import * as reviewRoute from '../src/app/api/satellite/analyses/[id]/review/route'
import * as linksRoute from '../src/app/api/satellite/analyses/[id]/links/route'
import { analysisBody, call, ctx, fakeProvider, reset, RESPONDER, ADMIN } from './satellite.helpers'

beforeEach(reset)
const post = async (route: { POST: unknown }, body: unknown, as: string, c?: unknown) => { const r = await (route.POST as (r: unknown, c?: unknown) => Promise<Response>)(call('/x', { method: 'POST', body, as }), c); return { status: r.status, body: await r.json() } }

async function snapshot() {
  const s = getStore()
  const reports = await s.listReports({})
  const detail = await Promise.all(reports.map((r) => s.getReport(r.id)))
  return JSON.stringify({ reports, detail, zones: await s.listZones({ includeHidden: true }) })
}

test('confirming a satellite finding and linking it changes no report, zone, status, priority, verification or history', async () => {
  setSatelliteProviders([fakeProvider()])
  const store = getStore()
  const report = (await store.listReports({}))[0], zone = (await store.listZones({ includeHidden: true }))[0]
  const before = await snapshot()

  const created = await post(analysesRoute, analysisBody(), RESPONDER)
  assert.equal(created.status, 201)
  const id = created.body.analysis.id
  assert.equal(created.body.analysis.reviewState, 'needs_review', 'a new finding starts unreviewed, never confirmed')
  assert.equal(await snapshot(), before, 'running an analysis changes nothing')

  const confirm = await post(reviewRoute, { state: 'confirmed_by_reviewer', note: 'Compared with the field photo from the team.', acknowledgedLimitations: true }, ADMIN, ctx(id))
  assert.equal(confirm.status, 200); assert.equal(confirm.body.analysis.reviewState, 'confirmed_by_reviewer')
  assert.equal(await snapshot(), before, 'confirming a finding does NOT confirm the incident or change anything')

  setRoutingDeps({ loadHazards: async () => ({ hazards: [], skipped: [], sources: [], loadedAt: new Date().toISOString() }) })
  assert.equal((await post(linksRoute, { targetType: 'report', targetId: report.id }, RESPONDER, ctx(id))).status, 201)
  assert.equal((await post(linksRoute, { targetType: 'zone', targetId: zone.id }, RESPONDER, ctx(id))).status, 201)
  assert.equal(await snapshot(), before, 'linking attaches evidence without editing the linked records')
  const after = await store.getReport(report.id)
  assert.deepEqual(after, await store.getReport(report.id)); assert.equal(after?.status, report.status); assert.equal(after?.verified, report.verified)
  assert.equal(JSON.stringify((await store.listReports({})).find((r) => r.id === report.id)), JSON.stringify(report), 'the report row is byte-for-byte unchanged (status, verification, triage inputs)')
})
test('a finding is never auto-confirmed, whatever the result says', async () => {
  setSatelliteProviders([fakeProvider()])
  const r = await post(analysesRoute, analysisBody(), RESPONDER)
  assert.ok(r.body.analysis.stats.classes[3].pixels > 0, 'a large change was found')
  assert.equal(r.body.analysis.reviewState, 'needs_review'); assert.deepEqual(r.body.analysis.reviews, []); assert.deepEqual(r.body.analysis.links, [])
  assert.match(r.body.advisory, /Nothing here confirms an incident, closes a road, dispatches a team or changes a triage priority/)
})
test('the API offers no way to turn a finding into an emergency action', async () => {
  const files: string[] = []
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p) } }
  walk('src/app/api/satellite')
  const routes = files.filter((f) => f.endsWith('route.ts')).map((f) => f.replace(/\\/g, '/'))
  assert.deepEqual(routes.map((f) => f.replace('src/app/api/satellite/', '')).sort(), ['analyses/[id]/image/[kind]/route.ts', 'analyses/[id]/links/route.ts', 'analyses/[id]/review/route.ts', 'analyses/[id]/route.ts', 'analyses/route.ts', 'providers/route.ts', 'search/route.ts'])
  for (const f of routes) { const src = readFileSync(f, 'utf8'); assert.ok(!/export (async )?function (PATCH|PUT|DELETE)/.test(src), `${f} must not expose PATCH/PUT/DELETE`) }
})

const FORBIDDEN = [
  /\b(updateReport|insertReport|applyChange|setStatus|setPriority|setVerified|verifyReport|addEvent|overrideTriage|clearOverride|assignTeam|createDispatch|updateDispatch|dispatchTeam)\b/,
  /\b(insertZone|updateZone|deleteZone|cancelZone|setZoneStatus|updateShelter|updateTeam|insertBlockedRoad|updateBlockedRoad|closeRoad|blockRoad)\b/,
  /from\(\s*['"`](emergency_reports|report_events|disaster_zones|blocked_roads|route_hazards|rescue_teams|shelters|dispatches|zone_audit)['"`]\s*\)/,
]
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
function sources(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? sources(p) : /\.(ts|tsx)$/.test(f) ? [p] : [] }) }

test('structure: satellite library, routes and components contain no calls that change reports, zones, roads, teams or dispatches', () => {
  const files = [...sources('src/lib/satellite'), ...sources('src/app/api/satellite'), ...sources('src/components/satellite'), 'src/app/satellite/page.tsx']
  assert.ok(files.length > 20)
  for (const f of files) { const code = stripComments(readFileSync(f, 'utf8')); for (const re of FORBIDDEN) assert.ok(!re.test(code), `${f} matches ${re}`) }
})
test('structure: the browser code only talks to the satellite API for writes, and only reads other records', () => {
  for (const f of [...sources('src/components/satellite'), 'src/app/satellite/page.tsx', 'src/lib/satellite/client.ts']) {
    const code = stripComments(readFileSync(f, 'utf8'))
    assert.ok(!/method:\s*['"`](PATCH|PUT|DELETE)['"`]/.test(code), `${f} must not send PATCH/PUT/DELETE`)
    assert.ok(!/['"`]\/api\/(dispatch|teams|triage|reports\/[^'"`]*\/(status|verify|override))/.test(code), `${f} must not call emergency-action endpoints`)
  }
  const svc = stripComments(readFileSync('src/lib/satellite/service.ts', 'utf8'))
  const storeCalls = [...svc.matchAll(/getStore\(\)\.(\w+)/g)].map((m) => m[1]).sort()
  assert.deepEqual([...new Set(storeCalls)], ['getReport', 'getZone'], 'the service only reads one report or one zone, to check a link target exists')
})
