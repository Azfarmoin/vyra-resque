// Decides who is told about a new / materially changed / cancelled alert, and records what happened.
// Rules:
//  - one notification per (alert revision, subscriber, kind): unchanged warnings never re-notify
//  - a subscriber needs at least one saved location; the alert must match it as "yes" or "possible"
//    (manual announcements published without a boundary are broadcast to everyone whose severity filter allows it)
//  - a cancellation is only sent to people who were actually notified about that alert before
//  - the push payload never contains the subscriber's location

import { matchLocation } from './geo'
import type { NotifyKind } from './ingest'
import type { PushSender } from './push'
import type { AlertStore } from './store'
import { HAZARD_TYPES, SEVERITY_LABELS, severityRank, type AlertRecord, type PushSubscriptionRow } from './types'

export interface NotifyResult { attempted: number; sent: number; failed: number; removed: number; skipped: number }

export function wantsAlert(sub: PushSubscriptionRow, alert: AlertRecord): boolean {
  if (sub.hazard_types.length && !sub.hazard_types.includes(alert.hazard_type)) return false
  if (severityRank(alert.severity) < severityRank(sub.minimum_severity)) return false
  const hasBoundary = alert.areas.some((a) => a.geometry.length)
  if (alert.origin === 'manual' && !hasBoundary) return true // deliberate broadcast by an administrator
  if (!sub.locations.length) return false
  return sub.locations.some((l) => {
    const m = matchLocation(alert, l)
    return m.result === 'yes' || m.result === 'possible'
  })
}

export function buildPayload(alert: AlertRecord, kind: NotifyKind): string {
  const prefix = kind === 'cancel' ? 'Cancelled: ' : kind === 'update' ? 'Updated: ' : ''
  return JSON.stringify({
    title: `${SEVERITY_LABELS[alert.severity]} - ${HAZARD_TYPES[alert.hazard_type]}`,
    body: `${prefix}${alert.source_name}: ${alert.title}`.slice(0, 160),
    url: `/alerts?id=${encodeURIComponent(alert.id)}`,
    tag: `alert-${alert.id}`,
    severity: alert.severity,
    cancelled: kind === 'cancel',
  })
}

export async function notifySubscribers(store: AlertStore, alert: AlertRecord, kind: NotifyKind, sender: PushSender | null): Promise<NotifyResult> {
  const res: NotifyResult = { attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 0 }
  const subs = await store.listSubscriptions()
  for (const sub of subs) {
    if (!wantsAlert(sub, alert)) { res.skipped++; continue }
    if (kind === 'cancel' && !(await store.hasNotified(alert.id, sub.id))) { res.skipped++; continue }
    const rec = await store.recordNotification({ alert_id: alert.id, revision: alert.revision, subscription_id: sub.id, kind })
    if (!rec) { res.skipped++; continue } // already handled for this revision
    res.attempted++
    if (!sender) { await store.finishNotification(rec.id, 'failed', 'Push is not configured on the server (VAPID keys missing)'); res.failed++; continue }
    try {
      const r = await sender({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, buildPayload(alert, kind))
      if (r.ok) { await store.finishNotification(rec.id, 'sent'); await store.bumpSubscriptionFailure(sub.id, true); res.sent++ }
      else if (r.status === 404 || r.status === 410) { await store.finishNotification(rec.id, 'gone', 'Subscription expired or unsubscribed'); await store.removeSubscriptionById(sub.id); res.removed++ }
      else {
        await store.finishNotification(rec.id, 'failed', `${r.status || 'network'}: ${r.message}`)
        await store.bumpSubscriptionFailure(sub.id)
        if (sub.failure_count + 1 >= 10) { await store.removeSubscriptionById(sub.id); res.removed++ }
        res.failed++
      }
    } catch (e) {
      await store.finishNotification(rec.id, 'failed', (e instanceof Error ? e.message : 'error').replace(/https?:\/\/\S+/g, '[url]').slice(0, 200))
      res.failed++
    }
  }
  return res
}
