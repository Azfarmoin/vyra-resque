import { NextRequest, NextResponse } from 'next/server'
import { fail, guard } from '@/lib/satellite/http'
import { getImage } from '@/lib/satellite/service'

export const dynamic = 'force-dynamic'

// GET /api/satellite/analyses/:id/image/before|after|change - PNG previews at analysis resolution (responders only).
export async function GET(request: NextRequest, { params }: { params: { id: string; kind: string } }) {
  const g = await guard(request)
  if (!g.ok) return g.res
  try { return new NextResponse(new Uint8Array(await getImage(g.user, params.id, params.kind)), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } }) } catch (e) { return fail(e) }
}
