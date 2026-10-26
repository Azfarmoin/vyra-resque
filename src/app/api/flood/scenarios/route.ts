import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { handle, guard, readJson } from '@/lib/flood/http'
import { saveSchema } from '@/lib/flood/schema'
import { runScenario } from '@/lib/flood/scenario'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/flood/scenarios - saved scenarios (summary rows only). Shared among responders and admins.
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const deps = getFloodDeps(g.user)
    return NextResponse.json({ scenarios: await deps.repo.list(g.user), isSimulation: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return handle(e)
  }
}

// POST /api/flood/scenarios - run AND save. Stored in the flood tables only, never as an incident.
export async function POST(request: NextRequest) {
  const g = await guard(request, { limit: { key: 'flood-sim', max: 10 } })
  if (!g.ok) return g.res
  try {
    const input = saveSchema.parse(await readJson(request))
    const deps = getFloodDeps(g.user)
    const run = await runScenario(input, deps)
    const saved = await deps.repo.save(run, { name: input.name, description: input.description ?? null }, g.user)
    await deps.repo.audit({ scenarioId: saved.id, action: 'create', detail: { kind: saved.kind, tier: saved.results.tier.id } }, g.user)
    return NextResponse.json({ saved: true, scenario: saved }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return handle(e)
  }
}
