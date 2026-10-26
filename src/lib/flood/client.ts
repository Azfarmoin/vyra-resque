'use client'

// Browser calls for the flood simulator. Same identity headers as route analysis (demo email header or Supabase token).
import { authHeaders } from '../routingClient'
import type { Comparison } from './compare'
import type { RouteFloodResult, ShelterFloodResult } from './integration'
import type { ScenarioListItem, StoredScenario } from './repo'
import type { ScenarioInput } from './schema'
import type { DepthBand, PackedGrid, ScenarioLayers, ScenarioResult, Tier } from './types'

export class FloodApiError extends Error {
  constructor(public status: number, public code: string, message: string, public hint?: string) { super(message) }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/flood${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
  } catch {
    throw new FloodApiError(0, 'network', 'Could not reach the server. The simulator needs a connection.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new FloodApiError(res.status, data?.code || 'error', data?.error || `Request failed (${res.status})`, data?.hint)
  return data as T
}

export interface FloodConfigInfo {
  role: string
  tiers: Record<string, Tier>
  bands: DepthBand[]
  region: { bbox: number[]; anyRegionAllowed: boolean }
  limits: { maxAreaKm2: number; maxCells: number }
  capabilities: Record<string, { available: boolean; reason: string | null }>
  sources: Record<string, string | boolean | null>
}
export interface SimulateResponse { saved: false; name: string; result: ScenarioResult; layers: ScenarioLayers }

export const floodApi = {
  config: () => call<FloodConfigInfo>('GET', '/config'),
  simulate: (input: ScenarioInput) => call<SimulateResponse>('POST', '/simulate', input),
  save: (input: ScenarioInput & { name: string }) => call<{ saved: true; scenario: StoredScenario }>('POST', '/scenarios', input),
  list: () => call<{ scenarios: ScenarioListItem[] }>('GET', '/scenarios'),
  get: (id: string) => call<{ scenario: StoredScenario }>('GET', `/scenarios/${id}`),
  remove: (id: string) => call<{ deleted: boolean }>('DELETE', `/scenarios/${id}`),
  compare: (a: string, b: string) => call<Comparison>('GET', `/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`),
  routes: (id: string, routes: { id: string; geometry: [number, number][] }[]) => call<RouteFloodResult>('POST', `/scenarios/${id}/routes`, { routes }),
  shelters: (id: string) => call<ShelterFloodResult>('GET', `/scenarios/${id}/shelters`),
  async download(id: string, format: 'pdf' | 'html' | 'json' | 'geojson') {
    const res = await fetch(`/api/flood/scenarios/${id}/report?format=${format}`, { headers: await authHeaders(), cache: 'no-store' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new FloodApiError(res.status, d?.code || 'error', d?.error || `Export failed (${res.status})`) }
    const blob = await res.blob()
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `vyra-flood-estimate.${format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  },
}

/** Decode a stored depth grid in the browser. The server deflates with zlib, which is DecompressionStream's 'deflate'. */
export async function decodeGrid(p: PackedGrid): Promise<Float32Array> {
  const bin = atob(p.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  const buf = await new Response(stream).arrayBuffer()
  const u16 = new Uint16Array(buf)
  if (u16.length !== p.nx * p.ny) throw new Error('Stored grid has the wrong size')
  const out = new Float32Array(u16.length)
  for (let i = 0; i < u16.length; i++) out[i] = u16[i] === 65535 ? NaN : u16[i] / 100
  return out
}
