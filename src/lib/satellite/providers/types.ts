import type { GeoTIFF } from 'geotiff'
import type { Grid } from '../raster/grid'
import type { LoadedScene } from '../analysis/engine'
import type { Bbox, CollectionId, ProviderId, SceneMeta } from '../types'

export class ProviderError extends Error {
  constructor(public code: 'unavailable' | 'invalid_response' | 'missing_credentials' | 'auth_failed' | 'rate_limited' | 'not_found' | 'unsupported', message: string, public status = 502) { super(message) }
}

export interface ProviderStatus {
  id: ProviderId; name: string; description: string
  state: 'ready' | 'missing_credentials' | 'disabled'
  missing: string[] // names of environment variables that are not set
  message: string
  collections: CollectionId[]
  license: string; attribution: string
  upload?: boolean; demo?: boolean
}
export interface SearchRequest { collection: CollectionId; bbox: Bbox; start: string; end: string; maxCloud?: number }
export interface SearchResult { scenes: SceneMeta[]; skipped: number; notes: string[] }

export interface ProviderDeps {
  fetch: typeof fetch
  openTiff: (url: string) => Promise<GeoTIFF>
  now: () => number
}

export interface ImageryProvider {
  id: ProviderId
  status(): ProviderStatus
  search(req: SearchRequest): Promise<SearchResult>
  getScene(collection: CollectionId, id: string): Promise<SceneMeta>
  load(scene: SceneMeta, grid: Grid): Promise<LoadedScene>
}

/** JSON over HTTP with a timeout. Network failure, bad status and non-JSON are all reported as ProviderError. */
export async function httpJson(deps: ProviderDeps, url: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<unknown> {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try { res = await deps.fetch(url, { ...init, signal: ctl.signal }) } catch (e) {
    throw new ProviderError('unavailable', (e as Error)?.name === 'AbortError' ? 'The imagery provider did not answer in time.' : 'Could not reach the imagery provider.', 503)
  } finally { clearTimeout(timer) }
  if (res.status === 401 || res.status === 403) throw new ProviderError('auth_failed', `The imagery provider refused the credentials or access (HTTP ${res.status}).`, 502)
  if (res.status === 404) throw new ProviderError('not_found', 'The imagery provider has no such item.', 404)
  if (res.status === 429) throw new ProviderError('rate_limited', 'The imagery provider is rate limiting requests. Try again shortly.', 503)
  if (!res.ok) throw new ProviderError('unavailable', `The imagery provider returned HTTP ${res.status}.`, 503)
  try { return await res.json() } catch { throw new ProviderError('invalid_response', 'The imagery provider returned something that is not valid JSON.') }
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const isBbox = (v: unknown): v is Bbox => Array.isArray(v) && v.length >= 4 && v.slice(0, 4).every((n) => typeof n === 'number' && Number.isFinite(n))

/** Keeps the provider's original properties, capped so a hostile or huge response cannot bloat the database. */
export function capOriginal(o: Record<string, unknown>, maxBytes = 20_000): Record<string, unknown> {
  const s = JSON.stringify(o)
  return s.length <= maxBytes ? o : { truncated: true, note: `Original metadata was ${s.length} bytes and was cut at ${maxBytes}.`, partial: s.slice(0, maxBytes) }
}
