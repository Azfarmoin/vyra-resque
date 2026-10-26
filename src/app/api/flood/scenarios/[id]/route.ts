import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard, readJson } from '@/lib/flood/http'
import { patchSchema } from '@/lib/flood/schema'

export const dynamic = 'force-dynamic'
const ID = /^[0-9a-fA-F-]{8,64}$/

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  if (!ID.test(params.id)) return fail(404, 'not_found', 'Scenario not found.')
  try {
    const s = await getFloodDeps(g.user).repo.get(params.id, g.user)
    return s ? NextResponse.json({ scenario: s }, { headers: { 'Cache-Control': 'no-store' } }) : fail(404, 'not_found', 'Scenario not found.')
  } catch (e) { return handle(e) }
}

// PATCH: rename / describe. Owner or administrator.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  if (!ID.test(params.id)) return fail(404, 'not_found', 'Scenario not found.')
  try {
    const patch = patchSchema.parse(await readJson(request, 10_000))
    const deps = getFloodDeps(g.user)
    const s = await deps.repo.update(params.id, patch, g.user)
    if (!s) return fail(404, 'not_found', 'Scenario not found, or it belongs to someone else.')
    await deps.repo.audit({ scenarioId: s.id, action: 'update', detail: patch }, g.user)
    return NextResponse.json({ scenario: s })
  } catch (e) { return handle(e) }
}

// DELETE: owner or administrator. Removes the simulation only.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  if (!ID.test(params.id)) return fail(404, 'not_found', 'Scenario not found.')
  try {
    const deps = getFloodDeps(g.user)
    const ok = await deps.repo.remove(params.id, g.user)
    if (!ok) return fail(404, 'not_found', 'Scenario not found, or it belongs to someone else.')
    await deps.repo.audit({ scenarioId: params.id, action: 'delete' }, g.user)
    return NextResponse.json({ deleted: true })
  } catch (e) { return handle(e) }
}
