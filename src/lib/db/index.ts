import type { DataStore } from './store'
import { createSupabaseStore } from './supabaseStore'
import { createMemoryStore } from './memoryStore'

export { StoreError } from './store'
export type { DataStore, ReportFilter } from './store'

// VYRA_DATA_MODE=demo   -> in-memory simulated data (no Supabase needed)
// VYRA_DATA_MODE=supabase (default when Supabase env vars are set)
function chooseMode(): 'demo' | 'supabase' {
  const mode = process.env.VYRA_DATA_MODE
  if (mode === 'demo' || mode === 'supabase') return mode
  return process.env.NEXT_PUBLIC_SUPABASE_URL ? 'supabase' : 'demo'
}

// Kept on globalThis so Next.js dev hot-reloads don't wipe the demo data.
const g = globalThis as unknown as { __vyraStore?: DataStore }

export function getStore(): DataStore {
  if (!g.__vyraStore) g.__vyraStore = chooseMode() === 'demo' ? createMemoryStore() : createSupabaseStore()
  return g.__vyraStore
}

// For tests.
export function setStore(store: DataStore) {
  g.__vyraStore = store
}
