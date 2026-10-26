// Everything the app does with reports on the device. All data lives in IndexedDB (never localStorage).
import { getDb } from './db'
import { notifyChange } from './events'
import { prepareImage, type PreparedImage } from './images'
import { MAX_ATTACHMENTS_PER_REPORT } from '../attachments'
import { ANON, LocalSaveError, PENDING_STATUSES, type LocalAttachment, type LocalReport } from './types'

const nowIso = () => new Date().toISOString()

export function generateId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const isQuota = (e: unknown) => {
  const err = e as { name?: string; code?: number } | null
  return err?.name === 'QuotaExceededError' || err?.code === 22 || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

// Runs a write; if the device refuses, throw an error the UI can show instead of pretending it saved.
async function guarded<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isQuota(e)) throw new LocalSaveError(`This device is out of storage, so ${what} could not be saved. Free some space (delete old photos or apps) and try again.`, true)
    throw new LocalSaveError(`${what[0].toUpperCase()}${what.slice(1)} could not be saved on this device (${(e as Error)?.message || 'storage unavailable'}). Private browsing or blocked site data can cause this.`)
  }
}

// ---------- reads ----------

export async function getReport(id: string): Promise<LocalReport | undefined> {
  return (await getDb()).get('reports', id)
}

export async function listReports(owner: string): Promise<LocalReport[]> {
  const rows = await (await getDb()).getAllFromIndex('reports', 'owner', owner)
  return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

/** Used by the sync engine only: every owner's reports (each is synced with its own owner's identity). */
export async function listAllReports(): Promise<LocalReport[]> {
  return (await getDb()).getAll('reports')
}

export async function listAttachments(reportId: string): Promise<LocalAttachment[]> {
  const rows = await (await getDb()).getAllFromIndex('attachments', 'report_id', reportId)
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export async function listAttachmentsForOwner(owner: string): Promise<LocalAttachment[]> {
  return (await (await getDb()).getAll('attachments')).filter((a) => a.owner === owner)
}

export async function loadActiveDraft(owner: string): Promise<LocalReport | null> {
  const drafts = (await listReports(owner)).filter((r) => r.status === 'draft')
  return drafts[0] ?? null
}

// ---------- drafts and queueing ----------

export async function saveDraft(input: { client_id: string; owner: string; form: Record<string, unknown>; step: number }): Promise<LocalReport> {
  return guarded('your draft', async () => {
    const db = await getDb()
    const existing = await db.get('reports', input.client_id)
    // Never turn a report that is already queued/synced back into a draft by accident.
    if (existing && existing.status !== 'draft') return existing
    const t = nowIso()
    const row: LocalReport = {
      client_id: input.client_id,
      owner: input.owner,
      status: 'draft',
      form: input.form,
      payload: null,
      step: input.step,
      created_at: existing?.created_at ?? t,
      updated_at: t,
      queued_at: null,
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      server_id: null,
      server_status: null,
      synced_at: null,
      duplicate: false,
      created_offline: false,
    }
    await db.put('reports', row)
    notifyChange()
    return row
  })
}

/** Move a report into the sync queue. It is on the device the moment this resolves. */
export async function queueReport(input: { client_id: string; owner: string; form: Record<string, unknown>; payload: Record<string, unknown> }): Promise<LocalReport> {
  return guarded('your report', async () => {
    const db = await getDb()
    const existing = await db.get('reports', input.client_id)
    if (existing && (existing.status === 'synced' || existing.server_id)) return existing // already on the server
    const t = nowIso()
    const row: LocalReport = {
      client_id: input.client_id,
      owner: input.owner,
      status: 'saved_locally',
      form: input.form,
      payload: input.payload,
      step: 0,
      created_at: existing?.created_at ?? t,
      updated_at: t,
      queued_at: t,
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
      server_id: null,
      server_status: null,
      synced_at: null,
      duplicate: false,
      created_offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
    }
    await db.put('reports', row)
    for (const a of await listAttachments(input.client_id)) if (a.owner !== input.owner) await db.put('attachments', { ...a, owner: input.owner })
    notifyChange()
    return row
  })
}

/**
 * Reopen an unsent report for editing. It goes back to "draft" so the sync engine cannot upload
 * half-edited data. A report the server already has cannot be edited (only its photos can be retried).
 */
export async function beginEdit(id: string): Promise<LocalReport | null> {
  const db = await getDb()
  const r = await db.get('reports', id)
  if (!r || r.server_id || r.status === 'synced' || r.status === 'syncing') return null
  if (r.status === 'draft') return r
  const next: LocalReport = { ...r, status: 'draft', payload: null, attempts: 0, next_attempt_at: null, last_error: null, updated_at: nowIso() }
  await db.put('reports', next)
  notifyChange()
  return next
}

export async function retryReport(id: string): Promise<void> {
  const db = await getDb()
  const r = await db.get('reports', id)
  if (!r || !r.payload || r.status === 'draft' || r.status === 'synced') return
  await db.put('reports', { ...r, status: 'saved_locally', attempts: 0, next_attempt_at: null, last_error: null, updated_at: nowIso() })
  for (const a of await listAttachments(id)) {
    if (a.status === 'failed' || a.status === 'uploading') await db.put('attachments', { ...a, status: 'local', error: null })
  }
  notifyChange()
}

// ---------- deleting (always explicit; the UI confirms first) ----------

export async function deleteLocalReport(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['reports', 'attachments', 'delivery'], 'readwrite')
  const keys = await tx.objectStore('attachments').index('report_id').getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore('attachments').delete(k)))
  await tx.objectStore('reports').delete(id)
  await tx.objectStore('delivery').delete(id)
  await tx.done
  notifyChange()
}

export async function deleteAllUnsynced(owner: string): Promise<number> {
  const rows = (await listReports(owner)).filter((r) => r.status !== 'synced')
  for (const r of rows) await deleteLocalReport(r.client_id)
  return rows.length
}

export async function clearSynced(owner: string): Promise<void> {
  for (const r of (await listReports(owner)).filter((r) => r.status === 'synced')) await deleteLocalReport(r.client_id)
}

// ---------- photos ----------

export async function addAttachment(reportId: string, owner: string, file: Blob & { name?: string }, prepare: (f: Blob & { name?: string }) => Promise<PreparedImage> = prepareImage): Promise<LocalAttachment> {
  const existing = await listAttachments(reportId)
  if (existing.length >= MAX_ATTACHMENTS_PER_REPORT) throw new LocalSaveError(`You can attach up to ${MAX_ATTACHMENTS_PER_REPORT} photos to one report.`)
  const img = await prepare(file) // throws ImageRejected with a readable reason
  const info = await storageInfo()
  if (info.quota && info.quota - info.usage < img.blob.size * 2) {
    throw new LocalSaveError('This device is almost out of storage, so the photo was not saved. Free some space and try again.', true)
  }
  return guarded('this photo', async () => {
    const att: LocalAttachment = {
      id: generateId(),
      report_id: reportId,
      owner,
      name: img.name,
      type: img.type,
      size: img.blob.size,
      width: img.width,
      height: img.height,
      blob: img.blob,
      status: 'local',
      error: null,
      created_at: nowIso(),
      uploaded_at: null,
      server_attachment_id: null,
    }
    await (await getDb()).put('attachments', att)
    notifyChange()
    return att
  })
}

// Read-modify-write in ONE transaction so a result arriving while a sync is running is not lost.
export async function patchAttachment(id: string, patch: Partial<Pick<LocalAttachment, 'analysis' | 'analysis_consent'>>): Promise<LocalAttachment | null> {
  const db = await getDb()
  const tx = db.transaction('attachments', 'readwrite')
  const cur = await tx.store.get(id)
  if (!cur) {
    await tx.done
    return null
  }
  const next = { ...cur, ...patch }
  await tx.store.put(next)
  await tx.done
  notifyChange()
  return next
}

export async function removeAttachment(id: string): Promise<void> {
  await (await getDb()).delete('attachments', id)
  notifyChange()
}

// ---------- device storage ----------

export async function storageInfo(): Promise<{ usage: number; quota: number; persisted: boolean | null }> {
  try {
    const est = await navigator.storage?.estimate?.()
    const persisted = (await navigator.storage?.persisted?.()) ?? null
    return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted }
  } catch {
    return { usage: 0, quota: 0, persisted: null }
  }
}

/** Ask the browser not to evict our data. It may say no; we never assume it said yes. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

// ---------- meta + summary ----------

export async function getLastSyncAt(): Promise<string | null> {
  return ((await (await getDb()).get('meta', 'lastSyncAt'))?.value as string | undefined) ?? null
}
export async function setLastSyncAt(iso: string) {
  await (await getDb()).put('meta', { key: 'lastSyncAt', value: iso })
}

export interface QueueStats {
  pendingReports: number
  pendingImages: number
  failedReports: number
  needsAuth: number
}

export function summarize(reports: LocalReport[], attachments: LocalAttachment[]): QueueStats {
  const pending = reports.filter((r) => PENDING_STATUSES.includes(r.status))
  const ids = new Set(reports.filter((r) => r.status !== 'synced').map((r) => r.client_id))
  return {
    pendingReports: pending.length,
    pendingImages: attachments.filter((a) => a.status !== 'uploaded' && ids.has(a.report_id) && !!a.blob).length,
    failedReports: reports.filter((r) => r.status === 'failed').length,
    needsAuth: reports.filter((r) => r.status === 'needs_auth').length,
  }
}

export { ANON }
