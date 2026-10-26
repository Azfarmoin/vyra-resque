import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard, readJson } from '@/lib/flood/http'
import { routeExposure } from '@/lib/flood/integration'
import { routeExposureSchema } from '@/lib/flood/schema'

export const dynamic = 'force-dynamic'

// POST /api/flood/scenarios/:id/routes { routes: [{ id, geometry: [[lat,lng],...] }] }
// Supplementary evidence for the existing route analysis. Read only: the route analysis, its ranking and decisions are untouched.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const body = routeExposureSchema.parse(await readJson(request, 3_000_000))
    const s = await getFloodDeps(g.user).repo.get(params.id, g.user)
    if (!s) return fail(404, 'not_found', 'Scenario not found.')
    return NextResponse.json(routeExposure(s, body.routes as { id: string; geometry: [number, number][] }[]), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return handle(e) }
}
