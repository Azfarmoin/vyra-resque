import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET   /api/shelters/:id  - responder/admin: one shelter with availability and data quality.
// PATCH /api/shelters/:id  - { occupancy: { count, basis } } for responders; registry fields for administrators.
export const GET = (request: NextRequest, { params }: { params: { id: string } }) => respond(request, (c, d) => H.getShelter(c.actor, params.id, d))
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.patchShelter(c.actor, params.id, body, d))
}
