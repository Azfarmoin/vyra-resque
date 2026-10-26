import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireResponder } from '@/lib/routing/auth'
import { checkRateLimit } from '@/lib/routing/rateLimit'
import { AnalysisError, analyzeRoutes } from '@/lib/routing/routeAnalysis'
import { getRoutingDeps } from '@/lib/routing/deps'
import { saveAnalysis } from '@/lib/routing/audit'
import { haversineM } from '@/lib/routing/geo'
import { UNSUPPORTED_VEHICLES, VEHICLE_TYPES, type LatLng } from '@/lib/routing/types'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2048
const MIN_SEPARATION_M = 30
const MAX_SEPARATION_M = 250_000

const point = z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) }).strict()
const bodySchema = z
  .object({
    origin: point,
    destination: point,
    vehicle: z.string().default('ambulance'),
    includeAi: z.boolean().default(true),
  })
  .strict()

const fail = (status: number, code: string, error: string, extra?: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json({ code, error, ...extra }, { status, headers })

// POST /api/routes/analyze - responders and admins only.
// Decision support: returns candidate routes with hazards, data limits and ranking reasons. It never returns "safe".
export async function POST(request: NextRequest) {
  const auth = await requireResponder(request)
  if (!auth.ok) return fail(auth.status, auth.status === 401 ? 'unauthenticated' : 'forbidden', auth.error)

  const limited = checkRateLimit(`analyze:${auth.user.id}`)
  if (!limited.ok) return fail(429, 'rate_limited', 'Too many route analyses. Wait a moment and try again.', undefined, { 'Retry-After': String(limited.retryAfterS) })

  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) return fail(413, 'too_large', 'Request body is too large.')
  const rawText = await request.text().catch(() => '')
  if (rawText.length > MAX_BODY_BYTES) return fail(413, 'too_large', 'Request body is too large.')
  let json: unknown
  try {
    json = JSON.parse(rawText)
  } catch {
    return fail(400, 'invalid_request', 'Request body must be JSON.')
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return fail(400, 'invalid_request', 'Validation failed', { details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) })
  }
  const { origin, destination, vehicle, includeAi } = parsed.data

  if ((UNSUPPORTED_VEHICLES as readonly string[]).includes(vehicle)) {
    return fail(422, 'unsupported_vehicle', `Route analysis covers road vehicles only (${VEHICLE_TYPES.join(', ')}). "${vehicle}" is not supported, and no road route has been calculated for it.`)
  }
  if (!(VEHICLE_TYPES as readonly string[]).includes(vehicle)) return fail(400, 'invalid_request', `Unknown vehicle type "${vehicle.slice(0, 40)}".`)

  const from: LatLng = [origin.lat, origin.lng]
  const to: LatLng = [destination.lat, destination.lng]
  const gap = haversineM(from, to)
  if (gap < MIN_SEPARATION_M) return fail(400, 'invalid_request', 'Origin and destination are the same place.')
  if (gap > MAX_SEPARATION_M) return fail(400, 'invalid_request', 'Origin and destination are too far apart for route analysis (limit 250 km).')

  try {
    const deps = getRoutingDeps()
    const result = await analyzeRoutes(
      { origin: from, destination: to, vehicle: vehicle as (typeof VEHICLE_TYPES)[number], includeAi },
      { provider: deps.provider, explainer: deps.explainer, loadHazards: deps.loadHazards, saveAudit: (rec) => saveAnalysis(rec, auth.user) },
    )
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof AnalysisError) return fail(err.status, err.code, err.message)
    console.error('route analysis failed', err)
    return fail(500, 'internal_error', 'Route analysis failed unexpectedly. Emergency reporting is unaffected.')
  }
}
