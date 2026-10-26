import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET /api/shelters/dashboard - occupancy, remaining capacity, stale records, access problems and hazard exposure. Responders and administrators.
export const GET = (request: NextRequest) => respond(request, (c, d) => H.dashboard(c.actor, d))
