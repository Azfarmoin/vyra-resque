import { NextRequest } from 'next/server'
import { fail, guard, json, readJson } from '@/lib/satellite/http'
import { linkAnalysis } from '@/lib/satellite/service'

export const dynamic = 'force-dynamic'

// POST /api/satellite/analyses/:id/links - { targetType: report|hazard|zone, targetId, note? }
// Attaches the finding to a record as advisory evidence. It never edits that record.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return json({ link: await linkAnalysis(g.user, params.id, await readJson(request)) }, 201) } catch (e) { return fail(e) }
}
