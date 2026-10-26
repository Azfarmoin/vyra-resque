// OPT-IN tests against real services. Skipped unless configured, so CI and offline runs stay green.
//   LIVE_OSRM_URL=https://your-osrm   npm run test:live
//   LIVE_ORS_KEY=...                  (optional, OpenRouteService)
//   ANTHROPIC_API_KEY=...             (optional, AI explanations)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { osrmProvider, orsProvider } from '../src/lib/routing/providers'
import { anthropicExplainer } from '../src/lib/ai/hazardExplanation'

const A: [number, number] = [24.8607, 67.0011] // Karachi
const B: [number, number] = [24.9056, 67.0822]

test('live OSRM returns real road geometry', { skip: !process.env.LIVE_OSRM_URL }, async () => {
  const routes = await osrmProvider(process.env.LIVE_OSRM_URL!).route({ origin: A, destination: B, vehicle: 'car', alternatives: 3 }, AbortSignal.timeout(15000))
  assert.ok(routes.length >= 1)
  assert.ok(routes[0].geometry.length > 10 && routes[0].distanceM > 5000 && routes[0].durationS > 300)
})

test('live ORS honours avoid polygons', { skip: !process.env.LIVE_ORS_KEY }, async () => {
  const p = orsProvider(process.env.LIVE_ORS_URL || 'https://api.openrouteservice.org', process.env.LIVE_ORS_KEY!)
  const base = await p.route({ origin: A, destination: B, vehicle: 'car', alternatives: 0 }, AbortSignal.timeout(20000))
  assert.ok(base.length >= 1)
  // Block a ring around the midpoint of the first route and expect a different path (or no path).
  const mid = base[0].geometry[Math.floor(base[0].geometry.length / 2)]
  const d = 0.0006
  const ring = [[mid[1] - d, mid[0] - d], [mid[1] + d, mid[0] - d], [mid[1] + d, mid[0] + d], [mid[1] - d, mid[0] + d], [mid[1] - d, mid[0] - d]]
  const avoided = await p.route({ origin: A, destination: B, vehicle: 'car', alternatives: 0, avoidRings: [ring] }, AbortSignal.timeout(20000))
  if (avoided.length) assert.notEqual(Math.round(avoided[0].distanceM), Math.round(base[0].distanceM))
})

test('live AI explainer returns schema-valid output', { skip: !process.env.ANTHROPIC_API_KEY }, async () => {
  const ex = anthropicExplainer()!
  const res = await ex(
    { vehicle: 'ambulance', routes: [{ routeId: 'route-1', rank: 1, status: 'Hazard reported', distanceKm: 8, durationMin: 14, hazards: [{ id: 'h1', kind: 'flooding', severity: 'high', verification: 'unverified', proximity: 'on_route', freshness: 'fresh', ageMinutes: 20, blocksRoad: null, text: 'Water on the road near the underpass' }], limitations: [], rankReasons: [] }] },
    AbortSignal.timeout(30000),
  )
  assert.equal(res.status.state, 'ok')
  assert.ok(res.routes.has('route-1'))
})
