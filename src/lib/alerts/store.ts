// Storage for the early-warning system. Two implementations: in-memory (demo mode, tests) and
// Supabase (alertsSupabaseStore.ts). Starts EMPTY: nothing is ever seeded, so a fresh install can
// never show invented alerts.

import { randomUUID } from 'node:crypto'
import type { AlertRecord, AuditEntry, IngestIssue, NotificationRow, ProviderHealth, PushSubscriptionRow } from './types'

export interface AlertFilter {
  statuses?: AlertRecord['status'][]
  origins?: AlertRecord['origin'][]
  provider?: string
  since?: string // only alerts last updated at/after this time
  limit?: number
}

export interface AlertStore {
  mode: 'supabase' | 'memory'
  getAlert(id: string): Promise<AlertRecord | null>
  findByExternal(provider: string, externalId: string): Promise<AlertRecord | null>
  listAlerts(filter?: AlertFilter): Promise<AlertRecord[]>
  saveAlert(alert: AlertRecord): Promise<AlertRecord> // insert or replace by id

  getHealth(): Promise<ProviderHealth[]>
  saveHealth(h: ProviderHealth): Promise<void>

  addIssue(issue: Omit<IngestIssue, 'id' | 'created_at'>): Promise<void>
  listIssues(limit?: number): Promise<IngestIssue[]>

  addAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void>
  listAudit(limit?: number): Promise<AuditEntry[]>

  upsertSubscription(sub: Omit<PushSubscriptionRow, 'id' | 'created_at' | 'updated_at' | 'failure_count'>): Promise<PushSubscriptionRow>
  removeSubscription(endpoint: string): Promise<boolean>
  removeSubscriptionById(id: string): Promise<void>
  listSubscriptions(): Promise<PushSubscriptionRow[]>
  bumpSubscriptionFailure(id: string, reset?: boolean): Promise<void>

  // Returns the row if it was newly recorded, or null if this (alert, revision, subscription, kind) was already notified.
  recordNotification(n: Omit<NotificationRow, 'id' | 'created_at' | 'outcome' | 'detail'>): Promise<NotificationRow | null>
  finishNotification(id: string, outcome: NotificationRow['outcome'], detail?: string | null): Promise<void>
  listNotifications(limit?: number): Promise<NotificationRow[]>
  hasNotified(alertId: string, subscriptionId: string): Promise<boolean>

  // Admin-controlled switches (credentials are NEVER stored here; they live in environment variables).
  getProviderOverrides(): Promise<Record<string, { enabled: boolean }>>
  setProviderOverride(provider: string, enabled: boolean): Promise<void>
}

const clone = <T,>(x: T): T => structuredClone(x)

export function createMemoryAlertStore(): AlertStore {
  const alerts = new Map<string, AlertRecord>()
  const health = new Map<string, ProviderHealth>()
  const issues: IngestIssue[] = []
  const audit: AuditEntry[] = []
  const subs = new Map<string, PushSubscriptionRow>()
  const notes: NotificationRow[] = []
  const overrides: Record<string, { enabled: boolean }> = {}
  const now = () => new Date().toISOString()

  return {
    mode: 'memory',
    async getAlert(id) { const a = alerts.get(id); return a ? clone(a) : null },
    async findByExternal(provider, externalId) {
      const a = [...alerts.values()].find((x) => x.provider === provider && x.external_alert_id === externalId)
      return a ? clone(a) : null
    },
    async listAlerts(f = {}) {
      let list = [...alerts.values()]
      if (f.statuses?.length) list = list.filter((a) => f.statuses!.includes(a.status))
      if (f.origins?.length) list = list.filter((a) => f.origins!.includes(a.origin))
      if (f.provider) list = list.filter((a) => a.provider === f.provider)
      if (f.since) list = list.filter((a) => a.last_updated_at >= f.since!)
      list.sort((a, b) => b.last_updated_at.localeCompare(a.last_updated_at))
      return clone(f.limit ? list.slice(0, f.limit) : list)
    },
    async saveAlert(a) { alerts.set(a.id, clone(a)); return clone(a) },

    async getHealth() { return clone([...health.values()]) },
    async saveHealth(h) { health.set(h.provider, clone(h)) },

    async addIssue(i) { issues.unshift({ ...i, id: randomUUID(), created_at: now() }); issues.length = Math.min(issues.length, 500) },
    async listIssues(limit = 100) { return clone(issues.slice(0, limit)) },

    async addAudit(e) { audit.unshift({ ...e, id: randomUUID(), at: now() }); audit.length = Math.min(audit.length, 2000) },
    async listAudit(limit = 200) { return clone(audit.slice(0, limit)) },

    async upsertSubscription(s) {
      const existing = [...subs.values()].find((x) => x.endpoint === s.endpoint)
      const row: PushSubscriptionRow = existing
        ? { ...existing, ...clone(s), updated_at: now(), failure_count: 0 }
        : { ...clone(s), id: randomUUID(), created_at: now(), updated_at: now(), failure_count: 0 }
      subs.set(row.id, row)
      return clone(row)
    },
    async removeSubscription(endpoint) {
      const hit = [...subs.values()].find((x) => x.endpoint === endpoint)
      if (hit) subs.delete(hit.id)
      return !!hit
    },
    async removeSubscriptionById(id) { subs.delete(id) },
    async listSubscriptions() { return clone([...subs.values()]) },
    async bumpSubscriptionFailure(id, reset) {
      const s = subs.get(id)
      if (s) s.failure_count = reset ? 0 : s.failure_count + 1
    },

    async recordNotification(n) {
      if (notes.some((x) => x.alert_id === n.alert_id && x.revision === n.revision && x.subscription_id === n.subscription_id && x.kind === n.kind)) return null
      const row: NotificationRow = { ...n, id: randomUUID(), created_at: now(), outcome: 'pending', detail: null }
      notes.unshift(row)
      notes.length = Math.min(notes.length, 5000)
      return clone(row)
    },
    async finishNotification(id, outcome, detail = null) {
      const n = notes.find((x) => x.id === id)
      if (n) { n.outcome = outcome; n.detail = detail }
    },
    async listNotifications(limit = 200) { return clone(notes.slice(0, limit)) },
    async hasNotified(alertId, subscriptionId) { return notes.some((x) => x.alert_id === alertId && x.subscription_id === subscriptionId && x.outcome === 'sent') },

    async getProviderOverrides() { return clone(overrides) },
    async setProviderOverride(p, enabled) { overrides[p] = { enabled } },
  }
}
