import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { parseBBox } from '@/lib/zones/geometry'
import { handle, guard, readJson } from '@/lib/flood/http'
import { observationSchema } from '@/lib/flood/schema'
import { FloodError } from '@/lib/flood/types'

export const dynamic = 'force-dynamic'

// Real flood observations: entered by staff or imported from a named source. VYRA never generates them.
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const bbox = parseBBox(request.nextUrl.searchParams.get('bbox')) ?? undefined
    return NextResponse.json({ observations: await getFloodDeps(g.user).repo.observations(g.user, bbox) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return handle(e) }
}

export async function POST(request: NextRequest) {
  const g = await guard(request, { limit: { key: 'flood-obs', max: 30 } })
  if (!g.ok) return g.res
  try {
    const o = observationSchema.parse(await readJson(request, 20_000))
    if (Date.parse(o.observedAt) > Date.now() + 86_400_000) throw new FloodError('invalid_input', 400, 'An observation cannot be dated in the future.')
    const deps = getFloodDeps(g.user)
    const saved = await deps.repo.addObservation({ lat: o.lat, lng: o.lng, depthM: o.depthM, observedAt: o.observedAt, source: o.source, sourceUrl: o.sourceUrl ?? null, method: o.method ?? null, notes: o.notes ?? null }, g.user)
    await deps.repo.audit({ action: 'observation', detail: { id: saved.id } }, g.user)
    return NextResponse.json({ observation: saved }, { status: 201 })
  } catch (e) { return handle(e) }
}
