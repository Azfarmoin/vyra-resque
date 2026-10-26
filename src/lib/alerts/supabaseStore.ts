// Supabase-backed alert store. Server only: it uses the service-role key, which bypasses Row Level Security,
// because ingestion, push subscriptions and delivery logs must never be writable from a browser.
// Tables are created by supabase/migrations/008_early_warning.sql.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertFilter, AlertStore } from './store'
import type { AlertRecord, AuditEntry, IngestIssue, NotificationRow, ProviderHealth, PushSubscriptionRow } from './types'

class DbError extends Error {}
function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) {
    const hint = res.error.code === '42P01' ? ' (did you run supabase/migrations/008_early_warning.sql?)' : ''
    throw new DbError(`${what}: ${res.error.message}${hint}`)
  }
  return res.data as T
}

// The table column is called "geometry" (it holds each area's description, boundaries and geocodes).
const toRow = (a: AlertRecord) => {
  const { areas, ...rest } = a
  return { ...rest, geometry: areas }
}
const fromRow = (r: Record<string, any>): AlertRecord => {
  const { geometry, ...rest } = r
  return { ...rest, areas: geometry ?? [], review_flags: r.review_flags ?? [], limitations: r.limitations ?? [] } as AlertRecord
}

export function createSupabaseAlertStore(db: SupabaseClient): AlertStore {
  return {
    mode: 'supabase',
    async getAlert(id) {
      const r = await db.from('disaster_alerts').select('*').eq('id', id).maybeSingle()
      if (r.error?.code === '22P02') return null // not a uuid
      const d = check(r, 'Load alert')
      return d ? fromRow(d as Record<string, any>) : null
    },
    async findByExternal(provider, externalId) {
      const d = check(await db.from('disaster_alerts').select('*').eq('provider', provider).eq('external_alert_id', externalId).maybeSingle(), 'Find alert')
      return d ? fromRow(d as Record<string, any>) : null
    },
    async listAlerts(f: AlertFilter = {}) {
      let q = db.from('disaster_alerts').select('*').order('last_updated_at', { ascending: false }).limit(f.limit ?? 1000)
      if (f.statuses?.length) q = q.in('status', f.statuses)
      if (f.origins?.length) q = q.in('origin', f.origins)
      if (f.provider) q = q.eq('provider', f.provider)
      if (f.since) q = q.gte('last_updated_at', f.since)
      return (check(await q, 'List alerts') as Record<string, any>[]).map(fromRow)
    },
    async saveAlert(a) {
      const d = check(await db.from('disaster_alerts').upsert(toRow(a), { onConflict: 'id' }).select().single(), 'Save alert')
      return fromRow(d as unknown as Record<string, any>)
    },

    async getHealth() { return check(await db.from('alert_provider_health').select('*'), 'Load provider health') as ProviderHealth[] },
    async saveHealth(h) { check(await db.from('alert_provider_health').upsert(h, { onConflict: 'provider' }), 'Save provider health') },

    async addIssue(i) { check(await db.from('alert_ingest_issues').insert(i), 'Record issue') },
    async listIssues(limit = 100) { return check(await db.from('alert_ingest_issues').select('*').order('created_at', { ascending: false }).limit(limit), 'List issues') as IngestIssue[] },

    async addAudit(e) { check(await db.from('alert_audit_log').insert(e), 'Write audit log') },
    async listAudit(limit = 200) { return check(await db.from('alert_audit_log').select('*').order('at', { ascending: false }).limit(limit), 'List audit log') as AuditEntry[] },

    async upsertSubscription(s) {
      const row = { ...s, updated_at: new Date().toISOString(), failure_count: 0 }
      return check(await db.from('alert_push_subscriptions').upsert(row, { onConflict: 'endpoint' }).select().single(), 'Save subscription') as PushSubscriptionRow
    },
    async removeSubscription(endpoint) {
      const d = check(await db.from('alert_push_subscriptions').delete().eq('endpoint', endpoint).select('id'), 'Remove subscription') as unknown[]
      return d.length > 0
    },
    async removeSubscriptionById(id) { check(await db.from('alert_push_subscriptions').delete().eq('id', id), 'Remove subscription') },
    async listSubscriptions() { return check(await db.from('alert_push_subscriptions').select('*'), 'List subscriptions') as PushSubscriptionRow[] },
    async bumpSubscriptionFailure(id, reset) {
      if (reset) { check(await db.from('alert_push_subscriptions').update({ failure_count: 0 }).eq('id', id), 'Reset failures'); return }
      const cur = check(await db.from('alert_push_subscriptions').select('failure_count').eq('id', id).maybeSingle(), 'Read failures') as { failure_count: number } | null
      if (cur) check(await db.from('alert_push_subscriptions').update({ failure_count: cur.failure_count + 1 }).eq('id', id), 'Bump failures')
    },

    async recordNotification(n) {
      const r = await db.from('alert_notifications').insert({ ...n, outcome: 'pending' }).select().single()
      if (r.error?.code === '23505') return null // unique (alert, revision, subscription, kind): already notified
      return check(r, 'Record notification') as NotificationRow
    },
    async finishNotification(id, outcome, detail = null) { check(await db.from('alert_notifications').update({ outcome, detail }).eq('id', id), 'Update notification') },
    async listNotifications(limit = 200) { return check(await db.from('alert_notifications').select('*').order('created_at', { ascending: false }).limit(limit), 'List notifications') as NotificationRow[] },
    async hasNotified(alertId, subscriptionId) {
      const d = check(await db.from('alert_notifications').select('id').eq('alert_id', alertId).eq('subscription_id', subscriptionId).eq('outcome', 'sent').limit(1), 'Check notified') as unknown[]
      return d.length > 0
    },

    async getProviderOverrides() {
      const rows = check(await db.from('alert_provider_settings').select('provider, enabled'), 'Load provider settings') as { provider: string; enabled: boolean }[]
      return Object.fromEntries(rows.map((r) => [r.provider, { enabled: r.enabled }]))
    },
    async setProviderOverride(provider, enabled) { check(await db.from('alert_provider_settings').upsert({ provider, enabled, updated_at: new Date().toISOString() }, { onConflict: 'provider' }), 'Save provider setting') },
  }
}
