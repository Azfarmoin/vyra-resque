import type { AlertCandidate, HazardType, Origin } from '../types'

export interface FetchTextOptions {
  headers?: Record<string, string>
}
export interface ProviderContext {
  now: number
  // Bounded fetch: enforces timeout and a size cap, throws on non-2xx. Injected so tests can use mocked feeds.
  fetchText(url: string, opts?: FetchTextOptions): Promise<string>
  env: Record<string, string | undefined>
}

export interface RejectedItem {
  kind: 'malformed' | 'invalid_timestamp' | 'provider_error' | 'other'
  detail: string
  externalId: string | null
}
export interface ProviderResult {
  candidates: AlertCandidate[]
  rejected: RejectedItem[]
}

// What an administrator and a reader are told about every data source (spec section 2).
export interface ProviderDocs {
  feedUrl: string | null // public URL only. Never includes credentials.
  docsUrl: string | null
  coverage: string
  hazards: HazardType[]
  updateFrequency: string
  authentication: string
  limitations: string
}

export interface AlertProvider {
  id: string
  name: string
  origin: Origin
  docs: ProviderDocs
  minIntervalMinutes: number // never fetch more often than this (respects provider rate limits)
  staleAfterMinutes: number // alerts from this source are flagged as possibly out of date after this long without a success
  // Why it is not configured, or null when ready. Unconfigured providers are never called.
  unconfiguredReason: string | null
  // True when each successful fetch is the complete current set (VYRA's own estimates). Alerts it no longer returns are withdrawn.
  snapshot?: boolean
  fetchAlerts(ctx: ProviderContext): Promise<ProviderResult>
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
