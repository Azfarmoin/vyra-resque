import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { zoneAudit } from '@/lib/zones/service'

export const dynamic = 'force-dynamic'

// GET /api/zones/:id/audit - who changed what, when and why. Staff only.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ audit: await zoneAudit(await identify(request), params.id) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
