// Server-side wiring for the shelter API routes: who is calling, which ShelterService to use (demo memory vs Postgres), and the
// existing hazard / zone / routing / report sources. All rules live in the files this one imports; this file only connects them.
import { NextResponse, type NextRequest } from 'next/server'
import { getStore } from '../db'
import { demoTables } from '../demoDb'
import { plainClient } from '../adminAuth'
import { requireResponder } from '../routing/auth'
import { getRoutingDeps } from '../routing/deps'
import { loadHazards } from '../routing/hazardSources'
import { checkRateLimit } from '../routing/rateLimit'
import type { HazardDataset } from '../routing/types'
import type { DemandPoint } from './coverage'
import { gate, siteBlockersFrom, type HandlerDeps, type Result, type RiskInputs } from './handlers'
import { routeAssessorFrom } from './routeAdapter'
import { createMemoryShelterService, emptyShelterTables, type ShelterService, type ShelterTables } from './service'
import { createSupabaseShelterService } from './supabaseService'
import type { Actor } from './types'

const g = globalThis as unknown as { __vyraShelterState?: { tables: ShelterTables; service: ShelterService } }

async function demoService(risk: () => Promise<RiskInputs>): Promise<ShelterService> {
  if (!g.__vyraShelterState) {
    const t = await demoTables()
    // The SAME shelter rows the map and the Supplies page use; only the ledgers are new.
    const tables: ShelterTables = { ...emptyShelterTables(t.shelters), shelter_reservations: [], shelter_exceptions: [], shelter_audit: [] }
    const service = createMemoryShelterService(tables, {
      siteBlockers: siteBlockersFrom(risk),
      incidentExists: async (id) => (await getStore().listReports({})).some((r) => r.id === id),
      dispatchExists: async (id) => t.dispatches.some((d) => d.id === id),
    })
    g.__vyraShelterState = { tables, service }
  }
  return g.__vyraShelterState.service
}

async function loadRisk(): Promise<RiskInputs> {
  const [ds, zones] = await Promise.all([loadHazards().catch((): HazardDataset => ({ hazards: [], skipped: [], sources: [{ name: 'Hazard data', table: 'route_hazards', ok: false, count: 0, newestAt: null, error: 'unavailable' }], loadedAt: new Date().toISOString() })), getStore().listZones({}).catch(() => [])])
  const notices = ds.sources.filter((s) => !s.ok).map((s) => `${s.name} could not be loaded, so exposure checks do not include it.`)
  if (!ds.hazards.length && !ds.sources.some((s) => s.ok)) notices.push('No hazard data was available: "no exposure found" below means nothing was checked, not that the area is safe.')
  return { hazards: ds.hazards, zones, notices }
}

/** Open incident reports with a location become "demand" for the coverage map. VYRA has no population data. */
async function loadDemand(): Promise<DemandPoint[]> {
  const reports = await getStore().listReports({})
  return reports
    .filter((r) => r.location_lat != null && r.location_lng != null && !['resolved', 'closed', 'cancelled'].includes(String(r.status)))
    .map((r) => ({ lat: r.location_lat as number, lng: r.location_lng as number, people: Math.max(1, r.people_count ?? 1) }))
}

export type Caller = { actor: Actor | null; db: import('@supabase/supabase-js').SupabaseClient | null }

export async function identify(request: NextRequest): Promise<Caller> {
  const check = await requireResponder(request)
  if (check.ok) return { actor: { id: check.user.id, name: check.user.name, role: check.user.role }, db: check.user.db }
  // A signed-in citizen is refused with 403, an unknown caller with 401; the public list works for both.
  return { actor: check.status === 403 ? { id: 'citizen', name: 'citizen', role: 'citizen' } : null, db: null }
}

export async function buildDeps(caller: Caller): Promise<HandlerDeps> {
  const store = getStore()
  const service = store.mode === 'demo' ? await demoService(loadRisk) : createSupabaseShelterService(caller.db ?? plainClient(), { siteBlockers: siteBlockersFrom(loadRisk) })
  const routing = getRoutingDeps()
  let dataset: HazardDataset | null = null
  return {
    service, loadRisk, loadDemand,
    routeAssessor: () => {
      // Load the hazard dataset once per request and share it across every candidate shelter's route analysis.
      const assessor = routeAssessorFrom({ ...routing, loadHazards: async () => (dataset ??= await loadHazards()) }, null)
      return assessor
    },
  }
}

/** Runs one handler with identification, optional rate limiting and uniform JSON output. */
export async function respond(request: NextRequest, run: (caller: Caller, deps: HandlerDeps) => Promise<Result>, opts: { rateKey?: string; limit?: number } = {}): Promise<NextResponse> {
  const caller = await identify(request)
  if (opts.rateKey && caller.actor?.role && ['responder', 'admin'].includes(caller.actor.role)) {
    const limited = checkRateLimit(`${opts.rateKey}:${caller.actor.id}`, { limit: opts.limit ?? 30 })
    if (!limited.ok) return NextResponse.json({ code: 'rate_limited', error: 'Too many requests. Wait a moment and try again.' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterS) } })
  }
  const result = await run(caller, await buildDeps(caller))
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
}

export const readJson = async (request: NextRequest): Promise<unknown> => request.json().catch(() => undefined)
export { gate }
