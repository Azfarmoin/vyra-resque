import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { revisions } from '@/lib/safety/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { hazard: string } }) {
  try {
    return NextResponse.json({ revisions: await revisions(await identify(request), params.hazard) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
