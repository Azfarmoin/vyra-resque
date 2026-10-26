// Database client for API routes. Real Supabase normally; the in-memory demo database when
// VYRA_DATA_MODE=demo (or when no Supabase URL is configured), so every page works offline.
import { supabase as real } from './supabase'
import { demoClient } from './demoDb'
import { getStore } from './db'
import type { SupabaseClient } from '@supabase/supabase-js'

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop) {
    const target = getStore().mode === 'demo' ? (demoClient as unknown as SupabaseClient) : real
    const v = (target as unknown as Record<string | symbol, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
  },
})
