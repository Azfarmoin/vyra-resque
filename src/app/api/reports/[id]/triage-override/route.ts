import { NextRequest, NextResponse } from 'next/server'
<<<<<<< HEAD
import { staffGate } from '@/lib/staffGate'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import { applyChange, handleError, HttpError, loadReport, parseBody } from '@/lib/reportService'
import { overrideSchema } from '@/lib/validation'
import { withTriage } from '@/lib/triage'

export const dynamic = 'force-dynamic'

// PATCH /api/reports/:id/triage-override - { priority | null, reason, by? }
// The responder makes the final decision; the reason is mandatory and kept in the history.
// priority: null returns the case to the suggested priority.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
<<<<<<< HEAD
  const denied = await staffGate(request)
  if (denied) return denied
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  try {
    const { priority, reason, by } = await parseBody(request, overrideSchema)
    const before = withTriage(await loadReport(params.id))

    if (priority) {
      const report = await applyChange(
        params.id,
        { triage_override: { priority, reason, by, at: new Date().toISOString() } },
        {
          action: 'override',
          actor: by,
          from: before.priority,
          to: priority,
          note: `${reason} (suggested: ${before.triage.suggestedPriority}, score ${before.triage.score})`,
        }
      )
      return NextResponse.json({ report })
    }

    if (!before.overridden) throw new HttpError(400, 'There is no override to clear')
    const report = await applyChange(
      params.id,
      { triage_override: null },
      { action: 'override_cleared', actor: by, from: before.priority, to: before.triage.suggestedPriority, note: reason }
    )
    return NextResponse.json({ report })
  } catch (err) {
    return handleError(err)
  }
}
