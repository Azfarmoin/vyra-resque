// Storage for satellite analyses. Records are APPEND-ONLY: an analysis row is never edited, a review is a new row,
// a link is a new row. So the original imagery metadata, parameters and results stay exactly as produced.
//  * Supabase mode: tables from migration 014, written through the signed-in user's own client (row level security applies).
//  * Demo / tests: in-memory arrays on globalThis.
import { randomUUID } from 'node:crypto'
import { isDemoMode } from '../adminAuth'
import type { Responder } from '../routing/auth'
import type { AnalysisRecord, ImageKind, LinkEntry, ReviewEntry } from './types'

export interface SatelliteRepo {
  insertAnalysis(a: AnalysisRecord, images: Partial<Record<ImageKind, Buffer>> | null, user: Responder): Promise<void>
  listAnalyses(user: Responder, opts: { limit: number; targetType?: string; targetId?: string }): Promise<AnalysisRecord[]>
  getAnalysis(id: string, user: Responder): Promise<AnalysisRecord | null>
  getImage(id: string, kind: ImageKind, user: Responder): Promise<Buffer | null>
  addReview(r: Omit<ReviewEntry, 'id' | 'createdAt'>, user: Responder): Promise<ReviewEntry>
  listReviews(analysisIds: string[], user: Responder): Promise<ReviewEntry[]>
  addLink(l: Omit<LinkEntry, 'id' | 'createdAt'>, user: Responder): Promise<LinkEntry>
  listLinks(opts: { analysisIds?: string[]; targetType?: string; targetId?: string }, user: Responder): Promise<LinkEntry[]>
}

// ---------------------------------------------------------------------------------------------------
type MemState = { analyses: AnalysisRecord[]; images: Map<string, Partial<Record<ImageKind, Buffer>>>; reviews: ReviewEntry[]; links: LinkEntry[] }
const g = globalThis as unknown as { __vyraSat?: MemState }
const mem = (): MemState => (g.__vyraSat ??= { analyses: [], images: new Map(), reviews: [], links: [] } as MemState)
export const _satMemory = { reset: () => { g.__vyraSat = undefined }, state: mem }

export const memoryRepo: SatelliteRepo = {
  async insertAnalysis(a, images) { mem().analyses.push(structuredClone(a)); if (images) mem().images.set(a.id, images) },
  async listAnalyses(_u, o) {
    const links = mem().links
    let rows = [...mem().analyses]
    if (o.targetType && o.targetId) { const ids = new Set(links.filter((l) => l.targetType === o.targetType && l.targetId === o.targetId).map((l) => l.analysisId)); rows = rows.filter((r) => ids.has(r.id)) }
    return rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, o.limit).map((r) => structuredClone(r))
  },
  async getAnalysis(id) { const r = mem().analyses.find((a) => a.id === id); return r ? structuredClone(r) : null },
  async getImage(id, kind) { return mem().images.get(id)?.[kind] ?? null },
  async addReview(r) { const e: ReviewEntry = { ...r, id: randomUUID(), createdAt: new Date().toISOString() }; mem().reviews.push(e); return structuredClone(e) },
  async listReviews(ids) { return mem().reviews.filter((r) => ids.includes(r.analysisId)).map((r) => structuredClone(r)) },
  async addLink(l) { const e: LinkEntry = { ...l, id: randomUUID(), createdAt: new Date().toISOString() }; mem().links.push(e); return structuredClone(e) },
  async listLinks(o) {
    return mem().links.filter((l) => (!o.analysisIds || o.analysisIds.includes(l.analysisId)) && (!o.targetType || l.targetType === o.targetType) && (!o.targetId || l.targetId === o.targetId)).map((l) => structuredClone(l))
  },
}

// ---------------------------------------------------------------------------------------------------
type Row = Record<string, unknown>
function toRecord(r: Row): AnalysisRecord {
  return {
    id: r.id as string, createdAt: r.created_at as string, createdBy: r.created_by as string, createdByName: (r.created_by_name as string) ?? '', status: r.status as AnalysisRecord['status'], error: (r.error as string) ?? null,
    provider: r.provider as AnalysisRecord['provider'], collection: r.collection as AnalysisRecord['collection'], synthetic: !!r.synthetic,
    aoi: r.aoi as AnalysisRecord['aoi'], beforeRange: r.before_range as AnalysisRecord['beforeRange'], afterRange: r.after_range as AnalysisRecord['afterRange'],
    before: (r.before_scene as AnalysisRecord['before']) ?? null, after: (r.after_scene as AnalysisRecord['after']) ?? null,
    method: (r.method as AnalysisRecord['method']) ?? null, parameters: (r.parameters as AnalysisRecord['parameters']) ?? null,
    quality: (r.quality as AnalysisRecord['quality']) ?? null, stats: (r.stats as AnalysisRecord['stats']) ?? null,
    findings: (r.findings as string[]) ?? [], limitations: (r.limitations as string[]) ?? [], processingMs: (r.processing_ms as number) ?? null,
    overlayBounds: (r.overlay_bounds as AnalysisRecord['overlayBounds']) ?? null, hasImages: !!r.has_images, uploadFingerprints: (r.upload_fingerprints as AnalysisRecord['uploadFingerprints']) ?? undefined,
  }
}
const reviewOf = (r: Row): ReviewEntry => ({ id: r.id as string, analysisId: r.analysis_id as string, state: r.state as ReviewEntry['state'], note: (r.note as string) ?? null, acknowledgedLimitations: !!r.acknowledged_limitations, reviewedBy: r.reviewed_by as string, reviewedByName: (r.reviewed_by_name as string) ?? '', createdAt: r.created_at as string })
const linkOf = (r: Row): LinkEntry => ({ id: r.id as string, analysisId: r.analysis_id as string, targetType: r.target_type as LinkEntry['targetType'], targetId: r.target_id as string, note: (r.note as string) ?? null, linkedBy: r.linked_by as string, linkedByName: (r.linked_by_name as string) ?? '', createdAt: r.created_at as string })
const fail = (what: string, e: { message: string }): never => { throw new RepoError(`${what}: ${e.message}`) }
export class RepoError extends Error {}

export const supabaseRepo: SatelliteRepo = {
  async insertAnalysis(a, images, user) {
    const db = user.db!
    const { error } = await db.from('satellite_analyses').insert({
      id: a.id, created_at: a.createdAt, created_by: user.id, created_by_name: a.createdByName, status: a.status, error: a.error, provider: a.provider, collection: a.collection, synthetic: a.synthetic,
      aoi: a.aoi, before_range: a.beforeRange, after_range: a.afterRange, before_scene: a.before, after_scene: a.after, method: a.method, parameters: a.parameters, quality: a.quality, stats: a.stats,
      findings: a.findings, limitations: a.limitations, processing_ms: a.processingMs, overlay_bounds: a.overlayBounds, has_images: a.hasImages, upload_fingerprints: a.uploadFingerprints ?? null,
    })
    if (error) fail('Saving the analysis failed. Has migration 014_satellite_analysis.sql been run?', error)
    if (images) for (const [kind, buf] of Object.entries(images)) {
      const { error: e2 } = await db.from('satellite_images').insert({ analysis_id: a.id, kind, png_base64: buf!.toString('base64') })
      if (e2) fail('Saving the analysis images failed', e2)
    }
  },
  async listAnalyses(user, o) {
    const db = user.db!
    let ids: string[] | null = null
    if (o.targetType && o.targetId) {
      const { data, error } = await db.from('satellite_links').select('analysis_id').eq('target_type', o.targetType).eq('target_id', o.targetId)
      if (error) fail('Reading links failed', error)
      ids = (data ?? []).map((r: Row) => r.analysis_id as string)
      if (!ids.length) return []
    }
    let q = db.from('satellite_analyses').select('*').order('created_at', { ascending: false }).limit(o.limit)
    if (ids) q = q.in('id', ids)
    const { data, error } = await q
    if (error) fail('Reading analyses failed', error)
    return (data ?? []).map(toRecord)
  },
  async getAnalysis(id, user) { const { data, error } = await user.db!.from('satellite_analyses').select('*').eq('id', id).maybeSingle(); if (error) fail('Reading the analysis failed', error); return data ? toRecord(data as Row) : null },
  async getImage(id, kind, user) { const { data, error } = await user.db!.from('satellite_images').select('png_base64').eq('analysis_id', id).eq('kind', kind).maybeSingle(); if (error) fail('Reading the image failed', error); return data ? Buffer.from((data as Row).png_base64 as string, 'base64') : null },
  async addReview(r, user) {
    const { data, error } = await user.db!.from('satellite_reviews').insert({ analysis_id: r.analysisId, state: r.state, note: r.note, acknowledged_limitations: r.acknowledgedLimitations, reviewed_by: user.id, reviewed_by_name: r.reviewedByName }).select('*').single()
    if (error) fail('Saving the review failed', error)
    return reviewOf(data as Row)
  },
  async listReviews(ids, user) { if (!ids.length) return []; const { data, error } = await user.db!.from('satellite_reviews').select('*').in('analysis_id', ids).order('created_at', { ascending: true }); if (error) fail('Reading reviews failed', error); return (data ?? []).map(reviewOf) },
  async addLink(l, user) {
    const { data, error } = await user.db!.from('satellite_links').insert({ analysis_id: l.analysisId, target_type: l.targetType, target_id: l.targetId, note: l.note, linked_by: user.id, linked_by_name: l.linkedByName }).select('*').single()
    if (error) fail('Saving the link failed', error)
    return linkOf(data as Row)
  },
  async listLinks(o, user) {
    let q = user.db!.from('satellite_links').select('*').order('created_at', { ascending: true })
    if (o.analysisIds) { if (!o.analysisIds.length) return []; q = q.in('analysis_id', o.analysisIds) }
    if (o.targetType) q = q.eq('target_type', o.targetType)
    if (o.targetId) q = q.eq('target_id', o.targetId)
    const { data, error } = await q
    if (error) fail('Reading links failed', error)
    return (data ?? []).map(linkOf)
  },
}

let override: SatelliteRepo | null = null
export const setSatelliteRepo = (r: SatelliteRepo | null) => { override = r }
export const getRepo = (user: Responder): SatelliteRepo => override ?? (isDemoMode() || !user.db ? memoryRepo : supabaseRepo)
