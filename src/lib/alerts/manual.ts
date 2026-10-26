// Manually verified announcements written by an authorised administrator.
// They are stored as origin "manual" and always shown as "Announcement by VYRA administrators" - never as an
// official alert and never merged with imported ones. Imported alerts cannot be edited here: VYRA must not override
// the severity or instructions issued by an authority.

import { randomUUID } from 'node:crypto'
import { contentHash } from './ingest'
import { effectiveStatus, reviewFlagsFor } from './lifecycle'
import { notifySubscribers, type NotifyResult } from './notify'
import type { PushSender } from './push'
import type { AlertStore } from './store'
import type { AlertRecord, HazardType, Severity } from './types'

export const MANUAL_PROVIDER = 'vyra-admin'
const MAX_DAYS = 30

export interface AnnouncementInput {
  title: string
  description: string
  instruction?: string | null
  severity: Severity
  hazard_type: HazardType
  affected_area: string
  // Optional boundary. Without one the announcement is broadcast to all subscribers and says so.
  circle?: { lat: number; lng: number; radiusKm: number } | null
  source_url?: string | null
  expires_at: string
  notify?: boolean
  // The administrator must confirm they verified the information against an authoritative source.
  verified_confirmation: true
}

export class ManualError extends Error { constructor(message: string, public status = 400) { super(message) } }

export async function publishAnnouncement(store: AlertStore, input: AnnouncementInput, actor: string, sender: PushSender | null, now = Date.now()): Promise<{ alert: AlertRecord; notifications: NotifyResult | null }> {
  const expires = Date.parse(input.expires_at)
  if (expires <= now) throw new ManualError('The expiry time must be in the future.')
  if (expires - now > MAX_DAYS * 24 * 3600 * 1000) throw new ManualError(`Announcements can last at most ${MAX_DAYS} days; republish if it still applies.`)
  const iso = new Date(now).toISOString()
  const areas = [{ description: input.affected_area, geometry: input.circle ? [{ type: 'circle' as const, center: [input.circle.lat, input.circle.lng] as [number, number], radiusKm: input.circle.radiusKm }] : [], geocodes: [] }]
  const base = {
    provider: MANUAL_PROVIDER, external_alert_id: `manual-${randomUUID()}`, origin: 'manual' as const, hazard_type: input.hazard_type, severity: input.severity,
    status: 'active' as const, title: input.title, description: input.description, instruction: input.instruction || null, affected_area: input.affected_area, areas,
    source_url: input.source_url ?? null, source_name: 'VYRA administrators', issued_at: iso, starts_at: iso, expires_at: new Date(expires).toISOString(), last_updated_at: iso,
    source_severity: null, raw_source_metadata: { verifiedBy: actor }, limitations: input.circle ? [] : ['Published without a boundary: it is shown to everyone and may not apply to your location.'], created_by: actor,
  }
  const alert: AlertRecord = { ...base, id: randomUUID(), first_seen_at: iso, last_seen_at: iso, revision: 1, content_hash: contentHash(base), ai_summary: null, review_flags: reviewFlagsFor(base, now) }
  await store.saveAlert(alert)
  await store.addAudit({ actor, action: 'announcement_published', alert_id: alert.id, detail: `${alert.severity} ${alert.hazard_type}: ${alert.title}${input.notify ? ' (push requested)' : ''}` })
  const notifications = input.notify ? await notifySubscribers(store, alert, 'new', sender) : null
  return { alert, notifications }
}

export async function withdrawAnnouncement(store: AlertStore, id: string, actor: string, sender: PushSender | null, now = Date.now()): Promise<AlertRecord> {
  const a = await store.getAlert(id)
  if (!a) throw new ManualError('Alert not found.', 404)
  if (a.origin !== 'manual') throw new ManualError('Only announcements written in VYRA can be withdrawn here. Imported alerts follow their source.', 403)
  if (effectiveStatus(a, now) !== 'active') throw new ManualError('That announcement is no longer active.', 409)
  const saved = await store.saveAlert({ ...a, status: 'cancelled', last_updated_at: new Date(now).toISOString(), revision: a.revision + 1 })
  await store.addAudit({ actor, action: 'announcement_withdrawn', alert_id: id, detail: saved.title })
  await notifySubscribers(store, saved, 'cancel', sender) // only reaches people who were told about it before
  return saved
}
