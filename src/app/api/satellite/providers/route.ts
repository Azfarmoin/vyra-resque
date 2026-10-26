import { NextRequest } from 'next/server'
import { fail, guard, json } from '@/lib/satellite/http'
import { ADVISORY, listProviderStatuses } from '@/lib/satellite/service'
import { limits } from '@/lib/satellite/validation'

export const dynamic = 'force-dynamic'

// GET /api/satellite/providers - which imagery sources exist and whether each can be used right now (responders only).
export async function GET(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return json({ providers: listProviderStatuses(), advisory: ADVISORY, limits: limits() }) } catch (e) { return fail(e) }
}
