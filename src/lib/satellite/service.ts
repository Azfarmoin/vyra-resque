// Satellite analysis workflow. Everything the API routes do goes through here.
//
// SAFETY CONTRACT (enforced by tests/satellite.safety.test.ts): this module only ever writes satellite_* records.
// It never changes a report's status, priority, verification or triage, never touches zones, shelters, blocked roads,
// dispatches or teams. A finding is advisory evidence a person may look at; nothing here acts on it.
import { randomUUID } from 'node:crypto'
import { getStore } from '../db'
import { isDemoMode } from '../adminAuth'
import { getRoutingDeps } from '../routing/deps'
import { checkRateLimit } from '../routing/rateLimit'
import type { Responder } from '../routing/auth'
import { analyseOptical, analyseSar, type LoadedScene } from './analysis/engine'
import { AnalysisError, compatibilityErrors, rate, sceneChecks } from './quality'
import { getProvider, getProviders } from './providers/registry'
import { describeUpload, type UploadDeclaration } from './providers/userUpload'
import { ProviderError } from './providers/types'
import { insideMask, makeGrid } from './raster/grid'
import { getRepo, RepoError } from './repo'
import {
  ADVISORY, COLLECTION_KIND, DEFAULT_OPTICAL_PARAMS, DEFAULT_SAR_PARAMS, LINK_TARGETS, REVIEW_STATES,
  type AnalysisRecord, type AnalysisView, type CollectionId, type DateRange, type ImageKind, type LinkEntry, type LinkTarget, type OpticalParams, type ReviewEntry, type ReviewState, type SarParams, type SceneMeta,
} from './types'
import { limits, parseDay, validateAoi, validateCollection, validateOpticalParams, validateRanges, validateSarParams } from './validation'

export class SatError extends Error {
  constructor(public status: number, message: string, public code = 'error', public extra: Record<string, unknown> = {}) { super(message) }
}

const publicScene = (s: SceneMeta): SceneMeta => { const { access: _a, ...rest } = s; void _a; return rest as SceneMeta } // provider access details never leave the server
const cloudHint = (s: SceneMeta): 'good' | 'fair' | 'poor' | 'n/a' => (s.kind === 'sar' ? 'n/a' : s.cloudCover == null ? 'fair' : s.cloudCover <= 15 ? 'good' : s.cloudCover <= 40 ? 'fair' : 'poor')

export function listProviderStatuses() { return getProviders().map((p) => p.status()) }

function readyProvider(id: unknown) {
  const p = typeof id === 'string' ? getProvider(id) : null
  if (!p) throw new SatError(404, 'Unknown imagery provider.', 'unknown_provider')
  const st = p.status()
  if (st.state !== 'ready') throw new SatError(503, st.state === 'missing_credentials' ? `This provider is not available: credentials are missing (${st.missing.join(', ')}). Ask an administrator to set them on the server.` : st.message, `provider_${st.state}`, { missing: st.missing })
  return { p, st }
}

function mapProviderError(e: unknown): never {
  if (e instanceof SatError) throw e
  if (e instanceof ProviderError) throw new SatError(e.status, e.message, `provider_${e.code}`)
  if (e instanceof AnalysisError) throw new SatError(e.status, e.message, e.code)
  throw e
}

// ---- search ---------------------------------------------------------------------------------------
export async function searchScenes(user: Responder, body: Record<string, unknown>, now = Date.now()) {
  if (!validateCollection(body.collection)) throw new SatError(400, 'Choose an imagery collection.', 'bad_collection')
  const collection = body.collection as CollectionId
  const errors = validateRanges(body.before, body.after, collection, now)
  const aoi = validateAoi(body.aoi)
  if (!aoi.ok) errors.push(...aoi.errors)
  if (errors.length || !aoi.ok) throw new SatError(400, errors.join(' '), 'validation', { errors })
  const { p, st } = readyProvider(body.provider)
  if (!st.collections.includes(collection)) throw new SatError(400, 'That provider does not offer this collection.', 'bad_collection')
  const maxCloud = typeof body.maxCloud === 'number' && body.maxCloud >= 0 && body.maxCloud <= 100 ? body.maxCloud : undefined
  const b = body.before as DateRange, a = body.after as DateRange
  try {
    const [before, after] = await Promise.all([p.search({ collection, bbox: aoi.bbox, start: b.start, end: b.end, maxCloud }), p.search({ collection, bbox: aoi.bbox, start: a.start, end: a.end, maxCloud })])
    const notes = [...new Set([...before.notes, ...after.notes])]
    if (!before.scenes.length) notes.push('No imagery was found for the before dates over this area. Try a longer range or a higher cloud limit.')
    if (!after.scenes.length) notes.push('No imagery was found for the after dates over this area. Imagery may not have been acquired or published yet.')
    const fin = (r: typeof before) => r.scenes.map((s) => ({ ...publicScene(s), qualityHint: cloudHint(s) }))
    return { provider: st.id, collection, aoi: { bbox: aoi.bbox, areaKm2: aoi.areaKm2 }, before: fin(before), after: fin(after), notes, synthetic: st.demo === true }
  } catch (e) { return mapProviderError(e) }
}

// ---- analysis -------------------------------------------------------------------------------------
export interface UploadInput { buf: ArrayBuffer; filename: string; decl: UploadDeclaration }
export interface AnalysisRequest {
  provider: unknown; collection: unknown; aoi: unknown
  beforeRange?: unknown; afterRange?: unknown; beforeSceneId?: unknown; afterSceneId?: unknown
  parameters?: unknown
  uploads?: { before: UploadInput; after: UploadInput } | null
}

export async function createAnalysis(user: Responder, req: AnalysisRequest, now = Date.now()): Promise<AnalysisView> {
  const rl = checkRateLimit(`sat-analyze:${user.id}`, { limit: 6, windowMs: 60_000 })
  if (!rl.ok) throw new SatError(429, `Too many analyses. Try again in ${rl.retryAfterS} s.`, 'rate_limited')
  const { p, st } = readyProvider(req.provider)
  const upload = p.id === 'user-upload'
  if (!validateCollection(req.collection)) throw new SatError(400, 'Choose an imagery collection.', 'bad_collection')
  let collection = req.collection as CollectionId
  const errors: string[] = []
  const aoi = validateAoi(req.aoi)
  if (!aoi.ok) errors.push(...aoi.errors)
  if (upload) {
    if (!req.uploads?.before || !req.uploads?.after) errors.push('Upload both a before and an after image.')
    else for (const u of [req.uploads.before, req.uploads.after]) if (u.buf.byteLength > limits().maxUploadBytes) errors.push(`${u.filename} is larger than ${Math.round(limits().maxUploadBytes / 1048576)} MB.`)
  } else {
    errors.push(...validateRanges(req.beforeRange, req.afterRange, collection, now))
    if (typeof req.beforeSceneId !== 'string' || typeof req.afterSceneId !== 'string' || !req.beforeSceneId || !req.afterSceneId) errors.push('Pick one before scene and one after scene.')
    if (!st.collections.includes(collection)) errors.push('That provider does not offer this collection.')
  }
  const kind = COLLECTION_KIND[collection]
  const params = kind === 'optical' ? validateOpticalParams(req.parameters) : validateSarParams(req.parameters)
  if (!params.ok) errors.push(...params.errors)
  if (errors.length || !aoi.ok || !params.ok) throw new SatError(400, errors.join(' '), 'validation', { errors })

  const t0 = Date.now()
  const id = randomUUID()
  const base = { id, createdAt: new Date(now).toISOString(), createdBy: user.id, createdByName: user.name, provider: p.id, aoi: { bbox: aoi.bbox, polygon: aoi.polygon, areaKm2: aoi.areaKm2 }, limitations: [] as string[] }
  let before: SceneMeta | null = null, after: SceneMeta | null = null
  let beforeRange = (req.beforeRange ?? { start: '', end: '' }) as DateRange, afterRange = (req.afterRange ?? { start: '', end: '' }) as DateRange
  const repo = getRepo(user)

  const saveFailure = async (message: string, code: string, status: number): Promise<never> => {
    const rec: AnalysisRecord = { ...base, status: 'failed', error: message, collection, synthetic: !!(before?.synthetic || after?.synthetic), beforeRange, afterRange, before: before && publicScene(before), after: after && publicScene(after), method: null, parameters: null, quality: null, stats: null, findings: [], processingMs: Date.now() - t0, overlayBounds: null, hasImages: false }
    try { await repo.insertAnalysis(rec, null, user) } catch { /* the failure itself is still reported below */ }
    throw new SatError(status, message, code, { analysisId: id })
  }

  try {
    if (upload) {
      const u = req.uploads!
      before = await describeUpload(u.before.buf, u.before.decl, u.before.filename, now)
      after = await describeUpload(u.after.buf, u.after.decl, u.after.filename, now)
      if (before.kind !== kind || after.kind !== kind) throw new AnalysisError('bad_declaration', `The uploaded images must be ${kind === 'optical' ? 'optical' : 'radar'} images to match the chosen collection.`, 400)
      collection = before.collection
      beforeRange = { start: before.acquiredAt.slice(0, 10), end: before.acquiredAt.slice(0, 10) }
      afterRange = { start: after.acquiredAt.slice(0, 10), end: after.acquiredAt.slice(0, 10) }
    } else {
      ;[before, after] = await Promise.all([p.getScene(collection, req.beforeSceneId as string), p.getScene(collection, req.afterSceneId as string)])
      const inRange = (s: SceneMeta, r: DateRange) => { const d = Date.parse(s.acquiredAt); return d >= Date.parse(`${r.start}T00:00:00Z`) && d <= Date.parse(`${r.end}T23:59:59.999Z`) }
      if (!inRange(before, beforeRange)) throw new SatError(400, 'The chosen before scene was not acquired inside the before date range.', 'scene_out_of_range')
      if (!inRange(after, afterRange)) throw new SatError(400, 'The chosen after scene was not acquired inside the after date range.', 'scene_out_of_range')
    }
    const incompatible = compatibilityErrors(before, after)
    if (incompatible.length) throw new SatError(400, incompatible.join(' '), 'incompatible_scenes')

    const grid = makeGrid(aoi.bbox, Math.max(before.resolutionM, after.resolutionM), limits().maxGrid)
    const inside = insideMask(grid, aoi.polygon)
    before.access = { ...(before.access ?? {}), role: 'before' }
    after.access = { ...(after.access ?? {}), role: 'after' }
    const [lb, la]: LoadedScene[] = await Promise.all([p.load(before, grid), p.load(after, grid)])
    const engine = kind === 'optical' ? analyseOptical(grid, inside, lb, la, params.value as OpticalParams) : analyseSar(grid, inside, lb, la, params.value as SarParams)
    if (engine.stats.validFraction < 0.02) throw new AnalysisError('no_valid_pixels', 'Almost none of the area was usable on both dates (cloud, shadow or no coverage), so no analysis could be made.')
    const checks = [...sceneChecks(before, after, aoi.bbox, grid.cellM), ...engine.checks]
    const synthetic = !!(before.synthetic || after.synthetic)
    const findings = synthetic ? ['DEMONSTRATION: these results come from synthetic data and say nothing about the real world.', ...engine.findings] : engine.findings
    const rec: AnalysisRecord = {
      ...base, status: 'completed', error: null, collection, synthetic, beforeRange, afterRange, before: publicScene(before), after: publicScene(after),
      method: kind === 'optical' ? 'optical_water_index_v1' : 'sar_backscatter_change_v1', parameters: params.value,
      quality: { rating: rate(engine.stats.validFraction, checks), checks }, stats: engine.stats, findings, limitations: engine.limitations, processingMs: Date.now() - t0,
      overlayBounds: grid.bbox, hasImages: true,
      uploadFingerprints: upload ? { before: String(before.original.sha256), after: String(after.original.sha256) } : undefined,
    }
    try { await repo.insertAnalysis(rec, engine.images, user) } catch (e) {
      if (e instanceof RepoError) throw new SatError(503, `The analysis finished but could not be saved, so it is not shown. ${e.message}`, 'save_failed')
      throw e
    }
    return { ...rec, reviewState: 'needs_review', reviews: [], links: [] }
  } catch (e) {
    let err!: SatError
    try { mapProviderError(e) } catch (x) { if (!(x instanceof SatError)) throw x; err = x }
    // Input problems (400) and save failures are reported as they are; processing failures are also recorded in the history.
    if (err.status === 400 || err.code === 'save_failed') throw err
    return saveFailure(err.message, err.code, err.status)
  }
}

// ---- reading --------------------------------------------------------------------------------------
async function decorate(user: Responder, rows: AnalysisRecord[]): Promise<AnalysisView[]> {
  const repo = getRepo(user), ids = rows.map((r) => r.id)
  const [reviews, links] = await Promise.all([repo.listReviews(ids, user), repo.listLinks({ analysisIds: ids }, user)])
  return rows.map((r) => {
    const rv = reviews.filter((x) => x.analysisId === r.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { ...r, reviewState: rv.length ? rv[rv.length - 1].state : 'needs_review', reviews: rv, links: links.filter((l) => l.analysisId === r.id) }
  })
}
export async function listAnalyses(user: Responder, o: { limit?: number; targetType?: string; targetId?: string } = {}): Promise<AnalysisView[]> {
  if (o.targetType && !(LINK_TARGETS as readonly string[]).includes(o.targetType)) throw new SatError(400, 'Unknown link target type.', 'validation')
  return decorate(user, await getRepo(user).listAnalyses(user, { limit: Math.min(Math.max(o.limit ?? 50, 1), 200), targetType: o.targetType, targetId: o.targetId }))
}
async function mustGet(user: Responder, id: string) {
  const r = /^[0-9a-f-]{36}$/i.test(id) ? await getRepo(user).getAnalysis(id, user) : null
  if (!r) throw new SatError(404, 'Analysis not found.', 'not_found')
  return r
}
export async function getAnalysisView(user: Responder, id: string): Promise<AnalysisView> { return (await decorate(user, [await mustGet(user, id)]))[0] }
export async function getImage(user: Responder, id: string, kind: string): Promise<Buffer> {
  if (!['before', 'after', 'change'].includes(kind)) throw new SatError(404, 'Unknown image.', 'not_found')
  await mustGet(user, id)
  const img = await getRepo(user).getImage(id, kind as ImageKind, user)
  if (!img) throw new SatError(404, 'This analysis has no such image.', 'not_found')
  return img
}

// ---- review ---------------------------------------------------------------------------------------
export async function reviewAnalysis(user: Responder, id: string, body: Record<string, unknown>): Promise<AnalysisView> {
  const state = body.state as ReviewState
  if (!(REVIEW_STATES as readonly string[]).includes(state)) throw new SatError(400, 'Choose a review state.', 'validation')
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length > 1000) throw new SatError(400, 'The note is too long (1000 characters at most).', 'validation')
  const a = await mustGet(user, id)
  const ack = body.acknowledgedLimitations === true
  if (state === 'confirmed_by_reviewer') {
    if (a.status !== 'completed') throw new SatError(409, 'A failed analysis cannot be confirmed.', 'cannot_confirm')
    if (a.synthetic) throw new SatError(409, 'Demonstration results are synthetic and can never be confirmed.', 'cannot_confirm_synthetic')
    if (a.quality?.rating === 'unusable') throw new SatError(409, 'This analysis is rated unusable and cannot be confirmed. Mark it Inconclusive instead.', 'cannot_confirm_unusable')
    if (note.length < 10) throw new SatError(400, 'Write a note (at least 10 characters) saying what you checked before confirming.', 'note_required')
    if (!ack) throw new SatError(400, 'Confirm that you understand the limitations of satellite findings before confirming.', 'ack_required')
  }
  await getRepo(user).addReview({ analysisId: id, state, note: note || null, acknowledgedLimitations: ack, reviewedBy: user.id, reviewedByName: user.name }, user)
  return getAnalysisView(user, id)
}

// ---- links to incidents, hazards, zones -----------------------------------------------------------
async function targetExists(type: LinkTarget, targetId: string): Promise<boolean> {
  if (type === 'report') return !!(await getStore().getReport(targetId))
  if (type === 'zone') return !!(await getStore().getZone(targetId))
  const data = await getRoutingDeps().loadHazards()
  return data.hazards.some((h) => h.id === targetId)
}
export async function linkAnalysis(user: Responder, id: string, body: Record<string, unknown>): Promise<LinkEntry> {
  const type = body.targetType as LinkTarget
  if (!(LINK_TARGETS as readonly string[]).includes(type)) throw new SatError(400, 'Choose what to link to: an incident report, a hazard or a zone.', 'validation')
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
  if (!targetId || targetId.length > 120) throw new SatError(400, 'Choose the record to link to.', 'validation')
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  const a = await mustGet(user, id)
  if (a.status !== 'completed') throw new SatError(409, 'A failed analysis cannot be linked.', 'cannot_link')
  if (a.synthetic && !isDemoMode()) throw new SatError(409, 'Demonstration results cannot be linked to real records.', 'cannot_link_synthetic')
  let exists: boolean
  try { exists = await targetExists(type, targetId) } catch { throw new SatError(503, 'Could not check that record right now. Try again shortly.', 'target_unavailable') }
  if (!exists) throw new SatError(404, 'That record was not found.', 'target_not_found')
  const repo = getRepo(user)
  if ((await repo.listLinks({ analysisIds: [id], targetType: type, targetId }, user)).length) throw new SatError(409, 'This analysis is already linked to that record.', 'already_linked')
  return repo.addLink({ analysisId: id, targetType: type, targetId, note: note || null, linkedBy: user.id, linkedByName: user.name }, user)
}

export { ADVISORY, DEFAULT_OPTICAL_PARAMS, DEFAULT_SAR_PARAMS, parseDay }
export type { ReviewEntry }
