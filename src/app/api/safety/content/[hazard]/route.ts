import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { saveContent } from '@/lib/safety/service'

export const dynamic = 'force-dynamic'

// PUT /api/safety/content/:hazard  { action: 'save_draft'|'publish'|'retire', content?, reviewed_by?, reviewed_on?, change_reason }
export async function PUT(request: NextRequest, { params }: { params: { hazard: string } }) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
    const row = await saveContent(await identify(request), { ...body, hazard_id: params.hazard })
    return NextResponse.json({ row }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
