import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard, readJson } from '@/lib/flood/http'

export const dynamic = 'force-dynamic'

// PATCH { verified } - administrators only. DELETE - the recorder (while unverified) or an administrator.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request, { admin: true })
  if (!g.ok) return g.res
  try {
    const { verified } = z.object({ verified: z.boolean() }).strict().parse(await readJson(request, 2000))
    const o = await getFloodDeps(g.user).repo.setObservationVerified(params.id, verified, g.user)
    return o ? NextResponse.json({ observation: o }) : fail(404, 'not_found', 'Observation not found.')
  } catch (e) { return handle(e) }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try {
    const ok = await getFloodDeps(g.user).repo.removeObservation(params.id, g.user)
    return ok ? NextResponse.json({ deleted: true }) : fail(404, 'not_found', 'Observation not found, already verified, or not yours to delete.')
  } catch (e) { return handle(e) }
}
