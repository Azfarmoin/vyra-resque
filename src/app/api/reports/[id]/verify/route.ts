import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { applyChange, detail, handleError, loadReport, parseBody } from '@/lib/reportService'
import { verifySchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

// PATCH /api/reports/:id/verify - { verified, by? }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const { verified, by } = await parseBody(request, verifySchema)
    const current = await loadReport(params.id)
    if (current.verified === verified) return NextResponse.json({ report: await detail(params.id) })
    const report = await applyChange(params.id, { verified }, { action: 'verify', actor: by, from: current.verified, to: verified })
    return NextResponse.json({ report })
  } catch (err) {
    return handleError(err)
  }
}
