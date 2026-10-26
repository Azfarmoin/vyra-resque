import { NextRequest, NextResponse } from 'next/server'
import { buildAlertsView } from '@/lib/alerts/monitor'
import { getAlertStore, getProviders } from '@/lib/alerts/service'

export const dynamic = 'force-dynamic'

// GET /api/alerts[?history=1]
// Returns current alerts (and, with history=1, the last 30 days) plus the freshness of every data source.
// Location matching is done in the browser, so a person's position is never sent to the server just to read alerts.
export async function GET(request: NextRequest) {
  try {
    const history = request.nextUrl.searchParams.get('history') === '1'
    const view = await buildAlertsView(getAlertStore(), getProviders(), { history })
    return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('alerts: could not load', err instanceof Error ? err.message : 'unknown error')
    return NextResponse.json({ error: 'Alerts are temporarily unavailable. Check official channels directly.' }, { status: 503 })
  }
}
