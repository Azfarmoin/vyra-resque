import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// POST /api/shelters/recommend - ranked, explained shelter options (and exclusions) for an incident or evacuation group. Responders and administrators.
export async function POST(request: NextRequest) {
  const body = await readJson(request)
  return respond(request, (c, d) => H.recommend(c.actor, body, d), { rateKey: 'shelter-recommend', limit: 20 })
}
