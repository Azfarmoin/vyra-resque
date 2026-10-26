// Audit trail for route analyses and dispatcher decisions.
//  * Supabase mode: tables route_analyses / route_decisions (migration 006), written through the
//    signed-in user's own client so row-level security applies. If the migration is missing the save
//    fails and the API says so; approvals stay disabled rather than going unrecorded.
//  * Demo mode: in-memory arrays on globalThis.
import { randomUUID } from 'node:crypto'
import { isDemoMode } from '../adminAuth'
import type { AuditRecord } from './routeAnalysis'
import type { Responder } from './auth'

export interface DecisionRecord {
  id: string
  analysisId: string
  candidateId: string
  decision: 'approved' | 'rejected'
  note: string | null
  acknowledgedLimitations: boolean
  candidateStatus: string
  decidedBy: string
  decidedByName: string
  decidedAt: string
}

const g = globalThis as unknown as { __vyraAnalyses?: (AuditRecord & { requestedBy: string })[]; __vyraDecisions?: DecisionRecord[] }
const demoAnalyses = () => (g.__vyraAnalyses ??= [])
const demoDecisions = () => (g.__vyraDecisions ??= [])

export async function saveAnalysis(record: AuditRecord, user: Responder): Promise<boolean> {
  if (isDemoMode() || !user.db) {
    demoAnalyses().push({ ...structuredClone(record), requestedBy: user.id })
    if (demoAnalyses().length > 500) demoAnalyses().shift()
    return true
  }
  const { error } = await user.db.from('route_analyses').insert({
    id: record.id,
    requested_by: user.id,
    analyzed_at: record.analyzedAt,
    vehicle: record.vehicle,
    origin_lat: record.origin[0],
    origin_lng: record.origin[1],
    destination_lat: record.destination[0],
    destination_lng: record.destination[1],
    provider: record.provider,
    data_sources: record.dataSources,
    skipped_records: record.skippedRecords,
    hazard_ids: record.hazardIds,
    candidates: record.candidates,
    newest_record_at: record.newestRecordAt,
    ai_state: record.aiState,
    notices: record.notices,
  })
  if (error) console.error('route_analyses insert failed:', error.message)
  return !error
}

export async function getAnalysis(id: string, user: Responder): Promise<AuditRecord | null> {
  if (isDemoMode() || !user.db) return demoAnalyses().find((a) => a.id === id) ?? null
  const { data, error } = await user.db.from('route_analyses').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return {
    id: data.id,
    analyzedAt: data.analyzed_at,
    vehicle: data.vehicle,
    origin: [Number(data.origin_lat), Number(data.origin_lng)],
    destination: [Number(data.destination_lat), Number(data.destination_lng)],
    provider: data.provider,
    dataSources: data.data_sources ?? [],
    skippedRecords: data.skipped_records ?? 0,
    hazardIds: data.hazard_ids ?? [],
    candidates: data.candidates ?? [],
    newestRecordAt: data.newest_record_at,
    aiState: data.ai_state,
    notices: data.notices ?? [],
  }
}

export async function saveDecision(d: Omit<DecisionRecord, 'id' | 'decidedAt'>, user: Responder): Promise<DecisionRecord | null> {
  const rec: DecisionRecord = { ...d, id: randomUUID(), decidedAt: new Date().toISOString() }
  if (isDemoMode() || !user.db) {
    demoDecisions().push(rec)
    return rec
  }
  const { error } = await user.db.from('route_decisions').insert({
    id: rec.id,
    analysis_id: rec.analysisId,
    candidate_id: rec.candidateId,
    decision: rec.decision,
    note: rec.note,
    acknowledged_limitations: rec.acknowledgedLimitations,
    candidate_status: rec.candidateStatus,
    decided_by: user.id,
    decided_by_name: rec.decidedByName,
    decided_at: rec.decidedAt,
  })
  if (error) {
    console.error('route_decisions insert failed:', error.message)
    return null
  }
  return rec
}

/** Test helper. */
export const _demoAudit = { analyses: demoAnalyses, decisions: demoDecisions }
