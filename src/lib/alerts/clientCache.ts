// Offline behaviour for alerts, as pure functions (the hook adds localStorage around them).
//  - The last successful response is cached together with the time it was fetched.
//  - Cached alerts are always labelled "saved", with the time they were last updated, and are never called live.
//  - Expiry is re-evaluated on the device, so a saved alert that has since expired shows as expired.
import { effectiveStatus } from './lifecycle'
import type { AlertsView, PublicAlert } from './monitor'

export const CACHE_KEY = 'vyra.alerts.cache.v1'
export interface CachedAlerts { fetchedAt: string; view: AlertsView }

export type AlertsMode = 'live' | 'saved_offline' | 'saved_error' | 'empty_offline' | 'empty_error' | 'loading'
export interface AlertsStatus { mode: AlertsMode; isLive: boolean; label: string; explanation: string | null }

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

export function describeStatus(input: { loading: boolean; online: boolean; view: AlertsView | null; fetchedAt: string | null; fromCache: boolean }): AlertsStatus {
  const { loading, online, view, fetchedAt, fromCache } = input
  if (loading && !view) return { mode: 'loading', isLive: false, label: 'Loading...', explanation: null }
  if (view && !fromCache) return { mode: 'live', isLive: true, label: `Checked ${fetchedAt ? when(fetchedAt) : 'just now'}`, explanation: null }
  if (view && fromCache) {
    return {
      mode: online ? 'saved_error' : 'saved_offline',
      isLive: false,
      label: `Saved copy - last updated ${fetchedAt ? when(fetchedAt) : 'unknown'}`,
      explanation: online
        ? 'VYRA could not reach the alert service, so you are seeing a saved copy. It may be out of date and is not a live warning.'
        : 'You are offline, so you are seeing the last alerts saved on this device. They are not live. New warnings cannot arrive until your device has a working connection (internet or mobile data) again.',
    }
  }
  return {
    mode: online ? 'empty_error' : 'empty_offline',
    isLive: false,
    label: 'No alert data available',
    explanation: 'No saved alerts exist on this device and the alert service cannot be reached. This does NOT mean there is no danger. Use radio, TV, official apps or local authorities.',
  }
}

// Re-evaluates status/expiry on the device using the current time.
export function reevaluate(alerts: PublicAlert[], now = Date.now()): PublicAlert[] {
  return alerts.map((a) => ({ ...a, effective_status: effectiveStatus(a, now) }))
}

export function readCache(storage: Pick<Storage, 'getItem'>): CachedAlerts | null {
  try {
    const raw = storage.getItem(CACHE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CachedAlerts
    return c && typeof c.fetchedAt === 'string' && c.view && Array.isArray(c.view.alerts) ? c : null
  } catch { return null }
}
export function writeCache(storage: Pick<Storage, 'setItem'>, view: AlertsView, fetchedAt: string) {
  try { storage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, view } satisfies CachedAlerts)) } catch { /* storage full or unavailable: the app still works online */ }
}
