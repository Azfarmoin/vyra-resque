// Routing providers. Routes, distances and durations come ONLY from a real road-network engine.
// Credentials stay on the server (env vars, never NEXT_PUBLIC_*).
//
//   ROUTING_PROVIDER = osrm (default) | ors
//   OSRM_BASE_URL    required in production. In development it falls back to the public OSRM demo
//                    server, which is rate-limited, car-only and not for production use.
//   ORS_BASE_URL     default https://api.openrouteservice.org
//   ORS_API_KEY      required for ors
//
// OSRM cannot be told to avoid a specific road, so with OSRM we only report which of the alternatives it
// returned cross a closure; we never claim a route was recalculated around one. ORS accepts
// avoid_polygons, which is how a genuine recalculation is requested.
import { z } from 'zod'
import { haversineM, isValidLatLng } from './geo'
import type { LatLng, VehicleType } from './types'

export class RoutingUnavailableError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
  }
}

export interface ProviderRoute {
  geometry: LatLng[]
  distanceM: number
  durationS: number
}

export interface RouteRequest {
  origin: LatLng
  destination: LatLng
  vehicle: VehicleType
  alternatives: number
  avoidRings?: number[][][] // GeoJSON polygon rings, [lng, lat]
}

export interface RoutingProvider {
  id: string
  name: string
  supportsExclusions: boolean
  note: string | null
  route(req: RouteRequest, signal: AbortSignal): Promise<ProviderRoute[]> // [] = the engine found no route
}

const lineString = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(2) })

function toLatLng(coords: number[][]): LatLng[] {
  const out = coords.map((c) => [c[1], c[0]] as LatLng)
  if (!out.every(isValidLatLng)) throw new RoutingUnavailableError('The routing provider returned invalid coordinates.')
  return out
}

async function fetchJson(url: string, init: RequestInit, signal: AbortSignal, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal, cache: 'no-store' })
  } catch (err) {
    throw new RoutingUnavailableError(signal.aborted ? 'The routing provider timed out.' : 'The routing provider could not be reached.', err)
  }
  if (!res.ok) {
    // 4xx "no route" style answers are handled by callers; anything else is an outage.
    const body = await res.text().catch(() => '')
    throw new RoutingUnavailableError(`The routing provider answered HTTP ${res.status}.`, body.slice(0, 200))
  }
  try {
    return await res.json()
  } catch (err) {
    throw new RoutingUnavailableError('The routing provider returned an unreadable response.', err)
  }
}

const osrmResponse = z.object({
  code: z.string(),
  routes: z.array(z.object({ geometry: lineString, distance: z.number().nonnegative(), duration: z.number().nonnegative() })).optional(),
})

export function osrmProvider(baseUrl: string, fetchImpl: typeof fetch = fetch, isDemoServer = false): RoutingProvider {
  return {
    id: 'osrm',
    name: 'OSRM',
    supportsExclusions: false,
    note: isDemoServer
      ? 'Using the public OSRM demo server (car profile only, rate-limited, no uptime guarantee). Set OSRM_BASE_URL to your own instance for real operations.'
      : 'OSRM car profile: vehicle-specific restrictions are not evaluated.',
    async route(req, signal) {
      const { origin, destination } = req
      const url =
        `${baseUrl.replace(/\/$/, '')}/route/v1/driving/${origin[1]},${origin[0]};${destination[1]},${destination[0]}` +
        `?alternatives=${Math.max(0, Math.min(3, req.alternatives))}&overview=full&geometries=geojson&steps=false`
      const parsed = osrmResponse.safeParse(await fetchJson(url, { method: 'GET' }, signal, fetchImpl))
      if (!parsed.success) throw new RoutingUnavailableError('The routing provider returned an unexpected response shape.')
      if (parsed.data.code === 'NoRoute' || parsed.data.code === 'NoSegment') return []
      if (parsed.data.code !== 'Ok' || !parsed.data.routes) throw new RoutingUnavailableError(`The routing provider reported "${parsed.data.code}".`)
      return parsed.data.routes.map((r) => ({ geometry: toLatLng(r.geometry.coordinates), distanceM: r.distance, durationS: r.duration }))
    },
  }
}

const orsResponse = z.object({
  features: z.array(z.object({ geometry: lineString, properties: z.object({ summary: z.object({ distance: z.number(), duration: z.number() }) }) })),
})

export function orsProvider(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch): RoutingProvider {
  return {
    id: 'ors',
    name: 'OpenRouteService',
    supportsExclusions: true,
    note: 'Rescue trucks use the heavy-vehicle profile without dimensions; cars and ambulances use the car profile. Road restrictions are not evaluated.',
    async route(req, signal) {
      const profile = req.vehicle === 'rescue_truck' || req.vehicle === 'fire_truck' ? 'driving-hgv' : 'driving-car'
      const body: Record<string, unknown> = {
        coordinates: [[req.origin[1], req.origin[0]], [req.destination[1], req.destination[0]]],
        instructions: false,
        ...(req.alternatives > 0 ? { alternative_routes: { target_count: Math.min(3, req.alternatives + 1), share_factor: 0.6, weight_factor: 1.6 } } : {}),
        ...(req.avoidRings?.length ? { options: { avoid_polygons: { type: 'MultiPolygon', coordinates: req.avoidRings.map((ring) => [ring]) } } } : {}),
      }
      let json: unknown
      try {
        json = await fetchJson(`${baseUrl.replace(/\/$/, '')}/v2/directions/${profile}/geojson`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: apiKey }, body: JSON.stringify(body) }, signal, fetchImpl)
      } catch (err) {
        // ORS answers 404 (code 2010) when no road is near a coordinate: that is "no route", not an outage.
        if (err instanceof RoutingUnavailableError && /HTTP 404/.test(err.message)) return []
        throw err
      }
      const parsed = orsResponse.safeParse(json)
      if (!parsed.success) throw new RoutingUnavailableError('The routing provider returned an unexpected response shape.')
      return parsed.data.features.map((f) => ({ geometry: toLatLng(f.geometry.coordinates), distanceM: f.properties.summary.distance, durationS: f.properties.summary.duration }))
    },
  }
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): RoutingProvider | null {
  const which = (env.ROUTING_PROVIDER || 'osrm').toLowerCase()
  if (which === 'ors') return env.ORS_API_KEY ? orsProvider(env.ORS_BASE_URL || 'https://api.openrouteservice.org', env.ORS_API_KEY) : null
  if (env.OSRM_BASE_URL) return osrmProvider(env.OSRM_BASE_URL)
  if (env.NODE_ENV !== 'production') return osrmProvider('https://router.project-osrm.org', fetch, true)
  return null // production without a configured engine: unavailable, never a made-up route
}

/** How far the route's own first/last point is from the point that was asked for: a provider-agnostic snap distance. */
export const snapDistanceM = (asked: LatLng, geometryEnd: LatLng) => haversineM(asked, geometryEnd)
