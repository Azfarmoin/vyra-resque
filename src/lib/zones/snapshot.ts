// Offline snapshot of zones: merge rules (pure) + IndexedDB persistence (browser only).
// The snapshot remembers WHICH map regions were fetched and WHEN, so offline the app can say
// "cached zones from 14:05" and never implies a region it never loaded has no hazards.
import { bboxIntersects } from './geometry'
import type { BBox, DisasterZone, FeedStatus } from './types'

export interface Coverage { bbox: BBox; fetched_at: string }
export interface ZoneSnapshot { zones: DisasterZone[]; feeds: FeedStatus[]; coverage: Coverage[]; fetched_at: string | null; server_time: string | null }
export const EMPTY_SNAPSHOT: ZoneSnapshot = { zones: [], feeds: [], coverage: [], fetched_at: null, server_time: null }
const MAX_COVERAGE = 40
const MAX_ZONES = 4000

const contains = (outer: BBox, inner: BBox) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]

/**
 * Fold a successful response for `bbox` into the snapshot. Zones that intersect the requested area but are
 * absent from the response were removed/hidden by the server, so they are dropped; everything else is kept.
 * With no bbox the response covers the whole world.
 */
export function mergeSnapshot(prev: ZoneSnapshot, incoming: { zones: DisasterZone[]; feeds: FeedStatus[]; server_time: string }, bbox: BBox | null, now = new Date().toISOString()): ZoneSnapshot {
  const area: BBox = bbox ?? [-180, -90, 180, 90]
  const ids = new Set(incoming.zones.map((z) => z.id))
  const kept = prev.zones.filter((z) => !ids.has(z.id) && !bboxIntersects(z.bbox, area))
  const zones = [...incoming.zones, ...kept].slice(0, MAX_ZONES)
  const coverage = [{ bbox: area, fetched_at: now }, ...prev.coverage.filter((c) => !contains(area, c.bbox))].slice(0, MAX_COVERAGE)
  return { zones, feeds: incoming.feeds, coverage, fetched_at: now, server_time: incoming.server_time }
}

/** Is any part of `view` outside the regions we have data for? Used to warn "no zone data for this part of the map". */
export function uncoveredFraction(snapshot: ZoneSnapshot, view: BBox, steps = 6): number {
  let miss = 0, total = 0
  for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
    const lng = view[0] + ((view[2] - view[0]) * (i + 0.5)) / steps
    const lat = view[1] + ((view[3] - view[1]) * (j + 0.5)) / steps
    total++
    if (!snapshot.coverage.some((c) => lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3])) miss++
  }
  return miss / total
}

export function snapshotAgeMinutes(s: ZoneSnapshot, now = Date.now()): number | null {
  return s.fetched_at ? Math.max(0, Math.round((now - Date.parse(s.fetched_at)) / 60_000)) : null
}

// ---- IndexedDB (separate database from the report queue so the queue's schema is untouched) -----------
const DB = 'vyra-zones'
const STORE = 'snapshot'
const KEY = 'latest'
let dbp: Promise<IDBDatabase> | null = null

const hasIdb = () => typeof indexedDB !== 'undefined'
function open(): Promise<IDBDatabase> {
  if (!hasIdb()) return Promise.reject(new Error('IndexedDB unavailable'))
  dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE) }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { dbp = null; reject(r.error) }
  })
  return dbp
}

export async function loadSnapshot(): Promise<ZoneSnapshot> {
  try {
    const db = await open()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve(isSnapshot(req.result) ? req.result : EMPTY_SNAPSHOT)
      req.onerror = () => resolve(EMPTY_SNAPSHOT)
    })
  } catch {
    return EMPTY_SNAPSHOT
  }
}

export async function saveSnapshot(s: ZoneSnapshot): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(s, KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => resolve() // cache is best effort; never break the map
    })
  } catch {
    /* storage full or blocked: the live map still works */
  }
}

export function isSnapshot(x: unknown): x is ZoneSnapshot {
  const s = x as ZoneSnapshot
  return !!s && Array.isArray(s.zones) && Array.isArray(s.coverage) && Array.isArray(s.feeds)
}
