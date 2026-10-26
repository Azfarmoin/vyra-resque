// Browser-side helpers: ask the server for a preview analysis, and turn chosen suggestions into form values.
// Pure functions where possible so they can be unit-tested.
import type { LocalAnalysis } from '../offline/types'
import { INCIDENT_TYPES, type IncidentType, type PhotoAnalysisResult, type Severity } from './schema'

export const WAITING_TEXT = 'Waiting for internet connection. The photo is saved on this device and has not been analysed yet.'

/** Calls the preview endpoint. Never throws: any failure becomes a 'failed'/'waiting' analysis the form can show. */
export async function previewAnalysis(blob: Blob, opts: { token?: string | null; force?: boolean; fetchImpl?: typeof fetch; online?: boolean; timeoutMs?: number } = {}): Promise<LocalAnalysis> {
  const base = { choice: 'none' as const, server_checked: false }
  if (opts.online === false) return { ...base, status: 'waiting', result: null, reason: WAITING_TEXT, at: null }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000)
  try {
    const res = await (opts.fetchImpl ?? fetch)('/api/photo-analysis/preview', {
      method: 'POST',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'X-Analysis-Consent': 'yes',
        ...(opts.force ? { 'X-Analysis-Force': 'yes' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: blob,
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string; analysis?: { analysis_status: string; result: PhotoAnalysisResult | null; failure_reason?: string | null; state?: string } }
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500
      return { ...base, status: transient ? 'waiting' : 'failed', result: null, reason: body.error || `The server answered ${res.status}.`, at: null }
    }
    const a = body.analysis
    if (a?.analysis_status === 'completed' && a.result) return { ...base, status: 'completed', result: a.result, reason: null, at: a.result.analyzed_at }
    return { ...base, status: a?.state === 'not_configured' ? 'not_configured' : 'failed', result: null, reason: a?.failure_reason || 'The analysis did not complete.', at: null }
  } catch {
    // No connection (or it dropped): the analysis did not happen, and we say so.
    return { ...base, status: 'waiting', result: null, reason: WAITING_TEXT, at: null }
  } finally {
    clearTimeout(timer)
  }
}

// --- from analysis to form fields -------------------------------------------------------------------

/** Which existing danger option each visible-evidence type can pre-select. Unmapped types add nothing. */
export const DANGER_FOR_INCIDENT: Partial<Record<IncidentType, string>> = {
  flooding: 'rising_water',
  fire: 'fire',
  smoke: 'other',
  building_collapse: 'building_collapse',
  building_damage: 'other',
  bridge_damage: 'other',
  road_blockage: 'blocked_road',
  debris: 'other',
  landslide: 'landslide',
  fallen_tree: 'other',
  storm_damage: 'other',
  infrastructure_damage: 'other',
  other_hazard: 'other',
}

const URGENCY_FOR: Partial<Record<Severity, string>> = { low: 'low', moderate: 'medium', high: 'high' }

export interface PhotoSuggestion {
  attachment_id: string
  label: string // "Photo 1"
  result: PhotoAnalysisResult
}

export interface Picked {
  /** incident types the reporter ticked, per photo id */
  types: Record<string, IncidentType[]>
  /** photos whose (possibly edited) text is included; text keyed by photo id */
  text: Record<string, string>
  urgency: boolean
}

export const defaultText = (r: PhotoAnalysisResult) => [r.suggested_report_title, r.suggested_description].filter(Boolean).join('\n')

export function defaultPick(items: PhotoSuggestion[]): Picked {
  const types: Picked['types'] = {}
  const text: Picked['text'] = {}
  for (const i of items) {
    types[i.attachment_id] = i.result.detected_incident_types.filter((t) => t in DANGER_FOR_INCIDENT)
    text[i.attachment_id] = defaultText(i.result)
  }
  return { types, text, urgency: true }
}

export interface FormFields {
  dangers: string[]
  dangerDetails: string
  urgency: string
}
export interface Applied {
  fields: FormFields
  /** what was added, so the form can label it as an AI suggestion until the reporter confirms or edits it */
  marks: { dangers: string[]; dangerDetails: boolean; urgency: boolean }
}

/**
 * Merges the chosen suggestions into the form WITHOUT overwriting anything typed:
 * dangers are only added, text is appended after what is there, and urgency is only set when empty.
 */
export function applySuggestions(current: FormFields, items: PhotoSuggestion[], picked: Picked, sourceLabel = true): Applied {
  const dangers = [...current.dangers]
  const addedDangers: string[] = []
  for (const i of items) {
    for (const t of picked.types[i.attachment_id] ?? []) {
      const d = DANGER_FOR_INCIDENT[t]
      if (d && !dangers.includes(d)) {
        dangers.push(d)
        addedDangers.push(d)
      }
    }
  }
  const blocks = items
    .map((i) => ({ label: i.label, t: (picked.text[i.attachment_id] ?? '').trim() }))
    .filter((b) => b.t)
    .map((b) => (sourceLabel && items.length > 1 ? `[${b.label}] ${b.t}` : b.t))
  let details = current.dangerDetails
  let detailsAdded = false
  if (blocks.length) {
    const add = blocks.join('\n')
    if (!details.includes(add)) {
      details = details.trim() ? `${details.trimEnd()}\n${add}` : add
      detailsAdded = true
    }
  }
  let urgency = current.urgency
  let urgencyAdded = false
  if (picked.urgency && !current.urgency) {
    const order: Severity[] = ['not_determined', 'low', 'moderate', 'high']
    const top = items.reduce<Severity>((m, i) => (order.indexOf(i.result.suggested_severity) > order.indexOf(m) ? i.result.suggested_severity : m), 'not_determined')
    const u = URGENCY_FOR[top]
    if (u) {
      urgency = u
      urgencyAdded = true
    }
  }
  return { fields: { dangers, dangerDetails: details.slice(0, 1000), urgency }, marks: { dangers: addedDangers, dangerDetails: detailsAdded, urgency: urgencyAdded } }
}

export const incidentLabel = (t: IncidentType) => INCIDENT_TYPES[t]
