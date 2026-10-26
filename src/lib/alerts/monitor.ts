// The scheduled backend process. It runs on the server (cron / scheduler hitting /api/alerts/cron), never in a browser:
// each provider is fetched no more often than its own minimum interval, with timeouts, size limits, backoff after
// failures, validation, de-duplication, change detection, and notification of only the material changes.

import { summarizeAlert, type LlmClient } from './ai'
import { applyCandidate, sanitiseError, sweepExpired, type IngestOutcome, type NotifyKind } from './ingest'
import { detectConflicts, effectiveStatus, freshnessOf, type Freshness } from './lifecycle'
import { notifySubscribers, type NotifyResult } from './notify'
import type { AlertProvider, ProviderContext } from './providers'
import type { PushSender } from './push'
import type { AlertStore } from './store'
import type { AlertRecord, Conflict, ProviderHealth } from './types'

export interface FetchTextConfig { timeoutMs?: number; maxBytes?: number; userAgent?: string }

export function makeFetchText(fetchImpl: typeof fetch = fetch, cfg: FetchTextConfig = {}): ProviderContext['fetchText'] {
  const timeoutMs = cfg.timeoutMs ?? 15_000
  const maxBytes = cfg.maxBytes ?? 5_000_000
  const ua = cfg.userAgent ?? 'VYRA-EarlyWarning/1.0'
  return async (url, opts = {}) => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': ua, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store', redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len > maxBytes) throw new Error('Response too large')
    const text = await res.text()
    if (text.length > maxBytes) throw new Error('Response too large')
    return text
  }
}

export interface ProviderRunReport {
  provider: string
  status: 'ok' | 'error' | 'skipped_unconfigured' | 'skipped_disabled' | 'skipped_interval'
  candidates: number
  created: number
  updated: number
  unchanged: number
  rejected: number
  error?: string
}
export interface MonitorReport { ranAt: string; providers: ProviderRunReport[]; notifications: NotifyResult; expired: number }

export interface MonitorOptions {
  fetchImpl?: typeof fetch
  now?: number
  force?: boolean // ignore intervals (admin "run now")
  sender?: PushSender | null
  llm?: { client: LlmClient; model: string } | null
  env?: Record<string, string | undefined>
  language?: string
}

const blankHealth = (p: AlertProvider): ProviderHealth => ({ provider: p.id, enabled: true, configured: !p.unconfiguredReason, last_attempt_at: null, last_success_at: null, last_error: null, consecutive_failures: 0, last_item_count: null, rejected_last_run: 0 })

export async function runMonitoring(store: AlertStore, providers: AlertProvider[], opts: MonitorOptions = {}): Promise<MonitorReport> {
  const now = opts.now ?? Date.now()
  const iso = new Date(now).toISOString()
  const env = opts.env ?? process.env
  const fetchText = makeFetchText(opts.fetchImpl ?? fetch, { userAgent: `VYRA-EarlyWarning/1.0${env.ALERT_CONTACT ? ` (${env.ALERT_CONTACT})` : ''}` })
  const ctx: ProviderContext = { now, fetchText, env }
  const healthList = await store.getHealth()
  const overrides = await store.getProviderOverrides()
  const reports: ProviderRunReport[] = []
  const toNotify: { alert: AlertRecord; kind: NotifyKind }[] = []
  const changed: AlertRecord[] = []

  for (const p of providers) {
    const base: ProviderRunReport = { provider: p.id, status: 'ok', candidates: 0, created: 0, updated: 0, unchanged: 0, rejected: 0 }
    const health = healthList.find((h) => h.provider === p.id) ?? blankHealth(p)
    health.enabled = overrides[p.id]?.enabled ?? true
    health.configured = !p.unconfiguredReason

    if (p.unconfiguredReason) { await store.saveHealth(health); reports.push({ ...base, status: 'skipped_unconfigured', error: p.unconfiguredReason }); continue }
    if (!health.enabled) { await store.saveHealth(health); reports.push({ ...base, status: 'skipped_disabled' }); continue }

    // Respect provider rate limits; back off exponentially (capped at 24x) after consecutive failures.
    const wait = p.minIntervalMinutes * 60_000 * Math.min(2 ** health.consecutive_failures, 24)
    if (!opts.force && health.last_attempt_at && now - Date.parse(health.last_attempt_at) < wait) { reports.push({ ...base, status: 'skipped_interval' }); continue }

    health.last_attempt_at = iso
    try {
      const result = await p.fetchAlerts(ctx)
      base.candidates = result.candidates.length
      base.rejected = result.rejected.length
      for (const r of result.rejected) await store.addIssue({ provider: p.id, kind: r.kind, detail: r.detail.slice(0, 300), external_alert_id: r.externalId })
      for (const c of result.candidates) {
        const outcomes: IngestOutcome[] = await applyCandidate(store, c, now)
        for (const o of outcomes) {
          if (o.action === 'created') base.created++
          else if (o.action === 'updated' || o.action === 'superseded') base.updated++
          else if (o.action === 'unchanged') base.unchanged++
          else if (o.action === 'rejected') base.rejected++
          if (o.alert && (o.action === 'created' || o.action === 'updated')) changed.push(o.alert)
          if (o.alert && o.notify) toNotify.push({ alert: o.alert, kind: o.notify })
        }
      }
      if (p.snapshot) {
        // A complete snapshot: anything of ours no longer present has stopped being true, so withdraw it now.
        const keep = new Set(result.candidates.map((c) => c.external_alert_id))
        for (const old of await store.listAlerts({ provider: p.id, statuses: ['active'] })) {
          if (!keep.has(old.external_alert_id)) {
            await store.saveAlert({ ...old, status: 'expired', last_updated_at: iso })
            await store.addAudit({ actor: `system:${p.id}`, action: 'estimate_withdrawn', alert_id: old.id, detail: 'No longer indicated by the latest forecast' })
          }
        }
      }
      health.last_success_at = iso
      health.last_error = null
      health.consecutive_failures = 0
      health.last_item_count = result.candidates.length
      health.rejected_last_run = base.rejected
    } catch (e) {
      health.last_error = sanitiseError(e)
      health.consecutive_failures += 1
      base.status = 'error'
      base.error = health.last_error
      await store.addIssue({ provider: p.id, kind: 'provider_error', detail: health.last_error, external_alert_id: null })
    }
    await store.saveHealth(health)
    reports.push(base)
  }

  // Optional AI summaries for new/revised official alerts (capped per run to bound cost). Failures never block alerts.
  if (opts.llm) {
    for (const a of changed.filter((x) => x.origin === 'official' || x.origin === 'manual').slice(0, 10)) {
      try {
        const summary = await summarizeAlert(a, { llm: opts.llm.client, model: opts.llm.model, language: opts.language })
        await store.saveAlert({ ...(await store.getAlert(a.id))!, ai_summary: summary })
      } catch { /* summaries are optional */ }
    }
  }

  const notifications: NotifyResult = { attempted: 0, sent: 0, failed: 0, removed: 0, skipped: 0 }
  for (const n of toNotify) {
    const r = await notifySubscribers(store, n.alert, n.kind, opts.sender ?? null)
    for (const k of Object.keys(notifications) as (keyof NotifyResult)[]) notifications[k] += r[k]
  }
  const expired = await sweepExpired(store, now)
  return { ranAt: iso, providers: reports, notifications, expired }
}

// ---------------------------------------------------------------------------------------------
// What the public API returns. Never includes raw source payloads, admin identities or secrets.
export type PublicAlert = Omit<AlertRecord, 'raw_source_metadata' | 'created_by'> & { effective_status: AlertRecord['status']; freshness: Freshness }
export interface PublicProviderState { id: string; name: string; origin: string; coverage: string; state: 'fresh' | 'stale' | 'error' | 'unconfigured' | 'disabled'; lastSuccessAt: string | null; staleAfterMinutes: number }
export interface AlertsView {
  serverTime: string
  alerts: PublicAlert[]
  providers: PublicProviderState[]
  conflicts: Conflict[]
  monitoring: { state: 'not_configured' | 'ok' | 'degraded'; message: string }
}

const DAY = 24 * 3600 * 1000

export async function buildAlertsView(store: AlertStore, providers: AlertProvider[], opts: { now?: number; history?: boolean } = {}): Promise<AlertsView> {
  const now = opts.now ?? Date.now()
  const [all, health, overrides] = await Promise.all([store.listAlerts({ since: new Date(now - 30 * DAY).toISOString(), limit: 500 }), store.getHealth(), store.getProviderOverrides()])
  const byId = new Map(health.map((h) => [h.provider, h]))
  const staleAfter = new Map(providers.map((p) => [p.id, p.staleAfterMinutes]))

  const states: PublicProviderState[] = providers.map((p) => {
    const h = byId.get(p.id)
    const fr = freshnessOf(h, p.staleAfterMinutes, now)
    const enabled = overrides[p.id]?.enabled ?? true
    const state: PublicProviderState['state'] = p.unconfiguredReason ? 'unconfigured' : !enabled ? 'disabled' : h && h.consecutive_failures > 0 ? 'error' : fr.state === 'fresh' ? 'fresh' : 'stale'
    return { id: p.id, name: p.name, origin: p.origin, coverage: p.docs.coverage, state, lastSuccessAt: h?.last_success_at ?? null, staleAfterMinutes: p.staleAfterMinutes }
  })

  const visible = all.filter((a) => {
    const st = effectiveStatus(a, now)
    if (opts.history) return true
    if (st === 'active') return true
    return st === 'cancelled' && now - Date.parse(a.last_updated_at) < DAY // show recent withdrawals so nobody keeps acting on an old alert
  })
  const view: PublicAlert[] = visible.map((a) => {
    const { raw_source_metadata: _r, created_by: _c, ...rest } = a
    void _r; void _c
    const manual = a.origin === 'manual'
    return {
      ...rest,
      effective_status: effectiveStatus(a, now),
      // Human-authored announcements do not depend on a feed; everything else inherits its provider's freshness.
      freshness: manual ? { state: 'fresh', lastSuccessAt: a.last_updated_at, ageMinutes: null } : freshnessOf(byId.get(a.provider), staleAfter.get(a.provider) ?? 60, now),
    }
  })

  const live = states.filter((s) => s.state !== 'unconfigured' && s.state !== 'disabled')
  const monitoring: AlertsView['monitoring'] = live.length === 0
    ? { state: 'not_configured', message: 'No verified data source is configured, so VYRA is NOT monitoring for disasters. This is not a sign that conditions are safe. Follow your national weather service and disaster authority.' }
    : live.every((s) => s.state === 'fresh')
      ? { state: 'ok', message: 'Configured sources were checked recently. Seeing no alert here does not mean your area is safe: sources only publish what they publish.' }
      : { state: 'degraded', message: 'One or more data sources have not updated recently, so alerts below may be out of date or incomplete. Check official channels directly.' }

  return { serverTime: new Date(now).toISOString(), alerts: view, providers: states, conflicts: detectConflicts(all, now), monitoring }
}
