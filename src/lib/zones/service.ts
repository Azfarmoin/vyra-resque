// Server-side zone logic shared by the API routes. Every write path goes through validateZoneInput +
// writeDenial, so the safety rules cannot be skipped by calling a different route.
import { getStore } from '../db'
import { HttpError } from '../reportService'
import { simplifyGeometry, toleranceForZoom, countVertices } from './geometry'
import {
  diffZone, displayState, freshnessOf, isPubliclyVisible, matchesSearch, matchesVerify, matchesView, needsReason, validateZoneInput, writeDenial, zoneBBox,
  VERIFY_FILTERS, ZONE_VIEWS, MAP_DISCLAIMER, type VerifyFilter, type ZoneView,
} from './rules'
import { suggestChanges, type Suggestion } from './evidence'
import { OPEN_STATUSES } from '../constants'
import type { ZoneCaller } from './auth'
import type { BBox, DisasterZone, DisplayState, FeedStatus, ZoneAuditEntry, ZoneInput } from './types'

export interface ZoneView_ extends DisasterZone {
  display_state: DisplayState
  freshness: ReturnType<typeof freshnessOf>
  simplified: boolean // geometry was lightened for drawing; the stored source geometry is unchanged
  vertex_count: number
}
export interface ZoneListResponse { zones: ZoneView_[]; feeds: FeedStatus[]; server_time: string; disclaimer: string; mode: 'supabase' | 'demo' }

const isStaff = (c: ZoneCaller) => c.role === 'responder' || c.role === 'admin'
const actorOf = (c: ZoneCaller) => (c.token ? { token: c.token } : undefined)

export interface ListOptions { bbox?: BBox | null; zoom?: number | null; view?: string; verify?: string; q?: string; includeHidden?: boolean; full?: boolean }

export async function listZones(caller: ZoneCaller, o: ListOptions = {}, now = Date.now()): Promise<ZoneListResponse> {
  const store = getStore()
  const staffHidden = !!o.includeHidden && isStaff(caller)
  const [rows, feeds] = await Promise.all([store.listZones({ bbox: o.bbox, includeHidden: staffHidden }), store.getFeedStatuses()])
  const view = (ZONE_VIEWS as readonly string[]).includes(o.view || '') ? (o.view as ZoneView) : 'all'
  const verify = (VERIFY_FILTERS as readonly string[]).includes(o.verify || '') ? (o.verify as VerifyFilter) : 'all'
  const feedBy = new Map(feeds.map((f) => [f.feed_id, f]))
  const tol = !o.full && o.zoom != null ? toleranceForZoom(o.zoom) : 0
  const zones = rows
    .filter((z) => staffHidden || isPubliclyVisible(z, now))
    .filter((z) => matchesView(z, view) && matchesVerify(z, verify) && matchesSearch(z, o.q || ''))
    .map((z): ZoneView_ => {
      const geometry = tol ? simplifyGeometry(z.geometry, tol) : z.geometry
      return { ...z, geometry, display_state: displayState(z, now), freshness: freshnessOf(z, z.feed_id ? feedBy.get(z.feed_id) : undefined, now), simplified: geometry !== z.geometry, vertex_count: countVertices(z.geometry) }
    })
  return { zones, feeds, server_time: new Date(now).toISOString(), disclaimer: MAP_DISCLAIMER, mode: store.mode }
}

export async function getZone(caller: ZoneCaller, id: string, now = Date.now()) {
  const z = await getStore().getZone(id)
  if (!z || (!isStaff(caller) && !isPubliclyVisible(z, now))) throw new HttpError(404, 'Zone not found')
  const feeds = z.feed_id ? await getStore().getFeedStatuses() : []
  return { ...z, display_state: displayState(z, now), freshness: freshnessOf(z, feeds.find((f) => f.feed_id === z.feed_id), now) }
}

function requireStaff(caller: ZoneCaller) {
  if (!caller.role) throw new HttpError(401, 'Sign in to manage zones.')
  if (!isStaff(caller)) throw new HttpError(403, 'Only responders and administrators can manage zones.')
}

async function checkRelated(v: ZoneInput) {
  const store = getStore()
  for (const id of v.related_report_ids) if (!(await store.getReport(id))) throw new HttpError(400, `Related emergency report ${id} was not found.`)
}

const CLIENT_FIELDS = ['name', 'zone_type', 'severity', 'hazard_type', 'geometry', 'boundary_kind', 'boundary_quality', 'radius_m', 'radius_basis', 'description', 'precautions', 'status_detail', 'evacuation_status', 'source_type', 'source_name', 'source_url', 'verification_status', 'lifecycle', 'valid_from', 'valid_until', 'related_report_ids', 'related_shelter_ids', 'related_road_ids', 'change_reason'] as const

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of CLIENT_FIELDS) if (k in body) out[k] = body[k]
  return out
}
function invalid(errors: string[]): never {
  throw new HttpError(400, errors.join(' '))
}

export async function createZone(caller: ZoneCaller, body: unknown, now = Date.now()) {
  requireStaff(caller)
  const v = validateZoneInput(pick((body ?? {}) as Record<string, unknown>), now)
  if (!v.ok || !v.value) invalid(v.errors)
  const input = v.value!
  const denied = writeDenial(caller.role, input)
  if (denied) throw new HttpError(403, denied)
  if (input.lifecycle === 'cancelled' || input.lifecycle === 'deactivated') throw new HttpError(400, 'A new zone must start as active or draft.')
  await checkRelated(input)
  const store = getStore()
  const zone = await store.insertZone(
    { ...input, bbox: zoneBBox(input), revision: 1, external_id: null, feed_id: null, source_updated_at: null, created_by: caller.id, created_by_name: caller.name ?? caller.email, updated_by: caller.email },
    actorOf(caller)
  )
  await store.addZoneAudit({ zone_id: zone.id, action: 'create', actor: caller.email ?? 'unknown', actor_role: caller.role, reason: input.change_reason, changes: {} })
  return zone
}

export type ZoneAction = 'update' | 'deactivate' | 'cancel' | 'reactivate'

export async function updateZone(caller: ZoneCaller, id: string, body: unknown, now = Date.now()) {
  requireStaff(caller)
  const b = (body ?? {}) as Record<string, unknown>
  const action = (['update', 'deactivate', 'cancel', 'reactivate'].includes(b.action as string) ? b.action : 'update') as ZoneAction
  const store = getStore()
  const existing = await store.getZone(id)
  if (!existing) throw new HttpError(404, 'Zone not found')
  if (b.revision != null && Number(b.revision) !== existing.revision) throw new HttpError(409, 'Someone else changed this zone. Reload it and try again.')

  const patch = pick(b)
  if (action === 'cancel') patch.lifecycle = 'cancelled'
  if (action === 'deactivate') patch.lifecycle = 'deactivated'
  if (action === 'reactivate') patch.lifecycle = 'active'

  const merged = { ...existing, ...patch }
  const v = validateZoneInput(merged, now)
  if (!v.ok || !v.value) invalid(v.errors)
  const next = v.value!
  const denied = writeDenial(caller.role, next, existing)
  if (denied) throw new HttpError(403, denied)

  const before = Object.fromEntries(CLIENT_FIELDS.filter((k) => k !== 'change_reason').map((k) => [k, existing[k]]))
  const after = Object.fromEntries(CLIENT_FIELDS.filter((k) => k !== 'change_reason').map((k) => [k, next[k]]))
  const changes = diffZone(before as Partial<DisasterZone>, after as Partial<DisasterZone>)
  if (!Object.keys(changes).length) throw new HttpError(400, 'Nothing changed.')
  const reason = typeof patch.change_reason === 'string' ? patch.change_reason.trim() : ''
  if (needsReason(changes) && reason.length < 5) throw new HttpError(400, 'Record a reason for this change (at least 5 characters).')
  if (next.related_report_ids.join() !== existing.related_report_ids.join()) await checkRelated(next)

  const zone = await store.updateZone(id, { ...next, bbox: zoneBBox(next), revision: existing.revision + 1, updated_by: caller.email, change_reason: reason || null }, actorOf(caller))
  await store.addZoneAudit({ zone_id: id, action: action === 'update' ? 'update' : action, actor: caller.email ?? 'unknown', actor_role: caller.role, reason: reason || null, changes })
  return zone
}

/** Only unpublished drafts (for example a rejected AI suggestion) can be deleted; published zones are cancelled so history stays. */
export async function deleteZone(caller: ZoneCaller, id: string) {
  requireStaff(caller)
  if (caller.role !== 'admin') throw new HttpError(403, 'Only an administrator can delete a zone.')
  const store = getStore()
  const z = await store.getZone(id)
  if (!z) throw new HttpError(404, 'Zone not found')
  if (z.lifecycle !== 'draft') throw new HttpError(409, 'Published zones are not deleted, so the history is kept. Cancel it instead and record the reason.')
  await store.addZoneAudit({ zone_id: id, action: 'delete', actor: caller.email ?? 'unknown', actor_role: caller.role, reason: 'Draft discarded', changes: {} })
  await store.deleteZone(id, actorOf(caller))
}

export async function zoneAudit(caller: ZoneCaller, id: string): Promise<ZoneAuditEntry[]> {
  requireStaff(caller)
  return getStore().listZoneAudit(id, actorOf(caller))
}

/**
 * Staff only. Looks at open reports and zones and returns SUGGESTED changes. With commit=true, suggestions that propose
 * a boundary are saved as private AI drafts (never public, never official) for a person to review; nothing existing changes.
 */
export async function suggestZones(caller: ZoneCaller, commit: boolean, now = Date.now()) {
  requireStaff(caller)
  const store = getStore()
  const [reports, zones] = await Promise.all([store.listReports({ statuses: OPEN_STATUSES }), store.listZones({ includeHidden: true })])
  const suggestions = suggestChanges(zones, reports.flatMap((r) => (r.location_lat != null && r.location_lng != null ? [{ id: r.id, lat: r.location_lat, lng: r.location_lng, verified: r.verified, created_at: r.created_at, status: r.status }] : [])), {}, now)
  const created: DisasterZone[] = []
  if (commit) {
    const have = new Set(zones.filter((z) => z.source_type === 'ai_suggestion' && z.lifecycle === 'draft').map((z) => [...z.related_report_ids].sort().join()))
    for (const s of suggestions as Suggestion[]) {
      const key = [...s.report_ids].sort().join()
      if (!s.geometry || have.has(key)) continue // review-only suggestions have no boundary; repeats are not re-created
      const target = s.zone_id ? zones.find((z) => z.id === s.zone_id) : null
      created.push(await createZone(caller, {
        name: s.title.slice(0, 120), zone_type: 'caution', severity: 'unknown', hazard_type: target?.hazard_type ?? 'other', geometry: s.geometry, boundary_kind: 'drawn', boundary_quality: 'approximate',
        description: `${s.basis}${target ? ` Suggested change to existing zone "${target.name}" (${target.id}).` : ''}`, source_type: 'ai_suggestion', source_name: 'VYRA report analysis', verification_status: 'ai_suggested',
        lifecycle: 'draft', related_report_ids: s.report_ids, change_reason: 'Generated from report analysis',
      }, now))
      have.add(key)
    }
  }
  return { suggestions, created }
}
