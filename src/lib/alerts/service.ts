// Server-only wiring for the early-warning API routes.
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { plainClient } from '../adminAuth'
import { getStore } from '../db'
import { buildProviders, type AlertProvider } from './providers'
import { createMemoryAlertStore, type AlertStore } from './store'
import { createSupabaseAlertStore } from './supabaseStore'

const g = globalThis as unknown as { __vyraAlertStore?: AlertStore }

export type StoreStatus = { store: AlertStore; persistent: boolean; note: string | null }

// Supabase mode needs SUPABASE_SERVICE_ROLE_KEY for server writes. Without it the system still works, but alerts live
// only in this server process's memory (lost on restart / not shared between serverless instances), and the admin
// page says so. Demo mode (VYRA_DATA_MODE=demo) uses memory too - and, like production, starts with NO alerts.
export function getAlertStoreStatus(): StoreStatus {
  if (g.__vyraAlertStore) return { store: g.__vyraAlertStore, persistent: g.__vyraAlertStore.mode === 'supabase', note: null }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (getStore().mode === 'supabase' && url && key) {
    g.__vyraAlertStore = createSupabaseAlertStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => fetch(i, { ...init, cache: 'no-store' }) } }))
    return { store: g.__vyraAlertStore, persistent: true, note: null }
  }
  g.__vyraAlertStore = createMemoryAlertStore()
  return {
    store: g.__vyraAlertStore,
    persistent: false,
    note: getStore().mode === 'supabase'
      ? 'SUPABASE_SERVICE_ROLE_KEY is not set, so alerts are kept in server memory only and will be lost on restart.'
      : 'Demo mode: alerts are kept in server memory only.',
  }
}
export const getAlertStore = () => getAlertStoreStatus().store
export function setAlertStore(s: AlertStore | null) { g.__vyraAlertStore = s ?? undefined }

let providerCache: { key: string; list: AlertProvider[] } | null = null
export function getProviders(env: Record<string, string | undefined> = process.env): AlertProvider[] {
  // Rebuilt when the relevant environment changes (cheap, and keeps tests independent).
  const key = JSON.stringify(Object.entries(env).filter(([k]) => k.startsWith('ALERT_')).sort())
  if (!providerCache || providerCache.key !== key) providerCache = { key, list: buildProviders(env) }
  return providerCache.list
}

// Who is calling? Returns the Supabase user id from a valid access token, else null (anonymous). Never trusts a client-supplied id.
export async function userIdFrom(request: NextRequest): Promise<string | null> {
  if (getStore().mode === 'demo') return null
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  const { data, error } = await plainClient().auth.getUser(token)
  return error || !data.user ? null : data.user.id
}
