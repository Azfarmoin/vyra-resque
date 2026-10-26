import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET  /api/shelters/reservations?shelterId=&incidentId=&dispatchId=&active=1
// POST /api/shelters/reservations - hold capacity for an evacuation group (responders and administrators). Idempotent on idempotencyKey.
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  return respond(request, (c, d) => H.listReservations(c.actor, { shelterId: q.get('shelterId') ?? undefined, incidentId: q.get('incidentId') ?? undefined, dispatchId: q.get('dispatchId') ?? undefined, activeOnly: q.get('active') === '1' }, d))
}
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.reserve(c.actor, body, d), { rateKey: 'shelter-reserve', limit: 30 })
}
