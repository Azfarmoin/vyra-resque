import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/db'
import { handleError, HttpError, loadReport } from '@/lib/reportService'
import { AuthError, resolveCaller } from '@/lib/serverAuth'
import { assertMayAttach, assertStaff, isStaff } from '@/lib/attachmentAccess'
import { analyzeBodySchema, reviewBodySchema } from '@/lib/photoAnalysis/schema'
import { analyzeAttachment, staffView, submitterView } from '@/lib/photoAnalysis/service'
import { checkRateLimit } from '@/lib/routing/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ctx = { params: { id: string; aid: string } }

async function load(params: Ctx['params']) {
  const report = await loadReport(params.id)
  const store = getStore()
  const att = (await store.listAttachments(report.id)).find((a) => a.id === params.aid || a.client_id === params.aid)
  if (!att) throw new HttpError(404, 'Photo not found')
  return { report, att }
}

// POST - (re)run the analysis. Only the person who owns the report (or the device that made it) may start
// it, and only with consent. Idempotent: an existing completed analysis is returned unless force=true.
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { report, att } = await load(params)
    assertMayAttach(await resolveCaller(request), report, request.headers.get('x-report-client-id'))
    const body = analyzeBodySchema.parse(await request.json().catch(() => ({})))
    const limited = checkRateLimit(`analyze:${report.id}`, { limit: 20, windowMs: 10 * 60_000 })
    if (!limited.ok) throw new HttpError(429, `Too many analysis requests. Try again in ${limited.retryAfterS}s.`)
    const { analysis, reused } = await analyzeAttachment({ att, uploaderId: report.reporter_id, consent: body.consent, force: body.force })
    return NextResponse.json({ analysis: submitterView(analysis), reused })
  } catch (err) {
    return handleError(err)
  }
}

// GET - the reporter sees their own photo's analysis; staff see it with review state.
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { report, att } = await load(params)
    const caller = await resolveCaller(request)
    if (!isStaff(caller)) assertMayAttach(caller, report, request.headers.get('x-report-client-id'))
    const a = await getStore().getAnalysis(att.id)
    if (!a) return NextResponse.json({ analysis: null })
    return NextResponse.json({ analysis: isStaff(caller) ? staffView(a) : submitterView(a) })
  } catch (err) {
    return handleError(err)
  }
}

// PATCH - staff record a human review; the reporter records what they did with the suggestions.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { report, att } = await load(params)
    const caller = await resolveCaller(request)
    const body = reviewBodySchema.parse(await request.json().catch(() => ({})))
    const store = getStore()
    const a = await store.getAnalysis(att.id)
    if (!a) throw new HttpError(404, 'No analysis for this photo yet')
    if (isStaff(caller)) {
      assertStaff(caller)
      if (!body.review_status) throw new HttpError(400, 'review_status is required')
      const saved = await store.saveAnalysis({
        attachment_id: att.id,
        report_id: report.id,
        review_status: body.review_status,
        review_note: body.review_note ?? null,
        reviewed_by: caller.userId,
        reviewed_at: new Date().toISOString(),
      })
      return NextResponse.json({ analysis: staffView(saved) })
    }
    assertMayAttach(caller, report, request.headers.get('x-report-client-id'))
    if (!body.user_action) throw new AuthError(403, 'Only responders can review an analysis', 'forbidden')
    const saved = await store.saveAnalysis({ attachment_id: att.id, report_id: report.id, user_action: body.user_action })
    return NextResponse.json({ analysis: submitterView(saved) })
  } catch (err) {
    return handleError(err)
  }
}
