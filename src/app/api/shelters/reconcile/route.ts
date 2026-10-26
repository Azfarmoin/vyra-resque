import { NextRequest } from 'next/server'
import * as H from '@/lib/shelters/handlers'
import { readJson, respond } from '@/lib/shelters/runtime'

export const dynamic = 'force-dynamic'

// POST /api/shelters/reconcile - { shelterId? } recompute held places from the reservation ledger and report discrepancies (administrators).
export async function POST(request: NextRequest) {
  const body = (await readJson(request)) as { shelterId?: string } | undefined
  return respond(request, (c, d) => H.reconcile(c.actor, body?.shelterId ?? null, d))
}
