'use client'
// Browser side of the satellite API: every call carries the signed-in responder's credentials.
import { authHeaders } from '../routingClient'
import type { AnalysisView, Bbox, ImageKind, LinkEntry, ReviewState, SceneMeta } from './types'
import type { ProviderStatus } from './providers/types'

export class SatApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body: Record<string, unknown> = {}) { super(message) }
}
export type SceneRow = SceneMeta & { qualityHint: 'good' | 'fair' | 'poor' | 'n/a' }
export interface SearchResponse { provider: string; collection: string; aoi: { bbox: Bbox; areaKm2: number }; before: SceneRow[]; after: SceneRow[]; notes: string[]; synthetic: boolean }

async function call<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(`/api/satellite${path}`, {
    method: init.method || (init.body || init.form ? 'POST' : 'GET'), cache: 'no-store',
    body: init.form ?? (init.body ? JSON.stringify(init.body) : undefined),
    headers: { ...(init.form ? {} : { 'Content-Type': 'application/json' }), ...(await authHeaders()) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new SatApiError(res.status, data.code || 'error', data.error || `Request failed (${res.status})`, data)
  return data as T
}

export const satApi = {
  providers: () => call<{ providers: ProviderStatus[]; advisory: string; limits: { maxRangeDays: number; maxAoiKm2: number; maxUploadBytes: number } }>('/providers'),
  search: (body: unknown) => call<SearchResponse>('/search', { body }),
  list: (q: { targetType?: string; targetId?: string; limit?: number } = {}) => {
    const p = new URLSearchParams()
    if (q.targetType) p.set('targetType', q.targetType)
    if (q.targetId) p.set('targetId', q.targetId)
    if (q.limit) p.set('limit', String(q.limit))
    return call<{ analyses: AnalysisView[] }>(`/analyses${p.size ? `?${p}` : ''}`)
  },
  get: (id: string) => call<{ analysis: AnalysisView }>(`/analyses/${id}`),
  create: (body: unknown) => call<{ analysis: AnalysisView }>('/analyses', { body }),
  createUpload: (form: FormData) => call<{ analysis: AnalysisView }>('/analyses', { form }),
  review: (id: string, body: { state: ReviewState; note?: string; acknowledgedLimitations?: boolean }) => call<{ analysis: AnalysisView }>(`/analyses/${id}/review`, { body }),
  link: (id: string, body: { targetType: string; targetId: string; note?: string }) => call<{ link: LinkEntry }>(`/analyses/${id}/links`, { body }),
  /** Images need the credentials header, so they are fetched and turned into a local blob URL. */
  async imageUrl(id: string, kind: ImageKind): Promise<string | null> {
    const res = await fetch(`/api/satellite/analyses/${id}/image/${kind}`, { cache: 'no-store', headers: await authHeaders() })
    return res.ok ? URL.createObjectURL(await res.blob()) : null
  },
}
