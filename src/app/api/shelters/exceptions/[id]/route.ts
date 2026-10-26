import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// DELETE /api/shelters/exceptions/:id - revoke an exception (administrators).
export const DELETE = (request: NextRequest, { params }: { params: { id: string } }) => respond(request, (c, d) => H.revokeException(c.actor, params.id, d))
