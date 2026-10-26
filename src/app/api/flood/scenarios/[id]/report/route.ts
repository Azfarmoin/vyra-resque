import { NextRequest, NextResponse } from 'next/server'
import { getFloodDeps } from '@/lib/flood/deps'
import { fail, handle, guard } from '@/lib/flood/http'
import { renderHtml, renderPdf, toGeoJson } from '@/lib/flood/report'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'scenario'

// GET /api/flood/scenarios/:id/report?format=pdf|html|json|geojson - responders and administrators.
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(request, { limit: { key: 'flood-report', max: 12 } })
  if (!g.ok) return g.res
  try {
    const format = (request.nextUrl.searchParams.get('format') || 'pdf').toLowerCase()
    if (!['pdf', 'html', 'json', 'geojson'].includes(format)) return fail(400, 'invalid_request', 'format must be pdf, html, json or geojson.')
    const deps = getFloodDeps(g.user)
    const s = await deps.repo.get(params.id, g.user)
    if (!s) return fail(404, 'not_found', 'Scenario not found.')
    await deps.repo.audit({ scenarioId: s.id, action: 'export', detail: { format } }, g.user)
    const base = `vyra-flood-estimate-${safeName(s.name)}`
    const headers = (type: string, ext: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${base}.${ext}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    if (format === 'pdf') return new NextResponse(new Uint8Array(await renderPdf(s, g.user.name)), { headers: headers('application/pdf', 'pdf') })
    if (format === 'html') return new NextResponse(renderHtml(s, g.user.name), { headers: { ...headers('text/html; charset=utf-8', 'html'), 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } })
    if (format === 'geojson') return new NextResponse(JSON.stringify(toGeoJson(s)), { headers: headers('application/geo+json', 'geojson') })
    const { layers: _l, ...rest } = s
    return new NextResponse(JSON.stringify({ ...rest, exportedAt: new Date().toISOString() }, null, 2), { headers: headers('application/json', 'json') })
  } catch (e) { return handle(e) }
}
