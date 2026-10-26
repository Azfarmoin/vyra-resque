import { createClient, type SupabaseClient } from '@supabase/supabase-js'
<<<<<<< HEAD
import type { DataStore, ReportFilter, ZoneActor } from './store'
import { StoreError } from './store'
import type { AnalysisRow } from '../photoAnalysis/schema'
import type { AttachmentRow, ReportRow } from '../types'

export const ATTACHMENT_BUCKET = 'report-attachments'
import type { DisasterZone, FeedStatus, ZoneAuditEntry } from '../zones/types'
import type { SafetyRevision, SafetyRow } from '../safety/admin'
=======
import type { DataStore, ReportFilter } from './store'
import { StoreError } from './store'
import type { ReportRow } from '../types'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

const REPORT_NUMERIC = ['location_lat', 'location_lng', 'location_accuracy_m'] as const

// Postgres NUMERIC comes back as a string from PostgREST - normalise to numbers.
function normalise<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const out: Record<string, unknown> = { ...row }
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}
const toReport = (r: Record<string, unknown>) => normalise(r, REPORT_NUMERIC) as unknown as ReportRow

function fail(error: { message: string; code?: string } | null, what: string): never {
  const hint = error?.code === '42703' || error?.code === 'PGRST204' ? ' - did you run supabase/migrations/002_stage4_6.sql?' : ''
  throw new StoreError(`${what}: ${error?.message}${hint}`)
}

<<<<<<< HEAD
// ---- disaster_zones row <-> DisasterZone ---------------------------------------------------------------
// Geometry is stored as validated GeoJSON (JSONB) plus four bbox columns with a btree index, so the map can
// ask for "zones in this viewport" without PostGIS. (If PostGIS is installed, migration 006 also adds a GIST-indexed column.)
const ZONE_VIRTUAL = ['bbox']
function toZone(r: Record<string, unknown>): DisasterZone {
  const { bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, updated_by_label, geom, ...rest } = r as Record<string, unknown>
  void geom
  return {
    ...(rest as unknown as DisasterZone),
    radius_m: rest.radius_m == null ? null : Number(rest.radius_m),
    related_report_ids: (rest.related_report_ids as string[]) ?? [],
    related_shelter_ids: (rest.related_shelter_ids as string[]) ?? [],
    related_road_ids: (rest.related_road_ids as string[]) ?? [],
    bbox: [Number(bbox_min_lng), Number(bbox_min_lat), Number(bbox_max_lng), Number(bbox_max_lat)],
    created_by_name: (rest.created_by_name as string | null) ?? null,
    updated_by: (updated_by_label as string | null) ?? ((rest.updated_by as string | null) ?? null),
  }
}
function fromZone(z: Partial<DisasterZone>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...z }
  for (const k of ZONE_VIRTUAL) delete out[k]
  if (z.bbox) [out.bbox_min_lng, out.bbox_min_lat, out.bbox_max_lng, out.bbox_max_lat] = z.bbox
  // created_by / updated_by are uuid columns filled by the database from auth.uid(); the label columns carry feed / service names.
  if ('updated_by' in out) { out.updated_by_label = out.updated_by; delete out.updated_by }
  if ('created_by' in out) delete out.created_by
  delete out.created_at; delete out.updated_at; delete out.id
  return out
}

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
export function createSupabaseStore(): DataStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const db: SupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
    // Next.js 14 caches fetch() in route handlers (even across restarts, in .next/cache).
    // Emergency data must always be live, so opt every Supabase request out of that cache.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  })

<<<<<<< HEAD
  // Photos live in a PRIVATE bucket. Uploads work with the publishable key (insert-only storage policy,
  // migration 006). Reading them back needs SUPABASE_SERVICE_ROLE_KEY, which exists only on the server
  // and is never sent to the browser.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const files: SupabaseClient = serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, n) => fetch(i, { ...n, cache: 'no-store' }) } })
    : db

  // Zone writes run as the signed-in user (RLS + audit trigger see who they are) or, for server-side feed
  // imports only, with the service-role key. The service key never leaves the server.
  const zoneClient = (actor?: ZoneActor): SupabaseClient => {
    if (actor?.service) {
      const sk = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!sk) throw new StoreError('Feed import needs SUPABASE_SERVICE_ROLE_KEY on the server', 503)
      return createClient(url, sk, { auth: { persistSession: false, autoRefreshToken: false } })
    }
    if (actor?.token) {
      return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${actor.token}` }, fetch: (i, init) => fetch(i, { ...init, cache: 'no-store' }) } })
    }
    return db
  }
  const zoneFail = (error: { message: string; code?: string } | null, what: string): never => {
    if (error?.code === '42501') throw new StoreError('You are not allowed to do that to this zone.', 403)
    if (error?.code === 'P0001' || error?.code === '23514') throw new StoreError(error.message, 400)
    if (error?.code === '23505') throw new StoreError('duplicate feed zone', 409)
    if (error?.code === '42P01') throw new StoreError(`${what}: disaster_zones is missing - run supabase/migrations/010_disaster_zones.sql`, 503)
    return fail(error, what)
  }

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  return {
    mode: 'supabase',

    async insertReport(report) {
      const { data, error } = await db.from('emergency_reports').insert(report).select().single()
      if (error) {
        if (error.code === '23505') throw new StoreError('duplicate client_id', 409)
        fail(error, 'Could not save report')
      }
      return toReport(data)
    },

    async findReportByClientId(clientId) {
      const { data, error } = await db.from('emergency_reports').select('*').eq('client_id', clientId).maybeSingle()
      if (error) fail(error, 'Lookup failed')
      return data ? toReport(data) : null
    },

    async getReport(id) {
      const { data, error } = await db.from('emergency_reports').select('*').eq('id', id).maybeSingle()
      if (error) {
        if (error.code === '22P02') return null // not a uuid
        fail(error, 'Could not load report')
      }
      return data ? toReport(data) : null
    },

    async listReports(filter: ReportFilter) {
      let q = db.from('emergency_reports').select('*').order('created_at', { ascending: false }).limit(2000)
      if (filter.area) q = q.eq('area', filter.area)
      if (filter.statuses?.length) q = q.in('status', filter.statuses)
      if (filter.verified != null) q = q.eq('verified', filter.verified)
      if (filter.bbox) {
        const [minLng, minLat, maxLng, maxLat] = filter.bbox
        q = q.gte('location_lng', minLng).lte('location_lng', maxLng).gte('location_lat', minLat).lte('location_lat', maxLat)
      }
      const { data, error } = await q
      if (error) fail(error, 'Could not load reports')
      return (data || []).map(toReport)
    },

    async updateReport(id, patch) {
      const { data, error } = await db.from('emergency_reports').update(patch).eq('id', id).select().single()
      if (error) fail(error, 'Could not update report')
      return toReport(data)
    },

    async addEvent(event) {
      const { error } = await db.from('report_events').insert(event)
      if (error) fail(error, 'Could not record history')
    },

    async listEvents(reportId) {
      const { data, error } = await db.from('report_events').select('*').eq('report_id', reportId).order('created_at')
      if (error) fail(error, 'Could not load history')
      return data || []
    },

<<<<<<< HEAD
    async findAttachment(reportId, clientId) {
      const { data, error } = await files.from('report_attachments').select('*').eq('report_id', reportId).eq('client_id', clientId).maybeSingle()
      if (error) fail(error, 'Attachment lookup failed')
      return (data as AttachmentRow | null) ?? null
    },

    async listAttachments(reportId) {
      const { data, error } = await files.from('report_attachments').select('*').eq('report_id', reportId).order('created_at')
      if (error) fail(error, 'Could not load attachments')
      return (data as AttachmentRow[]) || []
    },

    async saveAttachment({ report_id, client_id, mime_type, bytes }) {
      const ext = mime_type === 'image/png' ? 'png' : mime_type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${report_id}/${client_id}.${ext}`
      // No upsert: the bucket policy only allows INSERT. If a previous attempt stored the file but
      // crashed before saving metadata, the object already exists, which is fine.
      const up = await files.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: mime_type, upsert: false })
      if (up.error && !/exists|duplicate|already/i.test(up.error.message)) fail(up.error, 'Could not store the photo')
      const { data, error } = await files
        .from('report_attachments')
        .insert({ report_id, client_id, storage_path: path, mime_type, size_bytes: bytes.byteLength })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') {
          const { data: existing } = await files.from('report_attachments').select('*').eq('report_id', report_id).eq('client_id', client_id).maybeSingle()
          if (existing) return existing as AttachmentRow
        }
        fail(error, 'Could not save photo details')
      }
      return data as AttachmentRow
    },

    async readAttachment(row) {
      const { data, error } = await files.storage.from(ATTACHMENT_BUCKET).download(row.storage_path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    },

    // Analysis rows are only reachable with the server's service-role key (no public RLS policy on the table).
    async getAnalysis(attachmentId) {
      const { data, error } = await files.from('attachment_analyses').select('*').eq('attachment_id', attachmentId).maybeSingle()
      if (error) fail(error, 'Could not load the photo analysis (did you run migration 013 and set SUPABASE_SERVICE_ROLE_KEY?)')
      return (data as AnalysisRow | null) ?? null
    },

    async listAnalyses(reportId) {
      const { data, error } = await files.from('attachment_analyses').select('*').eq('report_id', reportId).order('created_at')
      if (error) fail(error, 'Could not load photo analyses (did you run migration 013 and set SUPABASE_SERVICE_ROLE_KEY?)')
      return (data as AnalysisRow[]) || []
    },

    async saveAnalysis(input) {
      const { data, error } = await files
        .from('attachment_analyses')
        .upsert({ ...input, updated_at: new Date().toISOString() }, { onConflict: 'attachment_id' })
        .select()
        .single()
      if (error) fail(error, 'Could not save the photo analysis (did you run migration 013 and set SUPABASE_SERVICE_ROLE_KEY?)')
      return data as AnalysisRow
    },

=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    async mapLayers(area) {
      const withArea = <T extends { eq: (c: string, v: string) => T }>(q: T) => (area ? q.eq('area', area) : q)
      const [s, t, r] = await Promise.all([
        withArea(db.from('shelters').select('*').eq('verified', true)),
        withArea(db.from('rescue_teams').select('*').eq('verified', true).neq('status', 'unavailable')),
        withArea(db.from('blocked_roads').select('*').eq('verified', true)),
      ])
      for (const res of [s, t, r]) if (res.error) fail(res.error, 'Could not load map layers')
      return {
        shelters: (s.data || []).map((x) => normalise(x, ['location_lat', 'location_lng'])),
        teams: (t.data || []).map((x) => normalise(x, ['current_location_lat', 'current_location_lng'])),
        roadBlocks: r.data || [],
      }
    },
<<<<<<< HEAD

    async listBlockedRoads() {
      const { data, error } = await db.from('blocked_roads').select('*')
      if (error) fail(error, 'Could not load blocked roads')
      return data || []
    },

    async listZones(opts = {}) {
      let q = db.from('disaster_zones').select('*').order('updated_at', { ascending: false }).limit(3000)
      if (!opts.includeHidden) q = q.neq('verification_status', 'ai_suggested').neq('lifecycle', 'draft')
      if (opts.bbox) {
        const [minLng, minLat, maxLng, maxLat] = opts.bbox
        q = q.lte('bbox_min_lng', maxLng).gte('bbox_max_lng', minLng).lte('bbox_min_lat', maxLat).gte('bbox_max_lat', minLat)
      }
      const { data, error } = await q
      if (error) zoneFail(error, 'Could not load zones')
      return (data || []).map(toZone)
    },

    async getZone(id) {
      const { data, error } = await db.from('disaster_zones').select('*').eq('id', id).maybeSingle()
      if (error) {
        if (error.code === '22P02') return null
        zoneFail(error, 'Could not load zone')
      }
      return data ? toZone(data) : null
    },

    async insertZone(zone, actor) {
      const { data, error } = await zoneClient(actor).from('disaster_zones').insert(fromZone(zone)).select().single()
      if (error) zoneFail(error, 'Could not save zone')
      return toZone(data)
    },

    async updateZone(id, patch, actor) {
      const { data, error } = await zoneClient(actor).from('disaster_zones').update(fromZone(patch)).eq('id', id).select().maybeSingle()
      if (error) zoneFail(error, 'Could not update zone')
      if (!data) throw new StoreError('Zone not found, or you are not allowed to change it.', 404)
      return toZone(data)
    },

    async listSafetyContent(opts = {}) {
      let q = db.from('safety_content').select('*')
      if (opts.publishedOnly) q = q.eq('status', 'published')
      const { data, error } = await q
      if (error) {
        if (error.code === '42P01') return [] // migration 015 not applied yet: the bundled guides are used
        zoneFail(error, 'Could not load safety content')
      }
      return (data || []) as SafetyRow[]
    },

    async saveSafetyContent(row, actor) {
      const { updated_by, ...rest } = row
      const { data, error } = await zoneClient(actor).from('safety_content').upsert({ ...rest, updated_by_label: updated_by }, { onConflict: 'hazard_id' }).select().single()
      if (error) zoneFail(error, 'Could not save safety content')
      return data as SafetyRow
    },

    async listSafetyRevisions(hazardId, actor) {
      const { data, error } = await zoneClient(actor).from('safety_content_revisions').select('*').eq('hazard_id', hazardId).order('created_at', { ascending: false }).limit(100)
      if (error) zoneFail(error, 'Could not load revisions')
      return (data || []) as SafetyRevision[]
    },

    async deleteZone(id, actor) {
      const { data, error } = await zoneClient(actor).from('disaster_zones').delete().eq('id', id).select('id')
      if (error) zoneFail(error, 'Could not delete zone')
      if (!data?.length) throw new StoreError('Zone not found, or only unpublished drafts can be deleted.', 404)
    },

    async listFeedZones(feedId) {
      const { data, error } = await zoneClient({ service: true }).from('disaster_zones').select('*').eq('feed_id', feedId)
      if (error) zoneFail(error, 'Could not load feed zones')
      return (data || []).map(toZone)
    },

    async listZoneAudit(zoneId, actor) {
      const { data, error } = await zoneClient(actor).from('zone_audit_log').select('*').eq('zone_id', zoneId).order('created_at', { ascending: false }).limit(200)
      if (error) zoneFail(error, 'Could not load zone history')
      return (data || []) as ZoneAuditEntry[]
    },

    async addZoneAudit() {
      /* recorded by the zone_audit trigger inside the database */
    },

    async getFeedStatuses() {
      const { data, error } = await db.from('zone_feed_status').select('*')
      if (error) {
        if (error.code === '42P01') return []
        zoneFail(error, 'Could not load feed status')
      }
      return (data || []) as FeedStatus[]
    },

    async setFeedStatus(status) {
      const { error } = await zoneClient({ service: true }).from('zone_feed_status').upsert(status, { onConflict: 'feed_id' })
      if (error) zoneFail(error, 'Could not record feed status')
    },
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  }
}
