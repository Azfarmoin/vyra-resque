'use client'

// Browser hook: loads alerts (and keeps a saved copy for offline use), and the person's saved locations.
// Location matching happens here, on the device, so positions are not sent to the server just to read alerts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CACHE_KEY, describeStatus, readCache, reevaluate, writeCache, type AlertsStatus } from './clientCache'
import { matchLocation } from './geo'
import { LOCATIONS_KEY, newLocationId, readLocations, writeLocations, MAX_LOCATIONS } from './locations'
import type { AlertsView, PublicAlert } from './monitor'
import type { LocationMatch, SavedLocation } from './types'

export function useAlerts(opts: { history?: boolean; refreshMs?: number } = {}) {
  const { history = false, refreshMs = 60_000 } = opts
  const [view, setView] = useState<AlertsView | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(true)
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/alerts${history ? '?history=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as AlertsView
      const at = new Date().toISOString()
      setView(data); setFetchedAt(at); setFromCache(false)
      if (!history) writeCache(localStorage, data, at)
    } catch {
      const cached = readCache(localStorage)
      if (cached) { setView(cached.view); setFetchedAt(cached.view.serverTime); setFromCache(true) }
      else { setView(null); setFetchedAt(null); setFromCache(false) }
    } finally { setLoading(false) }
  }, [history])

  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => { setOnline(true); load() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    load()
    const t = setInterval(() => { load(); setTick((n) => n + 1) }, refreshMs)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(t) }
  }, [load, refreshMs])

  const alerts: PublicAlert[] = useMemo(() => (view ? reevaluate(view.alerts) : []), [view, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  const status: AlertsStatus = describeStatus({ loading, online, view, fetchedAt, fromCache })
  // For a saved copy, "last updated" is when the server produced it (not when this device looked at it).
  return { view, alerts, status, reload: load, online }
}

export function useSavedLocations() {
  const [locations, setLocations] = useState<SavedLocation[]>([])
  useEffect(() => {
    setLocations(readLocations(localStorage))
    const onStorage = (e: StorageEvent) => { if (e.key === LOCATIONS_KEY) setLocations(readLocations(localStorage)) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  const save = (list: SavedLocation[]) => { setLocations(list); writeLocations(localStorage, list); window.dispatchEvent(new Event('vyra:alert-locations')) }
  return {
    locations,
    add: (l: Omit<SavedLocation, 'id'>) => { if (locations.length < MAX_LOCATIONS) save([...locations, { ...l, id: newLocationId() }]) },
    remove: (id: string) => save(locations.filter((l) => l.id !== id)),
    full: locations.length >= MAX_LOCATIONS,
  }
}

export type AlertWithMatches = { alert: PublicAlert; matches: { location: SavedLocation; match: LocationMatch }[]; best: 'yes' | 'possible' | 'no' | 'unknown' | null }

export function annotate(alerts: PublicAlert[], locations: SavedLocation[]): AlertWithMatches[] {
  const rank = { yes: 3, possible: 2, unknown: 1, no: 0 } as const
  return alerts.map((alert) => {
    const matches = locations.map((location) => ({ location, match: matchLocation(alert as never, location) }))
    const best = matches.length ? matches.reduce((b, m) => (rank[m.match.result] > rank[b] ? m.match.result : b), 'no' as 'yes' | 'possible' | 'no' | 'unknown') : null
    return { alert, matches, best }
  })
}
export { CACHE_KEY }
