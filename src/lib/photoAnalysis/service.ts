// Orchestrates analysing a stored photo: consent check, idempotency, model call, saving.
// A failure here NEVER affects the report or the original photo; it only records "failed".
import { createHash } from 'node:crypto'
import { getStore } from '../db'
import { HttpError } from '../reportService'
import type { AttachmentRow } from '../types'
import { analyzeImage, failedResult, photoModelName, type ModelCall } from './model'
import type { AnalysisRow, PhotoAnalysisResult } from './schema'

type Analyzer = typeof analyzeImage
let analyzer: Analyzer = analyzeImage
export const setAnalyzer = (fn: Analyzer | null) => {
  analyzer = fn ?? analyzeImage
}

const STALE_PROCESSING_MS = 90_000

// Small in-memory cache so the same photo (preview in the form, then again after upload) is sent to the
// model once per server instance. Keyed by content hash; entries expire after 30 minutes.
const g = globalThis as unknown as { __vyraPhotoCache?: Map<string, { at: number; call: ModelCall }> }
const cache = () => (g.__vyraPhotoCache ??= new Map())
export const clearPhotoCache = () => cache().clear()

export async function analyzeBytes(bytes: Uint8Array, mime: string, force = false): Promise<ModelCall> {
  const key = createHash('sha256').update(bytes).digest('hex')
  const hit = cache().get(key)
  if (!force && hit && Date.now() - hit.at < 30 * 60_000 && hit.call.ok) return hit.call
  const call = await analyzer(bytes, mime)
  if (call.ok) {
    cache().set(key, { at: Date.now(), call })
    if (cache().size > 200) cache().delete(cache().keys().next().value as string)
  }
  return call
}

export interface AnalyzeOutcome {
  analysis: AnalysisRow
  reused: boolean
}

export async function analyzeAttachment(opts: { att: AttachmentRow; uploaderId: string | null; consent: boolean; force?: boolean }): Promise<AnalyzeOutcome> {
  if (!opts.consent) throw new HttpError(400, 'Consent to photo analysis is required')
  const store = getStore()
  const { att } = opts
  const prev = await store.getAnalysis(att.id)
  if (prev && !opts.force) {
    if (prev.analysis_status === 'completed') return { analysis: prev, reused: true }
    if (prev.analysis_status === 'processing' && Date.now() - Date.parse(prev.updated_at) < STALE_PROCESSING_MS) return { analysis: prev, reused: true }
  }
  const now = new Date().toISOString()
  const base = { attachment_id: att.id, report_id: att.report_id, uploader_id: opts.uploaderId }
  await store.saveAnalysis({ ...base, analysis_status: 'processing', consent_at: prev?.consent_at ?? now, attempts: (prev?.attempts ?? 0) + 1, failure_reason: null })

  const finish = async (result: PhotoAnalysisResult, reason: string | null) =>
    store.saveAnalysis({
      ...base,
      analysis_status: result.analysis_status,
      result,
      model_provider: result.model_provider,
      model_version: result.model_version,
      analyzed_at: result.analyzed_at,
      failure_reason: reason,
      // A new analysis replaces the old reading, so a previous human review no longer applies to it.
      review_status: 'unreviewed',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null,
    })

  try {
    const bytes = await store.readAttachment(att)
    if (!bytes) return { analysis: await finish(failedResult('The photo file could not be read back for analysis. The original is unchanged.', null), 'The photo file could not be read back for analysis. The original is unchanged.'), reused: false }
    const call = await analyzeBytes(bytes, att.mime_type, opts.force)
    if (call.ok) return { analysis: await finish(call.result, null), reused: false }
    return { analysis: await finish(failedResult(call.reason, call.state === 'not_configured' ? null : photoModelName()), call.reason), reused: false }
  } catch (err) {
    console.error('photo analysis failed', err instanceof Error ? err.message : err)
    const analysis = await store
      .saveAnalysis({ ...base, analysis_status: 'failed', failure_reason: 'Analysis could not be completed. You can retry, or describe the situation yourself.', result: failedResult('Analysis could not be completed. You can retry, or describe the situation yourself.', null) })
      .catch(() => null)
    if (!analysis) throw new HttpError(503, 'Photo analysis is temporarily unavailable')
    return { analysis, reused: false }
  }
}

/** What the person who took the photo gets back (no reviewer identity). */
export const submitterView = (a: AnalysisRow) => ({
  attachment_id: a.attachment_id,
  analysis_status: a.analysis_status,
  result: a.result,
  failure_reason: a.failure_reason,
  user_action: a.user_action,
  analyzed_at: a.analyzed_at,
})

/** What staff get: everything, always labelled unverified until a person reviews it. */
export const staffView = (a: AnalysisRow) => ({ ...submitterView(a), review_status: a.review_status, reviewed_by: a.reviewed_by, reviewed_at: a.reviewed_at, review_note: a.review_note, verified: a.review_status === 'confirmed', consent_at: a.consent_at, attempts: a.attempts })
