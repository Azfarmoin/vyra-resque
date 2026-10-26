import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard } from '@/lib/flood/http'
import { shelterEvidence } from '@/lib/flood/integration'

export const dynamic = 'force-dynamic'

// GET /api/flood/scenarios/:id/shelters - what the estimate says about each verified shelter. Does not rank or change shelters.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const deps = getFloodDeps(g.user)
    const s = await deps.repo.get(params.id, g.user)
    if (!s) return fail(404, 'not_found', 'Scenario not found.')
    return NextResponse.json(await shelterEvidence(s, deps.assets), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return handle(e) }
}
