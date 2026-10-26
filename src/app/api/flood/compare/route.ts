import { NextRequest, NextResponse } from 'next/server'
import { compareScenarios } from '@/lib/flood/compare'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard } from '@/lib/flood/http'

export const dynamic = 'force-dynamic'

// GET /api/flood/compare?a=<id>&b=<id>
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const a = request.nextUrl.searchParams.get('a') || ''
    const b = request.nextUrl.searchParams.get('b') || ''
    if (!a || !b || a === b) return fail(400, 'invalid_request', 'Choose two different scenarios to compare.')
    const deps = getFloodDeps(g.user)
    const [A, B] = await Promise.all([deps.repo.get(a, g.user), deps.repo.get(b, g.user)])
    if (!A || !B) return fail(404, 'not_found', 'One of the scenarios was not found.')
    await deps.repo.audit({ action: 'compare', detail: { a, b } }, g.user)
    return NextResponse.json(compareScenarios(A, B), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return handle(e) }
}
