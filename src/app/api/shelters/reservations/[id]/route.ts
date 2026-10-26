import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// PATCH /api/shelters/reservations/:id - { action: confirm_arrival | depart | cancel | extend_hold }. An arrival is only ever recorded by an explicit confirm_arrival.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.reservationAction(c.actor, params.id, body, d), { rateKey: 'shelter-reserve', limit: 60 })
}
