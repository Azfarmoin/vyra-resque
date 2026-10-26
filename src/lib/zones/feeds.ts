// Importing official warning boundaries from configured feeds (GeoJSON FeatureCollections).
//
// Rules this module enforces:
//  - repeated imports never create duplicates: a zone is keyed by (feed_id, external_id)
//  - a revised warning updates the same zone and keeps the history in the audit log
//  - warnings that disappear from a SUCCESSFUL feed response are expired; a failed fetch changes nothing
//    except the feed's status, so the last known data stays visible with its timestamp
//  - only features with valid geometry are imported; malformed ones are skipped and counted
import { geometryErrors } from './geometry'
import { validateZoneInput, zoneBBox, diffZone } from './rules'
import type { DisasterZone, FeedStatus, ZoneAuditEntry, ZoneGeometry, ZoneInput, ZoneType, HazardType, ZoneSeverity } from './types'

export interface FeedConfig {
  id: string // stable key, e.g. "pmd-flood"
  name: string // issuing authority, shown as the zone source
  url: string // GeoJSON endpoint
  homepage?: string
  default_zone_type?: Extract<ZoneType, 'danger' | 'elevated' | 'caution'> // feeds can not create evacuation orders or shelters
  default_hazard?: HazardType
  stale_after_minutes?: number
  // Property names in the provider's features.
  fields?: { id?: string; name?: string; description?: string; severity?: string; hazard?: string; from?: string; until?: string; url?: string; updated?: string; instruction?: string }
}

export interface FeedFeature { type: 'Feature'; geometry: unknown; properties?: Record<string, unknown> | null }
export interface ImportSummary { feed_id: string; ok: boolean; created: number; updated: number; unchanged: number; expired: number; skipped: { id: string | null; reason: string }[]; error?: string }

export interface ImportStore {
  listFeedZones(feedId: string): Promise<DisasterZone[]>
  insertZone(zone: Omit<DisasterZone, 'id' | 'created_at' | 'updated_at'>): Promise<DisasterZone>
  updateZone(id: string, patch: Partial<DisasterZone>): Promise<DisasterZone>
  addZoneAudit(entry: Omit<ZoneAuditEntry, 'id' | 'created_at'>): Promise<void>
  setFeedStatus(status: Partial<FeedStatus> & { feed_id: string }): Promise<void>
}

const SEVERITY_ALIASES: Record<string, ZoneSeverity> = {
  extreme: 'extreme', severe: 'high', high: 'high', red: 'extreme', orange: 'high', moderate: 'moderate', yellow: 'moderate', minor: 'low', low: 'low', green: 'low',
}
const HAZARD_ALIASES: [RegExp, HazardType][] = [[/flood|rain|river|tsunami|surge/i, 'flood'], [/fire|wildfire|burn/i, 'fire'], [/storm|cyclone|wind|hurricane|typhoon/i, 'storm'], [/landslide|mudslide/i, 'landslide'], [/quake|seismic/i, 'earthquake'], [/heat/i, 'heat'], [/chemical|gas|toxic/i, 'chemical']]

export function parseFeatureCollection(body: unknown): FeedFeature[] {
  const b = body as { type?: string; features?: unknown }
  if (!b || b.type !== 'FeatureCollection' || !Array.isArray(b.features)) throw new Error('Feed is not a GeoJSON FeatureCollection')
  return b.features as FeedFeature[]
}

const text = (props: Record<string, unknown>, key?: string) => (key && typeof props[key] === 'string' ? (props[key] as string).trim() : '')

/** Maps one provider feature to a zone. Returns a reason string when it can not be imported. */
export function featureToZone(feed: FeedConfig, f: FeedFeature, now = Date.now()): { externalId: string; input: ZoneInput; sourceUpdated: string | null; hasStart: boolean } | { externalId: string | null; reason: string } {
  const p = (f.properties ?? {}) as Record<string, unknown>
  const fl = feed.fields ?? {}
  const externalId = text(p, fl.id || 'id') || (typeof (f as unknown as { id?: unknown }).id === 'string' ? (f as unknown as { id: string }).id : '')
  if (!externalId) return { externalId: null, reason: 'feature has no id' }
  if (geometryErrors(f.geometry).length) return { externalId, reason: `invalid geometry: ${geometryErrors(f.geometry)[0]}` }
  const geometry = f.geometry as ZoneGeometry
  if (geometry.type === 'Point') return { externalId, reason: 'point features have no boundary; radius is not documented' }
  const sevRaw = text(p, fl.severity || 'severity').toLowerCase()
  const hazardRaw = text(p, fl.hazard || 'hazard') || text(p, 'event')
  const hazard = HAZARD_ALIASES.find(([re]) => re.test(hazardRaw))?.[1] ?? feed.default_hazard ?? 'other'
  const severity = SEVERITY_ALIASES[sevRaw] ?? 'unknown'
  const zone_type: ZoneType = feed.default_zone_type ?? (severity === 'extreme' || severity === 'high' ? 'danger' : severity === 'moderate' ? 'elevated' : 'caution')
  const input = {
    name: (text(p, fl.name || 'name') || text(p, 'headline') || `${hazardRaw || 'Warning'} (${externalId})`).slice(0, 120),
    zone_type, severity, hazard_type: hazard, geometry, boundary_kind: geometry.type === 'LineString' ? 'road' : 'administrative',
    boundary_quality: 'official', radius_m: null, radius_basis: null,
    description: text(p, fl.description || 'description') || `${feed.name} warning ${externalId}.`,
    precautions: text(p, fl.instruction || 'instruction') || null, status_detail: null, evacuation_status: null,
    source_type: 'official_feed', source_name: feed.name, source_url: text(p, fl.url || 'url') || feed.homepage || null,
    verification_status: 'official', lifecycle: 'active',
    valid_from: text(p, fl.from || 'effective') || text(p, 'onset') || null, valid_until: text(p, fl.until || 'expires') || null,
    related_report_ids: [], related_shelter_ids: [], related_road_ids: [], change_reason: null,
  }
  const v = validateZoneInput(input, now)
  if (!v.ok || !v.value) return { externalId, reason: v.errors[0] ?? 'invalid' }
  // Without a provider start time, validation stamps "now". Flag that so a refresh does not treat it as a revision.
  const hasStart = !!(text(p, fl.from || 'effective') || text(p, 'onset'))
  return { externalId, input: v.value, sourceUpdated: text(p, fl.updated || 'sent') || null, hasStart }
}

const COMPARE: (keyof DisasterZone)[] = ['name', 'zone_type', 'severity', 'hazard_type', 'geometry', 'description', 'precautions', 'source_url', 'valid_from', 'valid_until']

/**
 * Reconcile a successful feed response with stored zones. Pure given the store, so tests drive it with
 * the in-memory store. Call `markFeedFailure` instead when the fetch itself failed.
 */
export async function reconcileFeed(store: ImportStore, feed: FeedConfig, features: FeedFeature[], now = Date.now()): Promise<ImportSummary> {
  const summary: ImportSummary = { feed_id: feed.id, ok: true, created: 0, updated: 0, unchanged: 0, expired: 0, skipped: [] }
  const existing = new Map((await store.listFeedZones(feed.id)).map((z) => [z.external_id, z]))
  const seen = new Set<string>()
  const stamp = new Date(now).toISOString()
  const actor = `feed:${feed.id}`

  for (const f of features) {
    const m = featureToZone(feed, f, now)
    if ('reason' in m) { summary.skipped.push({ id: m.externalId, reason: m.reason }); continue }
    if (seen.has(m.externalId)) { summary.skipped.push({ id: m.externalId, reason: 'duplicate id in the same feed response' }); continue }
    seen.add(m.externalId)
    const prev = existing.get(m.externalId)
    const bbox = zoneBBox(m.input)
    if (!prev) {
      const z = await store.insertZone({ ...m.input, bbox, revision: 1, external_id: m.externalId, feed_id: feed.id, source_updated_at: m.sourceUpdated, created_by: null, created_by_name: feed.name, updated_by: actor })
      await store.addZoneAudit({ zone_id: z.id, action: 'import', actor, actor_role: 'feed', reason: `First import from ${feed.name}`, changes: {} })
      summary.created++
      continue
    }
    // A person may have cancelled / deactivated an imported zone on purpose; a refresh must not silently re-open it.
    const next: Partial<DisasterZone> = { ...m.input, valid_from: m.hasStart ? m.input.valid_from : prev.valid_from, lifecycle: prev.lifecycle === 'cancelled' || prev.lifecycle === 'deactivated' ? prev.lifecycle : 'active' }
    const changes = diffZone(Object.fromEntries(COMPARE.map((k) => [k, prev[k]])), Object.fromEntries(COMPARE.map((k) => [k, next[k]])))
    if (prev.lifecycle === 'active' && !Object.keys(changes).length) { summary.unchanged++; continue }
    if (!Object.keys(changes).length) { summary.unchanged++; continue }
    await store.updateZone(prev.id, { ...next, bbox, revision: prev.revision + 1, source_updated_at: m.sourceUpdated, updated_by: actor, change_reason: `Warning revised by ${feed.name}` })
    await store.addZoneAudit({ zone_id: prev.id, action: 'import_update', actor, actor_role: 'feed', reason: `Warning revised by ${feed.name}`, changes })
    summary.updated++
  }

  // Warnings the source no longer lists (in a response that DID succeed) are no longer in effect.
  for (const [extId, z] of existing) {
    if (seen.has(extId ?? '') || z.lifecycle !== 'active') continue
    await store.updateZone(z.id, { lifecycle: 'deactivated', updated_by: actor, revision: z.revision + 1, change_reason: `No longer listed by ${feed.name}` })
    await store.addZoneAudit({ zone_id: z.id, action: 'expire', actor, actor_role: 'feed', reason: `No longer listed by ${feed.name}`, changes: { lifecycle: { from: 'active', to: 'deactivated' } } })
    summary.expired++
  }
  await store.setFeedStatus({ feed_id: feed.id, name: feed.name, last_attempt_at: stamp, last_success_at: stamp, last_error: null, zones_seen: seen.size, stale_after_minutes: feed.stale_after_minutes ?? 120 })
  return summary
}

/** The fetch failed: keep every zone exactly as it was and only record the failure. */
export async function markFeedFailure(store: ImportStore, feed: FeedConfig, error: string, now = Date.now()): Promise<ImportSummary> {
  await store.setFeedStatus({ feed_id: feed.id, name: feed.name, last_attempt_at: new Date(now).toISOString(), last_error: error.slice(0, 300), stale_after_minutes: feed.stale_after_minutes ?? 120 })
  return { feed_id: feed.id, ok: false, created: 0, updated: 0, unchanged: 0, expired: 0, skipped: [], error }
}

/** ZONE_FEEDS is a JSON array of FeedConfig in the server environment. Bad config is ignored loudly, never fatal. */
export function loadFeedConfigs(raw = process.env.ZONE_FEEDS): FeedConfig[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as FeedConfig[]
    return Array.isArray(list) ? list.filter((f) => f && typeof f.id === 'string' && /^[a-z0-9-]{2,40}$/.test(f.id) && typeof f.name === 'string' && /^https:\/\//.test(f.url)) : []
  } catch {
    console.error('ZONE_FEEDS is not valid JSON; no feeds will be imported')
    return []
  }
}

export async function importFeed(store: ImportStore, feed: FeedConfig, fetchImpl: typeof fetch = fetch): Promise<ImportSummary> {
  let features: FeedFeature[]
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    const res = await fetchImpl(feed.url, { headers: { accept: 'application/geo+json, application/json' }, signal: ctl.signal, cache: 'no-store' }).finally(() => clearTimeout(t))
    if (!res.ok) throw new Error(`Feed answered ${res.status}`)
    features = parseFeatureCollection(await res.json())
  } catch (err) {
    return markFeedFailure(store, feed, err instanceof Error ? err.message : 'Feed fetch failed')
  }
  return reconcileFeed(store, feed, features)
}
