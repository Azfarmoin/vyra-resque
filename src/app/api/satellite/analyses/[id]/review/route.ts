import { NextRequest } from 'next/server'
import { fail, guard, json, readJson } from '@/lib/satellite/http'
import { ADVISORY, reviewAnalysis } from '@/lib/satellite/service'

export const dynamic = 'force-dynamic'

// POST /api/satellite/analyses/:id/review - { state, note?, acknowledgedLimitations? }. Appends to the review history.
// This records a human opinion about the satellite finding. It changes nothing about any incident, road, zone or team.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return json({ analysis: await reviewAnalysis(g.user, params.id, await readJson(request)), advisory: ADVISORY }) } catch (e) { return fail(e) }
}
