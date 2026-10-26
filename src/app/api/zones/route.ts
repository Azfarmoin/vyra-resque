import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { parseBBox } from '@/lib/zones/geometry'
import { createZone, listZones } from '@/lib/zones/service'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

// GET /api/zones?bbox=minLng,minLat,maxLng,maxLat&zoom=12&view=&verify=&q=
// Public. Returns only what the public may see (never drafts or AI suggestions). Geometry is lightened for the
// requested zoom; GET /api/zones/:id returns the full source geometry. `include=hidden` is honoured for staff only.
export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const bboxRaw = p.get('bbox')
    const bbox = parseBBox(bboxRaw)
    if (bboxRaw && !bbox) return NextResponse.json({ error: 'bbox must be minLng,minLat,maxLng,maxLat within range' }, { status: 400 })
    const zoom = p.get('zoom') != null && Number.isFinite(Number(p.get('zoom'))) ? Number(p.get('zoom')) : null
    const caller = await identify(request)
    const data = await listZones(caller, { bbox, zoom, view: p.get('view') ?? undefined, verify: p.get('verify') ?? undefined, q: p.get('q') ?? undefined, includeHidden: p.get('include') === 'hidden', full: p.get('full') === '1' })
    return NextResponse.json(data, { headers: NO_STORE })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/zones - responders (unofficial zones) and administrators (anything). Everyone else: 401/403.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
    const zone = await createZone(await identify(request), body)
    return NextResponse.json({ zone }, { status: 201, headers: NO_STORE })
  } catch (err) {
    return handleError(err)
  }
}
