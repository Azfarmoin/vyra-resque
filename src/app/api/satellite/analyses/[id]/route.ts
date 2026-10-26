import { NextRequest } from 'next/server'
import { fail, guard, json } from '@/lib/satellite/http'
import { ADVISORY, getAnalysisView } from '@/lib/satellite/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return json({ analysis: await getAnalysisView(g.user, params.id), advisory: ADVISORY }) } catch (e) { return fail(e) }
}
