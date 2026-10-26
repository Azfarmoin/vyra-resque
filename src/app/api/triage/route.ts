import { NextRequest, NextResponse } from 'next/server'
import { findTriaged, handleError, parseQuery } from '@/lib/reportService'
import { listQuerySchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

// GET /api/triage - open cases ranked by suggested/overridden priority, with explanations
export async function GET(request: NextRequest) {
  try {
    const q = parseQuery(request, listQuerySchema)
    return NextResponse.json(await findTriaged({ ...q, status: q.status || 'open' }))
  } catch (err) {
    return handleError(err)
  }
}
