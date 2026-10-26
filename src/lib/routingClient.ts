'use client'

// Browser calls for route analysis. Sends the responder's identity the same way the Accounts page does:
// the demo email header in demo mode, otherwise the Supabase access token.
import { readSession } from './session'
import type { AnalysisResult, LatLng, VehicleType } from './routing/types'

export class RouteApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const demo = readSession()
  if (demo?.demo) return { 'x-demo-user': demo.email }
  try {
    const { supabase } = await import('./supabase')
    const { data } = await supabase.auth.getSession()
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
  } catch {
    return {}
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new RouteApiError(0, 'network', 'Could not reach the server. Route analysis needs a connection; emergency reporting still works offline.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new RouteApiError(res.status, data?.code || 'error', data?.error || `Request failed (${res.status})`)
  return data as T
}

export const routeApi = {
  analyze: (origin: LatLng, destination: LatLng, vehicle: VehicleType, includeAi = true) =>
    post<AnalysisResult>('/routes/analyze', { origin: { lat: origin[0], lng: origin[1] }, destination: { lat: destination[0], lng: destination[1] }, vehicle, includeAi }),
  decide: (body: { analysisId: string; candidateId: string; decision: 'approved' | 'rejected'; note?: string; acknowledgedLimitations?: boolean }) =>
    post<{ decision: { id: string; decision: string; decidedAt: string; decidedByName: string } }>('/routes/decisions', body),
}
