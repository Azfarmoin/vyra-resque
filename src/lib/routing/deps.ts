// Where the API gets its provider / AI client / hazard loader. Defaults come from env vars;
// tests override them with setRoutingDeps (Next route files may not export extras, so this lives here).
import { anthropicExplainer, type AiExplainer } from '../ai/hazardExplanation'
import { loadHazards } from './hazardSources'
import { providerFromEnv, type RoutingProvider } from './providers'
import type { HazardDataset } from './types'

export interface RoutingDeps {
  provider: RoutingProvider | null
  explainer: AiExplainer | null
  loadHazards: () => Promise<HazardDataset>
}

let override: Partial<RoutingDeps> | null = null

export const setRoutingDeps = (o: Partial<RoutingDeps> | null) => {
  override = o
}

export function getRoutingDeps(): RoutingDeps {
  return {
    provider: override && 'provider' in override ? override.provider ?? null : providerFromEnv(),
    explainer: override && 'explainer' in override ? override.explainer ?? null : anthropicExplainer(),
    loadHazards: override?.loadHazards ?? (() => loadHazards()),
  }
}
