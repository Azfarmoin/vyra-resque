import { NextRequest, NextResponse } from 'next/server'
import { handleError, loadReport, publicView } from '@/lib/reportService'

export const dynamic = 'force-dynamic'

// GET /api/reports/:id/public-status - the reference and status a reporter may see
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ report: publicView(await loadReport(params.id)) })
  } catch (err) {
    return handleError(err)
  }
}
