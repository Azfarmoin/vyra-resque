// Production wiring for the simulator. Tests replace pieces with setFloodDeps.
import { getStore } from '../db'
import { supabase } from '../serverDb'
import { isDemoMode } from '../adminAuth'
import { OPEN_STATUSES } from '../constants'
import { withTriage } from '../triage'
import { buildProviders, type OperationalSource } from './assets'
import { floodConfig } from './config'
import { OpenMeteoRainfallProvider } from './rainfall'
import { memoryRepo, supabaseRepo, type Actor, type FloodRepo } from './repo'
import type { FloodDeps } from './scenario'
import type { LatLng, ResourceAsset } from './types'

let override: Partial<FloodDeps & { repo: FloodRepo }> | null = null
export const setFloodDeps = (o: typeof override) => { override = o }

export const repoFor = (actor: Actor): FloodRepo => override?.repo ?? (isDemoMode() || !actor.db ? memoryRepo : supabaseRepo)

/** READ-ONLY view of the operational registers. There is deliberately no write method anywhere in this object. */
export function operationalSource(): OperationalSource {
  return {
    async shelters() {
      const { shelters } = await getStore().mapLayers()
      return shelters.map((s) => ({ id: s.id, name: s.name, lat: s.location_lat, lng: s.location_lng, meta: { status: s.status, capacity: s.capacity, occupancy: s.current_occupancy } }))
    },
    async teams() {
      const { teams } = await getStore().mapLayers()
      return teams.map((t) => ({ id: t.id, name: t.team_name, lat: t.current_location_lat, lng: t.current_location_lng, teamType: t.team_type, status: t.status }))
    },
    async resources(): Promise<ResourceAsset[]> {
      const { data, error } = await supabase.from('resources').select('id, resource_type, quantity, team_id, status')
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: Record<string, unknown>) => ({ id: String(r.id), resourceType: String(r.resource_type), quantity: Number(r.quantity ?? 1), teamId: (r.team_id as string | null) ?? null, status: String(r.status ?? '') }))
    },
    async blockedRoads() {
      const { roadBlocks } = await getStore().mapLayers()
      return roadBlocks.map((b) => ({ id: b.id, name: b.description, roadClass: b.reason, source: 'Blocked-road register (verified)', path: b.path as LatLng[] }))
    },
    async incidents(bbox) {
      const rows = await getStore().listReports({ bbox, statuses: OPEN_STATUSES })
      return rows.filter((r) => r.location_lat != null && r.location_lng != null).map((r) => { const t = withTriage(r); return { id: r.id, lat: r.location_lat as number, lng: r.location_lng as number, priority: t.priority, status: r.status } })
    },
  }
}

export function getFloodDeps(actor: Actor): FloodDeps & { repo: FloodRepo } {
  const config = override?.config ?? floodConfig()
  const repo = repoFor(actor)
  return {
    config,
    assets: override?.assets ?? buildProviders(config, operationalSource()),
    rainfall: override && 'rainfall' in override ? override.rainfall ?? null : config.openMeteoEnabled ? new OpenMeteoRainfallProvider(config) : null,
    elevation: override?.elevation,
    observations: override?.observations ?? ((bbox) => repo.observations(actor, bbox)),
    resolveZone: override?.resolveZone ?? (async (id) => {
      const z = await getStore().getZone(id)
      return z && (z.geometry.type === 'Polygon' || z.geometry.type === 'MultiPolygon') ? z.geometry : z ? ({ type: z.geometry.type } as never) : null
    }),
    now: override?.now,
    repo,
  }
}
