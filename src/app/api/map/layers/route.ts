import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/db'
import { handleError } from '@/lib/reportService'

export const dynamic = 'force-dynamic'

// GET /api/map/layers?area= - verified shelters, active rescue teams and blocked roads
export async function GET(request: NextRequest) {
  try {
    const area = request.nextUrl.searchParams.get('area') || undefined
    return NextResponse.json(await getStore().mapLayers(area))
  } catch (err) {
    return handleError(err)
  }
}
