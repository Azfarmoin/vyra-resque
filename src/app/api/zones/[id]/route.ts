import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { deleteZone, getZone, updateZone } from '@/lib/zones/service'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

// GET /api/zones/:id - one zone with its full (unsimplified) source geometry.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ zone: await getZone(await identify(request), params.id) }, { headers: NO_STORE })
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/zones/:id - { action?: 'update'|'deactivate'|'cancel'|'reactivate', revision, change_reason, ...fields }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
    return NextResponse.json({ zone: await updateZone(await identify(request), params.id, body) }, { headers: NO_STORE })
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/zones/:id - administrators only, and only unpublished drafts. Published zones are cancelled instead.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    await deleteZone(await identify(request), params.id)
    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (err) {
    return handleError(err)
  }
}
