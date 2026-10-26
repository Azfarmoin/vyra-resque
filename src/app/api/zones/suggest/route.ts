import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { suggestZones } from '@/lib/zones/service'

export const dynamic = 'force-dynamic'

// POST /api/zones/suggest  { commit?: boolean } - staff only. Suggests zone changes from open report clusters.
// Nothing is changed or published: with commit=true the proposals are saved as private AI drafts for a person to review.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    return NextResponse.json(await suggestZones(await identify(request), body?.commit === true), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
