import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { handle, guard, readJson } from '@/lib/flood/http'
import { importSchema } from '@/lib/flood/schema'
import { importHydraulic } from '@/lib/flood/scenario'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/flood/import - ADMINISTRATORS ONLY. Stores the output of an EXTERNAL hydraulic model as a scenario.
// It is labelled "validated" only when a complete validation record is supplied; otherwise it is shown as unvalidated.
export async function POST(request: NextRequest) {
  const g = await guard(request, { admin: true, limit: { key: 'flood-import', max: 5 } })
  if (!g.ok) return g.res
  try {
    const input = importSchema.parse(await readJson(request, 12_000_000))
    const deps = getFloodDeps(g.user)
    const run = await importHydraulic(input, deps)
    const saved = await deps.repo.save(run, { name: input.name, description: input.description ?? null }, g.user)
    await deps.repo.audit({ scenarioId: saved.id, action: 'import', detail: { tier: saved.results.tier.id, model: input.model.name } }, g.user)
    return NextResponse.json({ saved: true, scenario: saved }, { status: 201 })
  } catch (e) { return handle(e) }
}
