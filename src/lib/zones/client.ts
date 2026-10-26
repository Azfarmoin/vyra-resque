'use client'
// Browser helpers for zones: API calls with the signed-in user's credentials, and a hook that loads zones for the
// visible map area, falls back to the offline snapshot, and says honestly how old the data is.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionUser } from '../demoAccounts'
import { ApiError } from '../client'
import { EMPTY_SNAPSHOT, loadSnapshot, mergeSnapshot, saveSnapshot, uncoveredFraction, type ZoneSnapshot } from './snapshot'
import type { BBox, DisasterZone, FeedStatus, ZoneAuditEntry } from './types'

export async function authHeaders(user: SessionUser | null): Promise<Record<string, string>> {
  if (!user) return {}
  if (user.demo) return { 'x-demo-admin': user.email }
  const { supabase } = await import('../supabase')
  const { data } = await supabase.auth.getSession()
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}
}

async function call<T>(path: string, user: SessionUser | null, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method || 'GET', cache: 'no-store', body: init.body ? JSON.stringify(init.body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(await authHeaders(user)) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data)
  return data as T
}

export const zoneApi = {
  list: (user: SessionUser | null, query: { bbox?: BBox | null; zoom?: number; hidden?: boolean; full?: boolean }) => {
    const p = new URLSearchParams()
    if (query.bbox) p.set('bbox', query.bbox.map((n) => n.toFixed(5)).join(','))
    if (query.zoom != null) p.set('zoom', String(Math.round(query.zoom)))
    if (query.hidden) p.set('include', 'hidden')
    if (query.full) p.set('full', '1')
    return call<{ zones: DisasterZone[]; feeds: FeedStatus[]; server_time: string; disclaimer: string; mode: 'demo' | 'supabase' }>(`/zones${p.size ? `?${p}` : ''}`, user)
  },
  create: (user: SessionUser | null, body: unknown) => call<{ zone: DisasterZone }>('/zones', user, { method: 'POST', body }),
  update: (user: SessionUser | null, id: string, body: unknown) => call<{ zone: DisasterZone }>(`/zones/${id}`, user, { method: 'PATCH', body }),
  remove: (user: SessionUser | null, id: string) => call<{ success: true }>(`/zones/${id}`, user, { method: 'DELETE' }),
  audit: (user: SessionUser | null, id: string) => call<{ audit: ZoneAuditEntry[] }>(`/zones/${id}/audit`, user),
}

export type ZoneSource = 'live' | 'cache' | 'none'
const REFRESH_MS = 60_000

/**
 * Zones for the visible area. Online: fetch (bbox-limited), merge into the offline snapshot, show live data.
 * Offline or failing: show the snapshot and say so. `source` is never 'live' unless the last request succeeded.
 */
export function useZones(user: SessionUser | null, view: { bbox: BBox | null; zoom: number } | null) {
  const [snapshot, setSnapshot] = useState<ZoneSnapshot>(EMPTY_SNAPSHOT)
  const [source, setSource] = useState<ZoneSource>('none')
  const [error, setError] = useState<string | null>(null)
  const [disclaimer, setDisclaimer] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const snapRef = useRef(snapshot)
  snapRef.current = snapshot
  const viewRef = useRef(view)
  viewRef.current = view
  const key = view?.bbox ? view.bbox.map((n) => n.toFixed(2)).join(',') : 'all'

  // Show whatever we cached last time immediately, before any network answer.
  useEffect(() => {
    let alive = true
    loadSnapshot().then((s) => {
      if (!alive || !s.fetched_at) return
      setSnapshot((cur) => (cur.fetched_at ? cur : s))
      setSource((cur) => (cur === 'none' ? 'cache' : cur))
    })
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    const v = viewRef.current
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setSource(snapRef.current.fetched_at ? 'cache' : 'none'); setError('You are offline.'); setLoading(false); return }
    try {
      // Fetch a padded box so small pans do not need a new request.
      const pad = v?.bbox ? ([v.bbox[0] - (v.bbox[2] - v.bbox[0]) * 0.25, v.bbox[1] - (v.bbox[3] - v.bbox[1]) * 0.25, v.bbox[2] + (v.bbox[2] - v.bbox[0]) * 0.25, v.bbox[3] + (v.bbox[3] - v.bbox[1]) * 0.25] as BBox) : null
      const clamp = pad ? ([Math.max(-180, pad[0]), Math.max(-90, pad[1]), Math.min(180, pad[2]), Math.min(90, pad[3])] as BBox) : null
      const res = await zoneApi.list(user, { bbox: clamp, zoom: v?.zoom ?? 11 })
      const merged = mergeSnapshot(snapRef.current, res, clamp)
      setSnapshot(merged)
      setDisclaimer(res.disclaimer)
      setSource('live'); setError(null)
      void saveSnapshot(merged)
    } catch (e) {
      setSource(snapRef.current.fetched_at ? 'cache' : 'none')
      setError((e as Error).message || 'Could not load zones.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    const t0 = setTimeout(load, 350) // wait for the map to settle after a pan or zoom
    const t = setInterval(load, REFRESH_MS)
    const on = () => load()
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { clearTimeout(t0); clearInterval(t); window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [load, key])

  const uncovered = view?.bbox ? uncoveredFraction(snapshot, view.bbox) : 0
  return { zones: snapshot.zones, feeds: snapshot.feeds, fetchedAt: snapshot.fetched_at, source, error, disclaimer, loading, uncovered, reload: load }
}
