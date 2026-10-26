import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET /api/shelters/exceptions (staff) and POST (administrators): a recorded, time-limited authorization to use a closed shelter or exceed capacity.
export const GET = (request: NextRequest) => respond(request, (c, d) => H.listExceptions(c.actor, d))
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.createException(c.actor, body, d))
}
