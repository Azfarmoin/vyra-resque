import { randomUUID } from 'node:crypto'
import type { DataStore } from './store'
import { StoreError } from './store'
<<<<<<< HEAD
import type { AnalysisRow } from '../photoAnalysis/schema'
import type { AttachmentRow, ReportEvent, ReportRow, RescueTeam, Shelter } from '../types'
import { nearestArea } from '../constants'
import { demoReports, demoRoadBlocks as smallRoadBlocks } from './demoSeed'
import { largeDemoDataset, useLargeDemoDataset } from './largeSeed'
import type { BlockedRoad } from '../types'
import { demoFeedStatuses, demoZones } from './demoZones'
import { bboxIntersects } from '../zones/geometry'
import type { DisasterZone, FeedStatus, ZoneAuditEntry } from '../zones/types'
import type { SafetyRevision, SafetyRow } from '../safety/admin'
=======
import type { ReportEvent, ReportRow } from '../types'
import { demoReports, demoShelters, demoTeams, demoRoadBlocks } from './demoSeed'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

// In-memory store for demos without Supabase (data resets when the server restarts).
export function createMemoryStore({ seed = true } = {}): DataStore {
  const reports = new Map<string, ReportRow>()
  const events: ReportEvent[] = []
<<<<<<< HEAD
  const attachments = new Map<string, { row: AttachmentRow; bytes: Uint8Array }>()
  const analyses = new Map<string, AnalysisRow>()
  const clone = <T,>(x: T): T => structuredClone(x)
  const safety = new Map<string, SafetyRow>()
  const safetyRevs: SafetyRevision[] = []
  const zones = new Map<string, DisasterZone>()
  const zoneAudit: ZoneAuditEntry[] = []
  const feeds = new Map<string, FeedStatus>()
  if (seed) {
    for (const z of demoZones()) {
      zones.set(z.id, z)
      zoneAudit.push({ id: randomUUID(), zone_id: z.id, action: 'create', actor: 'seed', actor_role: null, reason: 'Simulated demo zone', changes: {}, created_at: z.created_at })
    }
    for (const f of demoFeedStatuses()) feeds.set(f.feed_id, f)
  }

  // VYRA_DEMO_DATASET=large swaps the small demo data for the very large simulated dataset (largeSeed.ts).
  const large = seed && useLargeDemoDataset() ? largeDemoDataset() : null
  const demoRoadBlocks: BlockedRoad[] = large ? (large.blocked_roads as unknown as BlockedRoad[]) : smallRoadBlocks
  if (large) {
    for (const r of large.reports as unknown as ReportRow[]) reports.set(r.id, r)
    for (const e of large.report_events) events.push({ id: randomUUID(), ...(e as object) } as unknown as ReportEvent)
  } else if (seed) {
    for (const r of demoReports()) {
      reports.set(r.id, r)
      events.push({ id: randomUUID(), report_id: r.id, action: 'created', actor: 'seed', from_value: null, to_value: null, note: 'Simulated demo report', created_at: r.created_at })
      const at = (min: number) => new Date(Date.parse(r.created_at) + min * 60_000).toISOString()
      if (r.verified) events.push({ id: randomUUID(), report_id: r.id, action: 'verify', actor: 'Dispatcher (demo)', from_value: 'false', to_value: 'true', note: null, created_at: at(4) })
      if (r.status !== 'pending') events.push({ id: randomUUID(), report_id: r.id, action: 'status', actor: 'Dispatcher (demo)', from_value: 'pending', to_value: r.status, note: null, created_at: r.resolved_at && r.status === 'resolved' ? r.resolved_at : at(8) })
=======
  const clone = <T,>(x: T): T => structuredClone(x)

  if (seed) {
    for (const r of demoReports()) {
      reports.set(r.id, r)
      events.push({ id: randomUUID(), report_id: r.id, action: 'created', actor: 'seed', from_value: null, to_value: null, note: 'Simulated demo report', created_at: r.created_at })
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
    }
  }

  return {
    mode: 'demo',

    async insertReport(report) {
      if (report.client_id && [...reports.values()].some((r) => r.client_id === report.client_id)) {
        throw new StoreError('duplicate client_id', 409)
      }
      const now = new Date().toISOString()
      const row: ReportRow = { ...clone(report), id: randomUUID(), created_at: now, updated_at: now }
      reports.set(row.id, row)
      return clone(row)
    },

    async findReportByClientId(clientId) {
      const r = [...reports.values()].find((x) => x.client_id === clientId)
      return r ? clone(r) : null
    },

    async getReport(id) {
      const r = reports.get(id)
      return r ? clone(r) : null
    },

    async listReports(filter) {
      return [...reports.values()]
        .filter((r) => !filter.area || r.area === filter.area)
        .filter((r) => !filter.statuses?.length || filter.statuses.includes(r.status))
        .filter((r) => filter.verified == null || r.verified === filter.verified)
        .filter((r) => {
          if (!filter.bbox) return true
          const [minLng, minLat, maxLng, maxLat] = filter.bbox
<<<<<<< HEAD
          return r.location_lng != null && r.location_lat != null && r.location_lng >= minLng && r.location_lng <= maxLng && r.location_lat >= minLat && r.location_lat <= maxLat
=======
          return r.location_lng >= minLng && r.location_lng <= maxLng && r.location_lat >= minLat && r.location_lat <= maxLat
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(clone)
    },

    async updateReport(id, patch) {
      const r = reports.get(id)
      if (!r) throw new StoreError('Report not found', 404)
      const updated = { ...r, ...clone(patch), id, updated_at: new Date().toISOString() }
      reports.set(id, updated)
      return clone(updated)
    },

    async addEvent(event) {
      events.push({ ...clone(event), id: randomUUID(), created_at: new Date().toISOString() })
    },

    async listEvents(reportId) {
      return events.filter((e) => e.report_id === reportId).map(clone)
    },

<<<<<<< HEAD
    async findAttachment(reportId, clientId) {
      return [...attachments.values()].find((a) => a.row.report_id === reportId && a.row.client_id === clientId)?.row ?? null
    },

    async listAttachments(reportId) {
      return [...attachments.values()].filter((a) => a.row.report_id === reportId).map((a) => clone(a.row))
    },

    async saveAttachment({ report_id, client_id, mime_type, bytes }) {
      const existing = [...attachments.values()].find((a) => a.row.report_id === report_id && a.row.client_id === client_id)
      if (existing) return clone(existing.row)
      const id = randomUUID()
      const row = { id, report_id, client_id, storage_path: `${report_id}/${client_id}`, mime_type, size_bytes: bytes.byteLength, created_at: new Date().toISOString() }
      attachments.set(id, { row, bytes: Uint8Array.from(bytes) })
      return clone(row)
    },

    async readAttachment(row) {
      return attachments.get(row.id)?.bytes ?? null
    },

    async getAnalysis(attachmentId) {
      const a = analyses.get(attachmentId)
      return a ? clone(a) : null
    },

    async listAnalyses(reportId) {
      return [...analyses.values()].filter((a) => a.report_id === reportId).sort((x, y) => x.created_at.localeCompare(y.created_at)).map(clone)
    },

    async saveAnalysis(input) {
      const now = new Date().toISOString()
      const prev = analyses.get(input.attachment_id)
      const row: AnalysisRow = {
        id: prev?.id ?? randomUUID(),
        uploader_id: null,
        analysis_status: 'pending',
        result: null,
        consent_at: null,
        model_provider: null,
        model_version: null,
        analyzed_at: null,
        failure_reason: null,
        review_status: 'unreviewed',
        reviewed_by: null,
        reviewed_at: null,
        review_note: null,
        user_action: 'none',
        attempts: 0,
        created_at: prev?.created_at ?? now,
        ...prev,
        ...input,
        updated_at: now,
      }
      analyses.set(input.attachment_id, row)
      return clone(row)
    },

    async mapLayers(area) {
      // Teams and shelters come from the same demo tables the supplies page edits, so changes show on the map.
      const { demoTables } = await import('../demoDb')
      const t = await demoTables()
      const placed = (lat: unknown, lng: unknown) => typeof lat === 'number' && typeof lng === 'number'
      const teams: RescueTeam[] = t.rescue_teams
        .filter((x) => placed(x.current_location_lat, x.current_location_lng) && x.status !== 'unavailable')
        .map((x) => ({
          id: x.id, team_name: x.team_name, team_type: (x.capabilities?.[0] as string) ?? null, capabilities: x.capabilities ?? [],
          current_location_lat: x.current_location_lat, current_location_lng: x.current_location_lng,
          area: nearestArea(x.current_location_lat, x.current_location_lng), status: x.status, verified: true,
        }))
      const shelters: Shelter[] = t.shelters
        .filter((x) => placed(x.location_lat, x.location_lng))
        .map((x) => ({
          id: x.id, name: x.name, location_lat: x.location_lat, location_lng: x.location_lng, address: x.address ?? null,
          area: x.area ?? nearestArea(x.location_lat, x.location_lng), capacity: x.capacity ?? null, current_occupancy: x.current_occupancy ?? 0,
          services: x.services ?? [], status: x.status, verified: x.verified !== false,
        }))
      const inArea = <T extends { area: string | null; verified: boolean }>(x: T) => x.verified && (!area || x.area === area)
      return {
        shelters: shelters.filter(inArea),
        teams: teams.filter(inArea),
        roadBlocks: demoRoadBlocks.filter(inArea).map(clone),
      }
    },

    async listBlockedRoads() {
      return demoRoadBlocks.map(clone)
    },

    async listZones(opts = {}) {
      return [...zones.values()]
        .filter((z) => opts.includeHidden || (z.verification_status !== 'ai_suggested' && z.lifecycle !== 'draft'))
        .filter((z) => !opts.bbox || bboxIntersects(z.bbox, opts.bbox))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(clone)
    },

    async getZone(id) {
      const z = zones.get(id)
      return z ? clone(z) : null
    },

    async insertZone(zone) {
      if (zone.feed_id && zone.external_id && [...zones.values()].some((z) => z.feed_id === zone.feed_id && z.external_id === zone.external_id)) {
        throw new StoreError('duplicate feed zone', 409)
      }
      const now = new Date().toISOString()
      const row: DisasterZone = { ...clone(zone), id: randomUUID(), created_at: now, updated_at: now }
      zones.set(row.id, row)
      return clone(row)
    },

    async updateZone(id, patch) {
      const z = zones.get(id)
      if (!z) throw new StoreError('Zone not found', 404)
      const updated: DisasterZone = { ...z, ...clone(patch), id, created_at: z.created_at, updated_at: new Date().toISOString() }
      zones.set(id, updated)
      return clone(updated)
    },

    async listSafetyContent(opts = {}) {
      return [...safety.values()].filter((r) => !opts.publishedOnly || r.status === 'published').map(clone)
    },

    async saveSafetyContent(row) {
      const prev = safety.get(row.hazard_id)
      const now = new Date().toISOString()
      const saved: SafetyRow = {
        ...clone(row), revision: (prev?.revision ?? 0) + 1, created_at: prev?.created_at ?? now, updated_at: now,
        published_at: row.status === 'published' ? now : prev?.published_at ?? null,
      }
      safety.set(row.hazard_id, saved)
      safetyRevs.push({ id: randomUUID(), hazard_id: row.hazard_id, revision: saved.revision, status: saved.status, content: clone(saved.content), reviewed_by: saved.reviewed_by, reviewed_on: saved.reviewed_on, change_reason: saved.change_reason, actor: saved.updated_by, created_at: now })
      return clone(saved)
    },

    async listSafetyRevisions(hazardId) {
      return safetyRevs.filter((r) => r.hazard_id === hazardId).reverse().map(clone)
    },

    async deleteZone(id) {
      if (!zones.delete(id)) throw new StoreError('Zone not found', 404)
    },

    async listFeedZones(feedId) {
      return [...zones.values()].filter((z) => z.feed_id === feedId).map(clone)
    },

    async listZoneAudit(zoneId) {
      // Newest first; entries written in the same millisecond keep their true order (reverse of insertion).
      return zoneAudit.filter((e) => e.zone_id === zoneId).reverse().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(clone)
    },

    async addZoneAudit(entry) {
      zoneAudit.push({ ...clone(entry), id: randomUUID(), created_at: new Date().toISOString() })
    },

    async getFeedStatuses() {
      return [...feeds.values()].map(clone)
    },

    async setFeedStatus(status) {
      const prev = feeds.get(status.feed_id)
      feeds.set(status.feed_id, { name: status.feed_id, last_attempt_at: null, last_success_at: null, last_error: null, zones_seen: 0, stale_after_minutes: 120, ...prev, ...clone(status) } as FeedStatus)
    },
=======
    async mapLayers(area) {
      const inArea = <T extends { area: string | null; verified: boolean }>(x: T) => x.verified && (!area || x.area === area)
      return {
        shelters: demoShelters.filter(inArea).map(clone),
        teams: demoTeams.filter(inArea).filter((t) => t.status !== 'unavailable').map(clone),
        roadBlocks: demoRoadBlocks.filter(inArea).map(clone),
      }
    },
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
  }
}
