import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireResponder } from '@/lib/routing/auth'
import { checkRateLimit } from '@/lib/routing/rateLimit'
import { getAnalysis, saveDecision } from '@/lib/routing/audit'

export const dynamic = 'force-dynamic'

/** An analysis older than this must be refreshed before a route is approved: conditions change. */
const MAX_ANALYSIS_AGE_MS = 15 * 60_000

const schema = z
  .object({
    analysisId: z.string().uuid(),
    candidateId: z.string().regex(/^route-\d{1,2}$/),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(600).optional(),
    acknowledgedLimitations: z.boolean().default(false),
  })
  .strict()

const fail = (status: number, code: string, error: string) => NextResponse.json({ code, error }, { status })

// POST /api/routes/decisions - the dispatcher's approve / reject of one candidate. Recorded, never automatic.
// Approving anything other than a clean "no hazards found" candidate needs a written reason; approving a
// route with a known blockage also needs the dispatcher to acknowledge it explicitly.
export async function POST(request: NextRequest) {
  const auth = await requireResponder(request)
  if (!auth.ok) return fail(auth.status, auth.status === 401 ? 'unauthenticated' : 'forbidden', auth.error)
  if (!checkRateLimit(`decide:${auth.user.id}`, { limit: 30 }).ok) return fail(429, 'rate_limited', 'Too many requests.')

  const text = await request.text().catch(() => '')
  if (text.length > 4096) return fail(413, 'too_large', 'Request body is too large.')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return fail(400, 'invalid_request', 'Request body must be JSON.')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) return NextResponse.json({ code: 'invalid_request', error: 'Validation failed', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, { status: 400 })
  const d = parsed.data

  const analysis = await getAnalysis(d.analysisId, auth.user)
  if (!analysis) return fail(404, 'analysis_not_found', 'That analysis was not found. Run it again.')
  const candidate = analysis.candidates.find((c) => c.id === d.candidateId)
  if (!candidate) return fail(404, 'candidate_not_found', 'That route is not part of the analysis.')

  if (d.decision === 'approved') {
    if (Date.now() - Date.parse(analysis.analyzedAt) > MAX_ANALYSIS_AGE_MS) return fail(409, 'analysis_stale', 'This analysis is more than 15 minutes old. Refresh it before approving a route.')
    if (candidate.status !== 'no_hazards_found' && (d.note?.length ?? 0) < 10) return fail(400, 'reason_required', 'Write a reason (at least 10 characters) for approving a route that has reported hazards or limited information.')
    if (candidate.status === 'known_blockage' && !d.acknowledgedLimitations) return fail(400, 'acknowledgement_required', 'Confirm that you have checked the known blockage with an authoritative source.')
  }

  const saved = await saveDecision(
    { analysisId: d.analysisId, candidateId: d.candidateId, decision: d.decision, note: d.note || null, acknowledgedLimitations: d.acknowledgedLimitations, candidateStatus: candidate.status, decidedBy: auth.user.id, decidedByName: auth.user.name },
    auth.user,
  )
  if (!saved) return fail(503, 'audit_unavailable', 'The decision could not be recorded, so it was not applied. Try again.')
  return NextResponse.json({ decision: saved }, { status: 201 })
}
