import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET  /api/shelters/coverage?cellKm=1&reachMinutes=30 - coverage-analysis grid.
// POST /api/shelters/coverage - { candidates: [{ name, lat, lng, capacity }], cellKm?, reachMinutes? } compares hypothetical sites. Planning aid only.
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined)
  return respond(request, (c, d) => H.coverage(c.actor, { cellKm: num('cellKm'), reachMinutes: num('reachMinutes') }, d), { rateKey: 'shelter-coverage', limit: 20 })
}
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.evaluateHypotheticals(c.actor, body, d), { rateKey: 'shelter-coverage', limit: 20 })
}
