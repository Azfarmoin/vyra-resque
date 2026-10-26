// Turns provider candidates into stored alerts without ever creating duplicates:
//   same (provider, external_alert_id) + same content  -> unchanged (only last_seen_at moves)
//   same id, changed content                           -> the stored alert is revised (revision + 1)
//   CAP Update / Cancel referencing older messages     -> those older alerts become superseded / cancelled
// It also decides which changes deserve a notification, so unchanged warnings never re-notify.

import { createHash, randomUUID } from 'node:crypto'
import { reviewFlagsFor, effectiveStatus } from './lifecycle'
import type { AlertStore } from './store'
import { SEVERITIES, HAZARD_TYPES, ORIGINS, type AlertCandidate, type AlertRecord } from './types'

export type NotifyKind = 'new' | 'update' | 'cancel'
export interface IngestOutcome {
  action: 'created' | 'updated' | 'unchanged' | 'rejected' | 'superseded'
  alert?: AlertRecord
  notify?: NotifyKind
  reason?: string
}

// Only fields a reader would act on take part in change detection.
export function contentHash(c: Pick<AlertCandidate, 'severity' | 'status' | 'title' | 'description' | 'instruction' | 'affected_area' | 'starts_at' | 'expires_at' | 'areas' | 'hazard_type'>): string {
  const payload = JSON.stringify([c.severity, c.status, c.hazard_type, c.title, c.description, c.instruction, c.affected_area, c.starts_at, c.expires_at, c.areas])
  return createHash('sha256').update(payload).digest('hex')
}

const NOTIFY_MAX_AGE_MS = 6 * 3600 * 1000 // never push an alert that was issued long ago (e.g. when a provider is first enabled)

export function validateCandidate(c: AlertCandidate): string | null {
  if (!c.provider || !c.external_alert_id) return 'missing provider or id'
  if (!SEVERITIES.includes(c.severity)) return `unknown severity "${c.severity}"`
  if (!(c.hazard_type in HAZARD_TYPES)) return `unknown hazard "${c.hazard_type}"`
  if (!ORIGINS.includes(c.origin)) return `unknown origin "${c.origin}"`
  if (!Number.isFinite(Date.parse(c.issued_at)) || !Number.isFinite(Date.parse(c.last_updated_at))) return 'invalid issue time'
  if (c.expires_at && !Number.isFinite(Date.parse(c.expires_at))) return 'invalid expiry'
  if (!c.title) return 'missing title'
  return null
}

const isBareCancel = (c: AlertCandidate) => c.status === 'cancelled' && c.title === 'Cancelled alert' && !c.description && !c.areas.length

// The kinds of change that justify bothering someone again.
function materialChange(prev: AlertRecord, next: AlertCandidate): boolean {
  return prev.severity !== next.severity || prev.affected_area !== next.affected_area || prev.starts_at !== next.starts_at || prev.expires_at !== next.expires_at || prev.status !== next.status
}

export async function applyCandidate(store: AlertStore, c: AlertCandidate, now = Date.now()): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = []
  const bad = validateCandidate(c)
  if (bad) {
    await store.addIssue({ provider: c.provider || 'unknown', kind: 'malformed', detail: bad, external_alert_id: c.external_alert_id || null })
    return [{ action: 'rejected', reason: bad }]
  }
  const iso = new Date(now).toISOString()

  // 1. Withdraw / replace the earlier messages this one refers to.
  for (const refId of c.supersedes ?? []) {
    if (refId === c.external_alert_id) continue
    const old = await store.findByExternal(c.provider, refId)
    if (old && old.status === 'active') {
      const next: AlertRecord = { ...old, status: c.status === 'cancelled' ? 'cancelled' : 'superseded', last_updated_at: c.last_updated_at > old.last_updated_at ? c.last_updated_at : iso, last_seen_at: iso }
      const saved = await store.saveAlert(next)
      await store.addAudit({ actor: `system:${c.provider}`, action: c.status === 'cancelled' ? 'cancelled_by_source' : 'superseded_by_source', alert_id: old.id, detail: `Replaced by ${c.external_alert_id}` })
      outcomes.push({ action: 'superseded', alert: saved, notify: c.status === 'cancelled' ? 'cancel' : undefined })
    }
  }
  if (isBareCancel(c)) return outcomes.length ? outcomes : [{ action: 'unchanged', reason: 'cancellation referenced nothing we hold' }]

  // 2. Create or revise this message.
  const hash = contentHash(c)
  const existing = await store.findByExternal(c.provider, c.external_alert_id)
  const flags = reviewFlagsFor(c, now)

  if (!existing) {
    const rec: AlertRecord = {
      ...stripSupersedes(c), id: randomUUID(), first_seen_at: iso, last_seen_at: iso, revision: 1, content_hash: hash, ai_summary: null, review_flags: flags,
    }
    const saved = await store.saveAlert(rec)
    await store.addAudit({ actor: `system:${c.provider}`, action: 'imported', alert_id: saved.id, detail: `${saved.severity} ${saved.hazard_type}: ${saved.title}` })
    const fresh = now - Date.parse(c.issued_at) <= NOTIFY_MAX_AGE_MS
    const live = effectiveStatus(saved, now) === 'active'
    outcomes.push({ action: 'created', alert: saved, notify: fresh && live && saved.origin !== 'internal_estimate' ? 'new' : undefined })
    return outcomes
  }

  if (existing.content_hash === hash) {
    const saved = await store.saveAlert({ ...existing, last_seen_at: iso })
    outcomes.push({ action: 'unchanged', alert: saved })
    return outcomes
  }
  // A late-arriving older revision must not overwrite a newer one (and must not resurrect a cancelled alert).
  if (c.last_updated_at < existing.last_updated_at) {
    outcomes.push({ action: 'unchanged', alert: existing, reason: 'older revision ignored' })
    return outcomes
  }
  if (existing.status === 'cancelled' && c.status === 'active' && c.last_updated_at <= existing.last_updated_at) {
    outcomes.push({ action: 'unchanged', alert: existing, reason: 'cancelled alert not resurrected' })
    return outcomes
  }
  const material = materialChange(existing, c)
  const rec: AlertRecord = {
    ...existing, ...stripSupersedes(c), id: existing.id, first_seen_at: existing.first_seen_at, last_seen_at: iso,
    revision: existing.revision + 1, content_hash: hash,
    // Text changed -> any earlier summary describes old text, so drop it; it is regenerated on demand.
    ai_summary: null, review_flags: flags,
  }
  const saved = await store.saveAlert(rec)
  await store.addAudit({ actor: `system:${c.provider}`, action: 'revised', alert_id: saved.id, detail: `revision ${saved.revision}: ${existing.severity}->${saved.severity}, status ${existing.status}->${saved.status}` })
  const kind: NotifyKind | undefined = !material || saved.origin === 'internal_estimate' ? undefined : saved.status === 'cancelled' ? 'cancel' : effectiveStatus(saved, now) === 'active' ? 'update' : undefined
  outcomes.push({ action: 'updated', alert: saved, notify: kind })
  return outcomes
}

function stripSupersedes(c: AlertCandidate): Omit<AlertCandidate, 'supersedes'> {
  const { supersedes: _s, ...rest } = c
  void _s
  return rest
}

// Persist "expired" for alerts past their expiry so history queries are simple. Returns how many changed.
export async function sweepExpired(store: AlertStore, now = Date.now()): Promise<number> {
  const active = await store.listAlerts({ statuses: ['active'] })
  let n = 0
  for (const a of active) {
    if (effectiveStatus(a, now) === 'expired') {
      await store.saveAlert({ ...a, status: 'expired' })
      await store.addAudit({ actor: 'system:sweeper', action: 'expired', alert_id: a.id, detail: `Expired at ${a.expires_at}` })
      n++
    }
  }
  return n
}

// Errors may embed URLs (and so tokens in query strings). Keep logs and health records free of them.
export function sanitiseError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/https?:\/\/\S+/gi, '[url]').replace(/(key|token|secret|password|authorization)=\S+/gi, '$1=[redacted]').slice(0, 300)
}
