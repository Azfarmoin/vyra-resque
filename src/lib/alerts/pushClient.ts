'use client'

// Browser side of Web Push. Permission is requested only when the person presses the button (after the benefit and
// the limits have been explained on the page). Push needs a working connection: it cannot arrive while offline.
import type { HazardType, SavedLocation, Severity } from './types'

export interface AlertPrefs { hazards: HazardType[]; minimum: Severity; language: string }
export const PREFS_KEY = 'vyra.alerts.prefs.v1'
export const DEFAULT_PREFS: AlertPrefs = { hazards: [], minimum: 'warning', language: 'en' }

export function readPrefs(): AlertPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return DEFAULT_PREFS }
}
export function writePrefs(p: AlertPrefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* ignore */ } }

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function serverPushStatus(): Promise<{ configured: boolean; publicKey: string | null }> {
  try { return await (await fetch('/api/alerts/push', { cache: 'no-store' })).json() } catch { return { configured: false, publicKey: null } }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

async function send(sub: PushSubscription, locations: SavedLocation[], prefs: AlertPrefs) {
  const res = await fetch('/api/alerts/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), locations, hazard_types: prefs.hazards, minimum_severity: prefs.minimum, language: prefs.language }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'The server could not save your alert settings.')
}

export async function enablePush(locations: SavedLocation[], prefs: AlertPrefs): Promise<void> {
  const server = await serverPushStatus()
  if (!server.configured || !server.publicKey) throw new Error('Push notifications are not set up on this server.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications were not allowed in your browser, so no push alerts will be sent.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(server.publicKey) }))
  await send(sub, locations, prefs)
}

export async function updatePushSettings(locations: SavedLocation[], prefs: AlertPrefs): Promise<void> {
  const sub = await currentSubscription()
  if (sub) await send(sub, locations, prefs)
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await fetch('/api/alerts/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) }).catch(() => undefined)
}
