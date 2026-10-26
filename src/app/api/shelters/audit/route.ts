import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// GET /api/shelters/audit?shelterId= - append-only audit trail (administrators).
export const GET = (request: NextRequest) => respond(request, (c, d) => H.audit(c.actor, { shelterId: request.nextUrl.searchParams.get('shelterId') ?? undefined }, d))
