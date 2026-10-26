'use client'

// Browser helpers for the Stage 4-6 pages: API calls, polling and formatting.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Priority, Status } from './constants'
<<<<<<< HEAD
import { authHeaders } from './routingClient'
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
import type { BlockedRoad, ReportEvent, ReportSummary, RescueTeam, Shelter, TriagedReport } from './types'

export class ApiError extends Error {
  details: { path: string; message: string }[]
  constructor(public status: number, body: { error?: string; details?: { path: string; message: string }[] }) {
    super(body?.error || `Request failed (${status})`)
    this.details = body?.details || []
  }
}

async function request<T>(path: string, { method = 'GET', body, query }: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) if (v) qs.set(k, v)
  const res = await fetch(`/api${path}${qs.size ? `?${qs}` : ''}`, {
    method,
<<<<<<< HEAD
    headers: { 'Content-Type': 'application/json', ...(method === 'GET' ? {} : await authHeaders()) },
=======
    headers: { 'Content-Type': 'application/json' },
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

export type ReportDetail = TriagedReport & { history: ReportEvent[] }
export type ListResponse = { summary: ReportSummary; reports: TriagedReport[]; mode: 'supabase' | 'demo' }
export type PublicReport = { id: string; status: Status; status_label: string; area: string | null; created_at: string; updated_at: string }

export const api = {
  createReport: (body: unknown) => request<{ report: PublicReport; duplicate: boolean }>('/reports', { method: 'POST', body }),
  publicStatus: (id: string) => request<{ report: PublicReport }>(`/reports/${id}/public-status`),
  listReports: (query: Record<string, string | undefined>) => request<ListResponse>('/reports', { query }),
  triageQueue: (query: Record<string, string | undefined>) => request<ListResponse>('/triage', { query }),
  getReport: (id: string) => request<{ report: ReportDetail }>(`/reports/${id}`),
  updateStatus: (id: string, body: { status: Status; note?: string; by: string }) =>
    request<{ report: ReportDetail }>(`/reports/${id}/status`, { method: 'PATCH', body }),
  setVerified: (id: string, body: { verified: boolean; by: string }) =>
    request<{ report: ReportDetail }>(`/reports/${id}/verify`, { method: 'PATCH', body }),
  overridePriority: (id: string, body: { priority: Priority | null; reason: string; by: string }) =>
    request<{ report: ReportDetail }>(`/reports/${id}/triage-override`, { method: 'PATCH', body }),
  mapLayers: (area?: string) =>
    request<{ shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }>('/map/layers', { query: { area } }),
}

/**
 * Loads reports and keeps them fresh by polling (waiting time changes every case's triage).
 * Stage 9 can swap the polling for Supabase Realtime without touching the pages.
 */
export function usePolledReports(fetcher: (q: Record<string, string | undefined>) => Promise<ListResponse>, query: Record<string, string | undefined>, intervalMs = 15000) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const key = JSON.stringify(query)
  const queryRef = useRef(query)
  queryRef.current = query

  const load = useCallback(async () => {
    try {
      setData(await fetcher(queryRef.current))
      setError(null)
      setLastUpdated(new Date())
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  useEffect(() => {
    setLoading(true)
    load()
    const t = setInterval(load, intervalMs)
    return () => clearInterval(t)
  }, [load, key, intervalMs])

  return { reports: data?.reports || [], summary: data?.summary || null, mode: data?.mode, error, loading, lastUpdated, reload: load }
}

<<<<<<< HEAD
// Palette-driven. Fills carry navy text (contrast >= 4.8:1); low urgency uses a tint + dark green text.
export const PRIORITY_STYLES: Record<Priority, { color: string; badge: string; ring: string; size: number }> = {
  critical: { color: '#DF776E', badge: 'bg-critical text-ink-900', ring: 'ring-critical', size: 30 },
  high: { color: '#EE9444', badge: 'bg-ember text-ink-900', ring: 'ring-ember', size: 26 },
  medium: { color: '#E9B94D', badge: 'bg-warning text-ink-900', ring: 'ring-warning', size: 22 },
  low: { color: '#43866F', badge: 'bg-success-100 text-success-800', ring: 'ring-success', size: 18 },
}

export const STATUS_STYLES: Record<Status, string> = {
  pending: 'bg-ink-900 text-white',
  investigating: 'bg-warning-100 text-warning-700',
  assigned: 'bg-primary-100 text-primary-800',
  resolved: 'bg-success-700 text-white',
  cancelled: 'bg-sand-200 text-ink-600',
=======
export const PRIORITY_STYLES: Record<Priority, { color: string; badge: string; ring: string; size: number }> = {
  critical: { color: '#DC2626', badge: 'bg-red-600 text-white', ring: 'ring-red-500', size: 30 },
  high: { color: '#EA580C', badge: 'bg-orange-500 text-white', ring: 'ring-orange-400', size: 26 },
  medium: { color: '#CA8A04', badge: 'bg-yellow-400 text-yellow-950', ring: 'ring-yellow-400', size: 22 },
  low: { color: '#2563EB', badge: 'bg-blue-600 text-white', ring: 'ring-blue-400', size: 18 },
}

export const STATUS_STYLES: Record<Status, string> = {
  pending: 'bg-gray-800 text-white',
  investigating: 'bg-indigo-100 text-indigo-800',
  assigned: 'bg-teal-100 text-teal-800',
  resolved: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-200 text-gray-600',
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

export function formatWait(minutes?: number) {
  if (minutes == null) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export const formatTime = (date: string) => new Date(date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
export const labelList = (keys: readonly string[] = [], labels: Record<string, string>) => keys.map((k) => labels[k] || k).join(', ')
export const shortId = (id = '') => id.replace(/-/g, '').slice(-6).toUpperCase()
export const priorityRank = (p: Priority) => ({ critical: 4, high: 3, medium: 2, low: 1 })[p]
