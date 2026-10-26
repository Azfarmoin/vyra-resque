// Pure helpers shared by server and browser: is an alert still in force, is its source fresh,
// do sources disagree, and what needs a human to look at it.

import { alertBBox, bboxOverlap } from './geo'
import type { AlertRecord, AlertStatus, Conflict, Origin, ProviderHealth } from './types'
import { severityRank } from './types'

// An alert is never "active" once its expiry has passed, even if nothing has re-fetched it yet.
export function effectiveStatus(a: Pick<AlertRecord, 'status' | 'expires_at'>, now = Date.now()): AlertStatus {
  if (a.status !== 'active') return a.status
  if (a.expires_at && Date.parse(a.expires_at) <= now) return 'expired'
  return 'active'
}

// Lower number = more authoritative. Official alerting authorities lead; VYRA's own estimates come last.
export const ORIGIN_AUTHORITY: Record<Origin, number> = { official: 0, observation: 1, manual: 2, internal_estimate: 3 }

export interface Freshness {
  // fresh: provider fetched successfully within its allowed window
  // stale: last success is older than the window (or never) - alerts from it may be out of date
  // unknown: provider has no health record
  state: 'fresh' | 'stale' | 'unknown'
  lastSuccessAt: string | null
  ageMinutes: number | null
}

export function freshnessOf(health: Pick<ProviderHealth, 'last_success_at'> | undefined, staleAfterMinutes: number, now = Date.now()): Freshness {
  if (!health) return { state: 'unknown', lastSuccessAt: null, ageMinutes: null }
  if (!health.last_success_at) return { state: 'stale', lastSuccessAt: null, ageMinutes: null }
  const age = Math.max(0, Math.round((now - Date.parse(health.last_success_at)) / 60000))
  return { state: age > staleAfterMinutes ? 'stale' : 'fresh', lastSuccessAt: health.last_success_at, ageMinutes: age }
}

const sameWindow = (a: AlertRecord, b: AlertRecord) => {
  const aStart = a.starts_at ? Date.parse(a.starts_at) : Date.parse(a.issued_at)
  const bStart = b.starts_at ? Date.parse(b.starts_at) : Date.parse(b.issued_at)
  const aEnd = a.expires_at ? Date.parse(a.expires_at) : Infinity
  const bEnd = b.expires_at ? Date.parse(b.expires_at) : Infinity
  return aStart <= bEnd && bStart <= aEnd
}

// Two ACTIVE alerts from different providers about the same hazard, in overlapping places and times,
// that disagree on severity. Nothing is merged or hidden: the UI shows all of them and leads with the
// most authoritative one.
export function detectConflicts(alerts: AlertRecord[], now = Date.now()): Conflict[] {
  const active = alerts.filter((a) => effectiveStatus(a, now) === 'active')
  const out: Conflict[] = []
  const seen = new Set<string>()
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j]
      if (a.provider === b.provider || a.hazard_type !== b.hazard_type || a.severity === b.severity) continue
      if (!sameWindow(a, b)) continue
      const ba = alertBBox(a), bb = alertBBox(b)
      // With no boundary on one side we cannot tell whether they overlap; do not guess.
      if (!ba || !bb || !bboxOverlap(ba, bb)) continue
      const key = [a.id, b.id].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      const lead = ORIGIN_AUTHORITY[a.origin] <= ORIGIN_AUTHORITY[b.origin] ? a : b
      const other = lead === a ? b : a
      out.push({
        hazard_type: a.hazard_type,
        alert_ids: [a.id, b.id],
        prioritised_id: lead.id,
        reason: `${lead.source_name} says ${lead.severity}; ${other.source_name} says ${other.severity}. The more authoritative source is shown first; read both.`,
      })
    }
  }
  return out
}

// Things a human reviewer should look at. Rule-based so it is predictable and testable.
export function reviewFlagsFor(a: Pick<AlertRecord, 'origin' | 'expires_at' | 'affected_area' | 'areas' | 'description' | 'instruction' | 'issued_at' | 'severity' | 'source_url'>, now = Date.now()): string[] {
  const flags: string[] = []
  if (!a.expires_at && a.origin !== 'observation') flags.push('No expiry time given by the source')
  if (!a.affected_area && !a.areas.length) flags.push('No affected area given')
  else if (!a.areas.some((x) => x.geometry.length)) flags.push('No boundary given; matching is by name only')
  if (!a.description && !a.instruction) flags.push('No description or instructions')
  if (!a.source_url) flags.push('No link to the original source')
  if (a.origin === 'official' && now - Date.parse(a.issued_at) > 7 * 24 * 3600 * 1000 && !a.expires_at) flags.push('Issued more than 7 days ago with no expiry; may be outdated')
  if (a.severity === 'emergency' && !a.instruction) flags.push('Emergency level but no protective-action text from the source')
  return flags
}

export const isLiveOrigin = (o: Origin) => o === 'official' || o === 'manual'
export const atLeast = (s: AlertRecord['severity'], min: AlertRecord['severity']) => severityRank(s) >= severityRank(min)
