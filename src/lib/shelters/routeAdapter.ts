// Adapter from the shelter engine's RouteAssessor to the EXISTING routing stack (analyzeRoutes -> OSRM / OpenRouteService + the
// hazard matcher). Nothing is re-implemented here: one route analysis per candidate shelter, with the hazard dataset loaded ONCE.
import { AnalysisError, analyzeRoutes } from '../routing/routeAnalysis'
import type { RoutingDeps } from '../routing/deps'
import type { HazardDataset } from '../routing/types'
import type { RouteAssessor } from './engine'

export function routeAssessorFrom(deps: RoutingDeps, dataset: HazardDataset | null): RouteAssessor | null {
  if (!deps.provider) return null
  return async (origin, destination, vehicle) => {
    try {
      const result = await analyzeRoutes({ origin, destination, vehicle, includeAi: false }, { provider: deps.provider, explainer: null, loadHazards: async () => dataset ?? deps.loadHazards!() })
      const best = [...result.candidates].sort((a, b) => a.rank - b.rank)[0]
      // The existing engine ranks candidates; its best one is judged. If even the best crosses a known closure, no safe-looking alternative exists.
      if (!best) return { state: 'no_route' }
      return {
        state: 'ok', distanceM: best.distanceM, durationS: best.durationS, status: best.status, closures: best.exposure.closures, activeFindings: best.exposure.activeOnRoute,
        notes: best.coverage.state === 'partial' ? ['Route start or end snapped far from the requested point.'] : [], provider: result.provider.name,
      }
    } catch (e) {
      if (e instanceof AnalysisError) return { state: 'unavailable', reason: e.message.slice(0, 160) }
      throw e
    }
  }
}
