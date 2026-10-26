import { NextRequest, NextResponse } from 'next/server'
import { handleError } from '@/lib/reportService'
import { identify } from '@/lib/zones/auth'
import { adminContent, publishedContent } from '@/lib/safety/service'

export const dynamic = 'force-dynamic'

// GET /api/safety/content            -> public: reviewed, published guides that replace the built-in ones
// GET /api/safety/content?all=1      -> administrators: every row (drafts, retired) for the editor
export async function GET(request: NextRequest) {
  try {
    if (request.nextUrl.searchParams.get('all') === '1') return NextResponse.json({ rows: await adminContent(await identify(request)) }, { headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ items: await publishedContent() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
