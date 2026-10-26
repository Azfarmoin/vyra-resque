<<<<<<< HEAD
import type { AnalysisRow } from '../photoAnalysis/schema'
import type { AttachmentRow, BlockedRoad, NewReport, ReportEvent, ReportRow, RescueTeam, Shelter } from '../types'
import type { SafetyRevision, SafetyRow } from '../safety/admin'
import type { Status } from '../constants'
import type { DisasterZone, FeedStatus, ZoneAuditEntry, BBox } from '../zones/types'
=======
import type { BlockedRoad, NewReport, ReportEvent, ReportRow, RescueTeam, Shelter } from '../types'
import type { Status } from '../constants'
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895

export interface ReportFilter {
  area?: string
  statuses?: Status[]
  verified?: boolean
  bbox?: [number, number, number, number] // minLng, minLat, maxLng, maxLat
}

// Everything Stages 4-6 need from storage. Implemented by Supabase (real) and an
// in-memory demo store (local demos / no network / tests).
export interface DataStore {
  mode: 'supabase' | 'demo'
  insertReport(report: NewReport): Promise<ReportRow>
  findReportByClientId(clientId: string): Promise<ReportRow | null>
  getReport(id: string): Promise<ReportRow | null>
  listReports(filter: ReportFilter): Promise<ReportRow[]>
  updateReport(id: string, patch: Partial<ReportRow>): Promise<ReportRow>
  addEvent(event: Omit<ReportEvent, 'id' | 'created_at'>): Promise<void>
  listEvents(reportId: string): Promise<ReportEvent[]>
<<<<<<< HEAD
  // Photos attached to a report (private storage; never public URLs).
  findAttachment(reportId: string, clientId: string): Promise<AttachmentRow | null>
  listAttachments(reportId: string): Promise<AttachmentRow[]>
  saveAttachment(input: { report_id: string; client_id: string; mime_type: string; bytes: Uint8Array }): Promise<AttachmentRow>
  readAttachment(row: AttachmentRow): Promise<Uint8Array | null>
  // AI photo analysis (one row per photo). Never publicly readable; see migration 013.
  getAnalysis(attachmentId: string): Promise<AnalysisRow | null>
  listAnalyses(reportId: string): Promise<AnalysisRow[]>
  saveAnalysis(row: Partial<AnalysisRow> & { attachment_id: string; report_id: string }): Promise<AnalysisRow>
  mapLayers(area?: string): Promise<{ shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }>
  // Every blocked-road record INCLUDING unverified ones. For responder-only route analysis; the public
  // map layer (mapLayers) keeps hiding unverified roads.
  listBlockedRoads(): Promise<BlockedRoad[]>

  // ---- disaster zones ----
  // `actor.token` is the signed-in user's Supabase access token: writes run AS that user so Row Level Security
  // and the audit trigger see the real person. `actor.service` is only for feed imports on the server.
  listZones(opts?: { bbox?: BBox | null; includeHidden?: boolean }): Promise<DisasterZone[]>
  getZone(id: string): Promise<DisasterZone | null>
  insertZone(zone: Omit<DisasterZone, 'id' | 'created_at' | 'updated_at'>, actor?: ZoneActor): Promise<DisasterZone>
  updateZone(id: string, patch: Partial<DisasterZone>, actor?: ZoneActor): Promise<DisasterZone>
  deleteZone(id: string, actor?: ZoneActor): Promise<void>
  listFeedZones(feedId: string): Promise<DisasterZone[]>
  listZoneAudit(zoneId: string, actor?: ZoneActor): Promise<ZoneAuditEntry[]>
  // Supabase records audit rows with a database trigger (cannot be skipped or forged), so there this is a no-op.
  addZoneAudit(entry: Omit<ZoneAuditEntry, 'id' | 'created_at'>): Promise<void>
  // ---- administrator-managed safety content ----
  listSafetyContent(opts?: { publishedOnly?: boolean }): Promise<SafetyRow[]>
  saveSafetyContent(row: Omit<SafetyRow, 'created_at' | 'updated_at' | 'revision' | 'published_at'>, actor?: ZoneActor): Promise<SafetyRow>
  listSafetyRevisions(hazardId: string, actor?: ZoneActor): Promise<SafetyRevision[]>
  getFeedStatuses(): Promise<FeedStatus[]>
  setFeedStatus(status: Partial<FeedStatus> & { feed_id: string }): Promise<void>
}

export interface ZoneActor { token?: string; service?: boolean }

=======
  mapLayers(area?: string): Promise<{ shelters: Shelter[]; teams: RescueTeam[]; roadBlocks: BlockedRoad[] }>
}

>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
export class StoreError extends Error {
  constructor(message: string, public status = 500) {
    super(message)
  }
}
