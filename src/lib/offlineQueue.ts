'use client'

// Offline report queue backed by IndexedDB.
// Every report is stored on the device first, then uploaded. Each entry carries a
// `client_id` idempotency key so retries never create duplicate reports on the server.

export interface ReportPayload {
  reporter_id: string | null
  location_lat: number | null
  location_lng: number | null
  location_address: string
  people_count: number
  immediate_danger: boolean
  injury_details: string | null
  medical_needs: string | null
  contact_info: string | null
}

export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed'

export interface QueuedReport {
  client_id: string
  payload: ReportPayload
  fingerprint: string
  status: SyncState
  attempts: number
  last_error: string | null
  created_at: string
  updated_at: string
  synced_at: string | null
  server_id: string | null
  duplicate: boolean
  created_offline: boolean
}

const DB_NAME = 'vyra-offline'
const DB_VERSION = 1
const STORE = 'report_queue'
const CHANGE_EVENT = 'vyra-queue-changed'
const CHANNEL = 'vyra-sync'
export const DUPLICATE_WINDOW_MS = 30 * 60 * 1000
const SYNCED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15000

export function isIndexedDbAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) return Promise.reject(new Error('IndexedDB is not available'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'client_id' })
          store.createIndex('status', 'status')
          store.createIndex('fingerprint', 'fingerprint')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        dbPromise = null
        reject(request.error)
      }
    })
  }
  return dbPromise
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const request = fn(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function notifyChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CHANGE_EVENT))
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage('changed')
    channel.close()
  }
}

export function subscribeToQueue(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback)
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null
  if (channel) channel.onmessage = callback
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    channel?.close()
  }
}

export function generateClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// Stable hash of the report content, used to spot accidental double submissions.
export function fingerprintReport(payload: ReportPayload): string {
  const norm = (v: string | null) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const key = [
    norm(payload.location_address),
    payload.location_lat?.toFixed(4) ?? '',
    payload.location_lng?.toFixed(4) ?? '',
    payload.people_count,
    payload.immediate_danger ? 1 : 0,
    norm(payload.injury_details),
    norm(payload.medical_needs),
    norm(payload.contact_info)
  ].join('|')
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

export async function listQueuedReports(): Promise<QueuedReport[]> {
  const entries = await withStore<QueuedReport[]>('readonly', store => store.getAll())
  return entries.sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function getQueuedReport(clientId: string): Promise<QueuedReport | undefined> {
  return withStore<QueuedReport | undefined>('readonly', store => store.get(clientId))
}

async function putEntry(entry: QueuedReport): Promise<void> {
  await withStore('readwrite', store => store.put(entry))
}

export async function findPossibleDuplicate(payload: ReportPayload): Promise<QueuedReport | null> {
  const fingerprint = fingerprintReport(payload)
  const matches = await withStore<QueuedReport[]>('readonly', store =>
    store.index('fingerprint').getAll(fingerprint)
  )
  const cutoff = Date.now() - DUPLICATE_WINDOW_MS
  return (
    matches.find(m => m.status !== 'failed' && new Date(m.created_at).getTime() >= cutoff) ?? null
  )
}

export async function saveReport(payload: ReportPayload): Promise<QueuedReport> {
  const now = new Date().toISOString()
  const entry: QueuedReport = {
    client_id: generateClientId(),
    payload,
    fingerprint: fingerprintReport(payload),
    status: 'pending',
    attempts: 0,
    last_error: null,
    created_at: now,
    updated_at: now,
    synced_at: null,
    server_id: null,
    duplicate: false,
    created_offline: typeof navigator !== 'undefined' ? !navigator.onLine : false
  }
  await putEntry(entry)
  notifyChange()
  return entry
}

export async function retryReport(clientId: string): Promise<void> {
  const entry = await getQueuedReport(clientId)
  if (!entry) return
  await putEntry({ ...entry, status: 'pending', last_error: null, updated_at: new Date().toISOString() })
  notifyChange()
  void syncQueue()
}

export async function discardReport(clientId: string): Promise<void> {
  await withStore('readwrite', store => store.delete(clientId))
  notifyChange()
}

export async function clearSyncedReports(): Promise<void> {
  const entries = await listQueuedReports()
  await Promise.all(
    entries
      .filter(e => e.status === 'synced')
      .map(e => withStore('readwrite', store => store.delete(e.client_id)))
  )
  notifyChange()
}

async function pruneOldSynced(entries: QueuedReport[]) {
  const cutoff = Date.now() - SYNCED_RETENTION_MS
  const old = entries.filter(e => e.status === 'synced' && e.synced_at && new Date(e.synced_at).getTime() < cutoff)
  await Promise.all(old.map(e => withStore('readwrite', store => store.delete(e.client_id))))
}

class NetworkError extends Error {}

async function uploadEntry(entry: QueuedReport): Promise<{ id: string; duplicate: boolean }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.client_id },
      body: JSON.stringify({
        ...entry.payload,
        client_id: entry.client_id,
        submitted_offline: entry.created_offline || entry.attempts > 0,
        client_created_at: entry.created_at
      }),
      signal: controller.signal
    })
  } catch {
    throw new NetworkError('No connection to server')
  } finally {
    clearTimeout(timeout)
  }

  const body = await response.json().catch(() => ({}))
  if (response.ok) return { id: body.id, duplicate: Boolean(body.duplicate) }
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    throw new NetworkError(body.error || `Server error (${response.status})`)
  }
  throw new Error(body.error || `Rejected by server (${response.status})`)
}

let activeSync: Promise<SyncResult> | null = null

export interface SyncResult {
  synced: number
  duplicates: number
  failed: number
  remaining: number
}

async function runSync(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, duplicates: 0, failed: 0, remaining: 0 }
  const entries = await listQueuedReports()
  await pruneOldSynced(entries)
  // Oldest first; entries stuck in 'syncing' (tab closed mid-upload) are retried.
  const queue = entries
    .filter(e => e.status === 'pending' || e.status === 'syncing')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i]
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      result.remaining = queue.length - i
      break
    }
    await putEntry({ ...entry, status: 'syncing', updated_at: new Date().toISOString() })
    notifyChange()
    try {
      const { id, duplicate } = await uploadEntry(entry)
      const now = new Date().toISOString()
      await putEntry({
        ...entry,
        status: 'synced',
        attempts: entry.attempts + 1,
        last_error: null,
        server_id: id,
        duplicate,
        synced_at: now,
        updated_at: now
      })
      if (duplicate) result.duplicates++
      else result.synced++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      const retryable = err instanceof NetworkError
      await putEntry({
        ...entry,
        status: retryable ? 'pending' : 'failed',
        attempts: entry.attempts + 1,
        last_error: message,
        updated_at: new Date().toISOString()
      })
      if (!retryable) {
        result.failed++
      } else {
        // Connection is down: stop and wait for the next trigger instead of hammering.
        result.remaining = queue.length - i
        notifyChange()
        break
      }
    }
    notifyChange()
  }
  return result
}

// Uploads every queued report. Safe to call often: concurrent calls share one run,
// and other tabs are coordinated via the Web Locks API when available.
export function syncQueue(): Promise<SyncResult> {
  if (!isIndexedDbAvailable()) return Promise.resolve({ synced: 0, duplicates: 0, failed: 0, remaining: 0 })
  if (!activeSync) {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
    const run = locks
      ? (locks.request('vyra-report-sync', runSync) as unknown as Promise<SyncResult>)
      : runSync()
    activeSync = run.finally(() => {
      activeSync = null
    })
  }
  return activeSync
}

export function isSyncing(): boolean {
  return activeSync !== null
}
