import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { applyChange, detail, handleError, loadReport, parseBody } from '@/lib/reportService'
import { statusUpdateSchema } from '@/lib/validation'
import { OPEN_STATUSES } from '@/lib/constants'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

// GET /api/reports/:id - full report, live triage explanation and history (responders)
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    return NextResponse.json({ report: await detail(params.id) })
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/reports/:id - status update (kept for Stage 3 clients; same as /status)
export async function PATCH(request: NextRequest, { params }: Ctx) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const { status, note, by } = await parseBody(request, statusUpdateSchema)
    const current = await loadReport(params.id)
    const report = await applyChange(
      params.id,
      { status, resolved_at: OPEN_STATUSES.includes(status) ? null : new Date().toISOString() },
      { action: 'status', actor: by, from: current.status, to: status, note }
    )
    return NextResponse.json({ report })
  } catch (err) {
    return handleError(err)
  }
}
