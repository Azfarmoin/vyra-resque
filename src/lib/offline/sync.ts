// Synchronization queue: sends locally saved reports (and their photos) to the server.
//
// Rules the code below enforces:
//  * local data is only changed to "synced" after the server answered with success;
//  * every request carries an idempotency key (the report's client_id, the photo's id), so a retry after a
//    lost response never creates a duplicate;
//  * temporary failures retry with exponential backoff + jitter; rejections stop and ask the user;
//  * a report is only ever sent with ITS OWNER's identity, never the identity of whoever is signed in now.
import { listAllReports, listAttachments, patchAttachment, setLastSyncAt } from './store'
import type { PhotoAnalysisResult } from '../photoAnalysis/schema'
import { getDb } from './db'
import { notifyChange } from './events'
import { ANON, type LocalAttachment, type LocalReport } from './types'
import type { Identity } from './identity'

export const BACKOFF_BASE_MS = 5_000
export const BACKOFF_CAP_MS = 10 * 60_000
const REQUEST_TIMEOUT_MS = 30_000

/** "Full jitter" exponential backoff: a random wait between ~1 s and min(cap, base * 2^attempts). */
export function computeBackoffMs(attempts: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts))
  return Math.max(1_000, Math.round(random() * ceiling))
}

export interface SyncDeps {
  fetch: typeof fetch
  getIdentity: () => Promise<Identity>
  now: () => number
  random: () => number
  isOnline: () => boolean
}

export function defaultDeps(): SyncDeps {
  return {
    fetch: (...args) => fetch(...args),
    getIdentity: async () => (await import('./identity')).getIdentity(),
    now: () => Date.now(),
    random: Math.random,
    isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  }
}

export interface SyncSummary {
  skipped: 'offline' | null
  synced: number
  failed: number
  waiting: number
  needsAuth: number
}

type Failure = { kind: 'network' | 'retry' | 'auth' | 'permanent'; message: string }

async function classify(res: Response | null, thrown?: unknown): Promise<Failure> {
  if (!res) {
    const aborted = (thrown as Error | undefined)?.name === 'AbortError'
    return { kind: 'network', message: aborted ? 'The server took too long to answer.' : 'No connection to the server.' }
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; details?: { path: string; message: string }[] }
  const detail = body.details?.length ? ` (${body.details.map((d) => `${d.path}: ${d.message}`).join('; ')})` : ''
  const message = `${body.error || `Server answered ${res.status}`}${detail}`
  if (res.status === 401 || (res.status === 403 && body.code === 'account_mismatch')) return { kind: 'auth', message }
  if (res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500) return { kind: 'retry', message }
  return { kind: 'permanent', message }
}

async function request(deps: SyncDeps, url: string, init: RequestInit): Promise<{ res: Response } | { fail: Failure }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await deps.fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
    if (res.ok) return { res }
    return { fail: await classify(res) }
  } catch (e) {
    return { fail: await classify(null, e) }
  } finally {
    clearTimeout(timer)
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

async function put(report: LocalReport) {
  await (await getDb()).put('reports', report)
  notifyChange()
}
async function putAttachment(att: LocalAttachment) {
  await (await getDb()).put('attachments', att)
  notifyChange()
}

type Outcome = 'synced' | 'failed' | 'waiting' | 'needs_auth' | 'stop'

async function syncOne(initial: LocalReport, token: string | null, deps: SyncDeps): Promise<Outcome> {
  let report: LocalReport = { ...initial, status: 'syncing', updated_at: iso(deps.now()) }
  await put(report)
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

  const retryLater = async (f: Failure): Promise<Outcome> => {
    const attempts = report.attempts + 1
    report = { ...report, status: 'waiting', attempts, last_error: f.message, next_attempt_at: iso(deps.now() + computeBackoffMs(attempts, deps.random)), updated_at: iso(deps.now()) }
    await put(report)
    return 'stop' // the connection or server is struggling: do not hammer it with the rest of the queue
  }
  const needAuth = async (f: Failure): Promise<Outcome> => {
    report = { ...report, status: 'needs_auth', last_error: f.message, updated_at: iso(deps.now()) }
    await put(report)
    return 'needs_auth'
  }

  // 1. The report itself.
  if (!report.server_id) {
    const outcome = await request(deps, '/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': report.client_id, ...authHeader },
      body: JSON.stringify({
        ...report.payload,
        client_id: report.client_id,
        submitted_offline: report.created_offline || report.attempts > 0,
        client_created_at: report.queued_at,
      }),
    })
    if ('fail' in outcome) {
      const f = outcome.fail
      if (f.kind === 'network' || f.kind === 'retry') return retryLater(f)
      if (f.kind === 'auth') return needAuth(f)
      report = { ...report, status: 'failed', last_error: f.message, attempts: report.attempts + 1, next_attempt_at: null, updated_at: iso(deps.now()) }
      await put(report)
      return 'failed'
    }
    const body = (await outcome.res.json().catch(() => ({}))) as { report?: { id?: string; status?: string; ingest_channel?: string | null }; duplicate?: boolean }
    if (!body.report?.id) return retryLater({ kind: 'retry', message: 'The server answered without a report ID.' })
    // The server confirmed the report: remember its ID right away, before touching any photo.
    report = { ...report, server_id: body.report.id, server_status: body.report.status ?? 'pending', duplicate: Boolean(body.duplicate), server_ingest_channel: body.report.ingest_channel ?? null, last_error: null }
    await put(report)
  }

  // 2. Photos, one by one. Already-confirmed photos are skipped, so an interrupted run resumes cleanly.
  let photoFailures = 0
  for (const att of await listAttachments(report.client_id)) {
    if (att.status === 'uploaded' || !att.blob) continue
    let current: LocalAttachment = { ...att, status: 'uploading', error: null }
    await putAttachment(current)
    const outcome = await request(deps, `/api/reports/${report.server_id}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': att.type, 'X-Attachment-Id': att.id, 'X-Report-Client-Id': report.client_id, ...authHeader },
      body: att.blob,
    })
    if ('fail' in outcome) {
      const f = outcome.fail
      current = { ...current, status: f.kind === 'permanent' ? 'failed' : 'local', error: f.message }
      await putAttachment(current)
      if (f.kind === 'network' || f.kind === 'retry') return retryLater(f)
      if (f.kind === 'auth') return needAuth(f)
      photoFailures++
      continue
    }
    const body = (await outcome.res.json().catch(() => ({}))) as { attachment?: { id?: string } }
    await putAttachment({ ...current, status: 'uploaded', error: null, uploaded_at: iso(deps.now()), server_attachment_id: body.attachment?.id ?? null })
  }

  if (photoFailures > 0) {
    report = {
      ...report,
      status: 'failed',
      attempts: report.attempts + 1,
      next_attempt_at: null,
      last_error: `The server received your report, but ${photoFailures} photo${photoFailures > 1 ? 's' : ''} could not be uploaded. Retry, or remove the photo.`,
      updated_at: iso(deps.now()),
    }
    await put(report)
    return 'failed'
  }

  // 3. Everything is confirmed by the server. Only now is the report "synced", and the private photo
  //    copies on this device are released.
  const at = iso(deps.now())
  for (const att of await listAttachments(report.client_id)) if (att.blob) await putAttachment({ ...att, blob: null })
  report = { ...report, status: 'synced', synced_at: at, last_error: null, next_attempt_at: null, attempts: report.attempts + 1, updated_at: at }
  await put(report)
  await setLastSyncAt(at)
  void analyzeConfirmedPhotos(report, token, deps).catch(() => undefined)
  return 'synced'
}

// After the server has CONFIRMED a photo, ask it to analyse the stored copy (only if the reporter consented).
// Best effort and fire-and-forget: a failure here never changes the report's sync result, and the server
// call is idempotent so retries do not create duplicate analysis records.
export async function analyzeConfirmedPhotos(report: LocalReport, token: string | null, deps: SyncDeps): Promise<void> {
  if (!report.server_id) return
  const authHeader: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  for (const att of await listAttachments(report.client_id)) {
    if (att.status !== 'uploaded' || !att.analysis_consent) continue
    if (att.analysis?.server_checked && att.analysis.status === 'completed') continue
    try {
      const out = await request(deps, `/api/reports/${report.server_id}/attachments/${att.server_attachment_id ?? att.id}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Report-Client-Id': report.client_id, ...authHeader },
        body: JSON.stringify({ consent: true }),
      })
      if ('fail' in out) continue // keep the local copy; a later sync or the responder's retry can try again
      const body = (await out.res.json().catch(() => ({}))) as { analysis?: { analysis_status?: string; result?: PhotoAnalysisResult | null; failure_reason?: string | null } }
      const a = body.analysis
      const cur = (await listAttachments(report.client_id)).find((x) => x.id === att.id)
      const prev = cur?.analysis
      await patchAttachment(att.id, {
        analysis: {
          status: a?.analysis_status === 'completed' ? 'completed' : 'failed',
          // keep what the reporter already saw, unless it was never analysed
          result: prev?.status === 'completed' && prev.result ? prev.result : a?.result ?? null,
          reason: a?.analysis_status === 'completed' ? null : a?.failure_reason ?? 'The analysis did not complete.',
          at: a?.result?.analyzed_at ?? prev?.at ?? null,
          choice: prev?.choice ?? 'none',
          server_checked: a?.analysis_status === 'completed',
        },
      })
      const choice = prev?.choice
      if (choice && choice !== 'none' && a?.analysis_status === 'completed') {
        await request(deps, `/api/reports/${report.server_id}/attachments/${att.server_attachment_id ?? att.id}/analysis`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Report-Client-Id': report.client_id, ...authHeader },
          body: JSON.stringify({ user_action: choice }),
        })
      }
    } catch {
      /* never let analysis break sync */
    }
  }
}

let running: Promise<SyncSummary> | null = null

async function runSync(opts: { force?: boolean; only?: string }, deps: SyncDeps): Promise<SyncSummary> {
  const summary: SyncSummary = { skipped: null, synced: 0, failed: 0, waiting: 0, needsAuth: 0 }
  if (!deps.isOnline()) return { ...summary, skipped: 'offline' }

  const identity = await deps.getIdentity()
  const now = deps.now()
  const due = (await listAllReports())
    .filter((r) => r.payload && ['saved_locally', 'waiting', 'syncing', 'needs_auth'].includes(r.status))
    .filter((r) => !opts.only || r.client_id === opts.only)
    .filter((r) => opts.force || r.status !== 'waiting' || !r.next_attempt_at || Date.parse(r.next_attempt_at) <= now)
    .sort((a, b) => (a.queued_at ?? a.created_at).localeCompare(b.queued_at ?? b.created_at))

  for (const report of due) {
    let token: string | null = null
    if (report.owner !== ANON) {
      // Only the account that saved the report may send it. Never fall back to someone else's session.
      const mine = identity.owner === report.owner && !!identity.token
      if (!mine) {
        if (report.status !== 'needs_auth') {
          await put({
            ...report,
            status: 'needs_auth',
            last_error: identity.owner === ANON ? 'Sign in to send this report.' : 'This report was saved under a different account. Sign in with that account to send it.',
            updated_at: iso(deps.now()),
          })
        }
        summary.needsAuth++
        continue
      }
      token = identity.token
    }
    // Anonymous reports are always sent anonymously, even if someone has signed in since.
    const outcome = await syncOne(report, token, deps)
    if (outcome === 'synced') summary.synced++
    else if (outcome === 'failed') summary.failed++
    else if (outcome === 'needs_auth') summary.needsAuth++
    else {
      summary.waiting++
      break
    }
  }
  return summary
}

/**
 * Send everything that is due. Safe to call from many places at once: concurrent calls share one run, and
 * the Web Locks API (where available) keeps several open tabs from syncing at the same time.
 * `force` ignores backoff timers (the "Sync now" button); `only` limits the run to one report.
 */
export function syncAll(opts: { force?: boolean; only?: string } = {}, deps: SyncDeps = defaultDeps()): Promise<SyncSummary> {
  // A run is already in progress: wait for it, then run once more. The follow-up finds nothing left to
  // send (so no duplicate requests) unless something new was queued in the meantime.
  if (running) return running.then(() => syncAll(opts, deps))
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  const job = () => runSync(opts, deps)
  const p = locks ? ((locks.request('vyra-offline-sync', job) as unknown) as Promise<SyncSummary>) : job()
  running = p.finally(() => {
    running = null
  })
  return running
}

export const isSyncRunning = () => running !== null
