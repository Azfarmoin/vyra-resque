import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { handle, guard, readJson } from '@/lib/flood/http'
import { scenarioInputSchema } from '@/lib/flood/schema'
import { runScenario } from '@/lib/flood/scenario'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/flood/simulate - run a scenario and return it WITHOUT saving anything. Nothing is written to any table except
// an audit line; no incident, priority, route or dispatch is touched.
export async function POST(request: NextRequest) {
  const g = await guard(request, { limit: { key: 'flood-sim', max: 10 } })
  if (!g.ok) return g.res
  try {
    const input = scenarioInputSchema.parse(await readJson(request))
    const deps = getFloodDeps(g.user)
    const run = await runScenario(input, deps)
    await deps.repo.audit({ action: 'simulate', detail: { kind: run.result.kind, area: run.result.area.label, tier: run.result.tier.id } }, g.user)
    return NextResponse.json({ saved: false, name: run.name, result: run.result, layers: run.layers }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return handle(e)
  }
}
