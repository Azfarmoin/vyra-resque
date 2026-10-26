import { NextRequest } from 'next/server'
import { fail, guard, json, readJson } from '@/lib/satellite/http'
import { searchScenes } from '@/lib/satellite/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST /api/satellite/search - { provider, collection, aoi, before:{start,end}, after:{start,end}, maxCloud? }
export async function POST(request: NextRequest) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return json(await searchScenes(g.user, await readJson(request))) } catch (e) { return fail(e) }
}
