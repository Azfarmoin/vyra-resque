import { NextRequest, NextResponse } from 'next/server'
import { getStore } from '@/lib/db'
import { handleError, loadReport } from '@/lib/reportService'
import { resolveCaller } from '@/lib/serverAuth'
import { assertStaff } from '@/lib/attachmentAccess'
import { combineAnalyses } from '@/lib/photoAnalysis/combine'
import { staffView } from '@/lib/photoAnalysis/service'

export const dynamic = 'force-dynamic'

// GET /api/reports/:id/analyses - responders/admins: every photo's analysis plus a combined summary.
// Everything here is an UNVERIFIED finding until a person reviews it; it never changes triage scores,
// zones, blocked-road records or dispatch.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    assertStaff(await resolveCaller(request))
    const report = await loadReport(params.id)
    const store = getStore()
    const [atts, rows] = await Promise.all([store.listAttachments(report.id), store.listAnalyses(report.id)])
    const byAtt = new Map(rows.map((r) => [r.attachment_id, r]))
    const photos = atts.map((a, i) => ({ attachment_id: a.id, label: `Photo ${i + 1}`, analysis: byAtt.get(a.id) ? staffView(byAtt.get(a.id)!) : null }))
    const combined = combineAnalyses(
      photos.filter((p) => p.analysis?.result).map((p) => ({ attachment_id: p.attachment_id, label: p.label, result: p.analysis!.result! }))
    )
    return NextResponse.json({ photos, combined, unverified: true })
  } catch (err) {
    return handleError(err)
  }
}
