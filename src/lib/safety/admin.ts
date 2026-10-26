// Administrator-managed safety content: validation and state rules (pure). Ordinary users and AI output can never publish.
import { lintGuide } from './lint'
import { HAZARD_IDS, type HazardGuide, type HazardId } from './types'

export type ContentStatus = 'draft' | 'published' | 'retired'
export interface SafetyRow {
  hazard_id: HazardId
  content: HazardGuide
  status: ContentStatus
  revision: number
  reviewed_by: string | null
  reviewed_on: string | null // YYYY-MM-DD
  change_reason: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  published_at: string | null
}
export interface SafetyRevision { id: string; hazard_id: HazardId; revision: number; status: ContentStatus; content: HazardGuide; reviewed_by: string | null; reviewed_on: string | null; change_reason: string | null; actor: string | null; created_at: string }
export type SafetyAction = 'save_draft' | 'publish' | 'retire'
export interface SafetySave { hazard_id: HazardId; action: SafetyAction; content?: HazardGuide; reviewed_by?: string; reviewed_on?: string; change_reason?: string }

export function validateSafetySave(raw: unknown, now = Date.now()): { ok: true; value: SafetySave } | { ok: false; errors: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>
  const errors: string[] = []
  const hazard_id = r.hazard_id as HazardId
  if (!(HAZARD_IDS as readonly string[]).includes(hazard_id)) errors.push('Unknown hazard category.')
  const action = r.action as SafetyAction
  if (!['save_draft', 'publish', 'retire'].includes(action)) errors.push('Unknown action.')
  const reason = typeof r.change_reason === 'string' ? r.change_reason.trim() : ''
  if (reason.length < 5) errors.push('Record a reason for this change (at least 5 characters).')
  let content: HazardGuide | undefined
  if (action !== 'retire') {
    content = r.content as HazardGuide
    if (!content || typeof content !== 'object') errors.push('Guide content is missing.')
    else if (content.id !== hazard_id) errors.push('The guide id must match the selected category.')
    else errors.push(...lintGuide(content, now))
  }
  let reviewed_by: string | undefined, reviewed_on: string | undefined
  if (action === 'publish') {
    reviewed_by = typeof r.reviewed_by === 'string' ? r.reviewed_by.trim() : ''
    reviewed_on = typeof r.reviewed_on === 'string' ? r.reviewed_on.trim() : ''
    if (reviewed_by.length < 3) errors.push('Publishing needs the name of the person or organisation that reviewed this guide.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewed_on) || Number.isNaN(Date.parse(reviewed_on))) errors.push('Publishing needs the review date (YYYY-MM-DD).')
    else if (Date.parse(reviewed_on) > now + 86_400_000) errors.push('The review date cannot be in the future.')
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { hazard_id, action, content, reviewed_by, reviewed_on, change_reason: reason } }
}

/** What the public receives: the published guide with the review record stamped on it. */
export function toPublished(row: SafetyRow): { hazard_id: string; content: HazardGuide; revision: number; published_at: string } | null {
  if (row.status !== 'published' || !row.reviewed_by || !row.reviewed_on) return null
  return { hazard_id: row.hazard_id, content: { ...row.content, expert_reviewed: { by: row.reviewed_by, on: row.reviewed_on } }, revision: row.revision, published_at: row.published_at ?? row.updated_at }
}
