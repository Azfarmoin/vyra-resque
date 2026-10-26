import { NextRequest, NextResponse } from 'next/server'
import { templateSummary } from '@/lib/alerts/ai'
import { effectiveStatus } from '@/lib/alerts/lifecycle'
import { getAlertStore } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'

// GET /api/alerts/:id - one alert, with an AI or template summary. Raw source payloads and admin identities are never returned.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const a = await getAlertStore().getAlert(params.id)
    if (!a) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    const { raw_source_metadata: _r, created_by: _c, ...rest } = a
    void _r; void _c
    const summary = a.ai_summary ?? { text: templateSummary(a), language: 'en', method: 'template' as const, generatedAt: new Date().toISOString() }
    return NextResponse.json({ alert: { ...rest, ai_summary: summary, effective_status: effectiveStatus(a) } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Alert could not be loaded.' }, { status: 503 })
  }
}
