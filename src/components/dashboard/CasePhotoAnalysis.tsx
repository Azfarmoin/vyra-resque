'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/ui/Icon'
import { getIdentity } from '@/lib/offline/identity'
import { INCIDENT_TYPES, type PhotoAnalysisResult, type ReviewStatus } from '@/lib/photoAnalysis/schema'
import type { CombinedSummary } from '@/lib/photoAnalysis/combine'

interface PhotoEntry {
  attachment_id: string
  label: string
  analysis: { analysis_status: string; result: PhotoAnalysisResult | null; failure_reason: string | null; review_status: ReviewStatus; reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; user_action: string } | null
}

const REVIEW_LABEL: Record<ReviewStatus, string> = { unreviewed: 'Not yet checked by a person', confirmed: 'Confirmed by a responder', rejected: 'Rejected by a responder', needs_more_info: 'Needs more information' }

// AI findings from the report's photos, for responders and admins. Every finding is UNVERIFIED until a
// person reviews it. This panel never changes the priority score, creates a zone or blocked-road record,
// issues an evacuation order or dispatches anyone: it only informs the person looking at the case.
export default function CasePhotoAnalysis({ reportId, priority }: { reportId: string; priority: string }) {
  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [combined, setCombined] = useState<CombinedSummary | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const headers = useCallback(async (): Promise<HeadersInit> => {
    const { token } = await getIdentity()
    return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${reportId}/analyses`, { headers: await headers(), cache: 'no-store' })
      if (res.status === 401 || res.status === 403) return setNote('Sign in as a responder to see photo analysis.')
      if (!res.ok) return setNote('Photo analysis could not be loaded.')
      const body = (await res.json()) as { photos: PhotoEntry[]; combined: CombinedSummary }
      setPhotos(body.photos)
      setCombined(body.combined)
      setNote('')
    } catch {
      setNote('Photo analysis could not be loaded (offline?).')
    }
  }, [reportId, headers])
  useEffect(() => {
    setPhotos([])
    setCombined(null)
    void load()
  }, [load])

  const review = async (attId: string, review_status: ReviewStatus) => {
    setBusy(attId)
    try {
      await fetch(`/api/reports/${reportId}/attachments/${attId}/analysis`, { method: 'PATCH', headers: await headers(), body: JSON.stringify({ review_status }) })
      await load()
    } finally {
      setBusy(null)
    }
  }

  const withResult = photos.filter((p) => p.analysis?.result && p.analysis.analysis_status === 'completed')
  if (!photos.length && !note) return null
  const suggestsHigher = withResult.some((p) => p.analysis!.result!.suggested_severity === 'high') && (priority === 'low' || priority === 'medium')
  const blockage = withResult.some((p) => p.analysis!.result!.possible_road_blockages.length || p.analysis!.result!.detected_incident_types.includes('road_blockage'))

  return (
    <section className="clay-inset space-y-3 p-4" aria-label="AI photo analysis (unverified)">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold">AI photo analysis</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Unverified</span>
      </div>
      <p className="text-sm text-ink-700">Computer-vision suggestions from the reporter&apos;s photos. Photos may be old, edited or from another place. This does not change the priority score, and nothing here creates a zone, closes a road or sends a team.</p>
      {note && <p className="text-sm">{note}</p>}

      {suggestsHigher && (
        <p role="note" className="rounded-xl border-2 border-amber-500 bg-amber-100 p-2.5 text-sm font-semibold text-ink-900">
          A photo suggests this may be more serious than the current priority ({priority}). The score is unchanged: please review the case.
        </p>
      )}
      {blockage && (
        <p role="note" className="rounded-xl bg-sand-100 p-2.5 text-sm">
          A photo may show a blocked road. This is an unverified finding. Check it on the <Link href="/map" className="font-bold underline">map</Link> and record it through the road-block verification process before anyone relies on it.
        </p>
      )}
      {combined?.conflicts.map((c) => <p key={c} className="rounded-xl border border-amber-500 bg-amber-100 p-2 text-sm">{c}</p>)}

      {photos.map((p) => {
        const a = p.analysis
        const r = a?.result
        return (
          <div key={p.attachment_id} className="space-y-2 rounded-2xl border border-sand-300 bg-white/60 p-3">
            <p className="font-bold">{p.label}</p>
            {!a && <p className="text-sm text-ink-600">Not analysed (the reporter did not agree to AI analysis, or it has not run yet).</p>}
            {a && a.analysis_status !== 'completed' && <p className="text-sm text-ink-600">Analysis {a.analysis_status}{a.failure_reason ? `: ${a.failure_reason}` : ''}. The original photo is unaffected.</p>}
            {r && a?.analysis_status === 'completed' && (
              <>
                <p className="text-sm"><span className="font-bold">Possible incident:</span> {r.detected_incident_types.map((t) => INCIDENT_TYPES[t]).join(', ')} · <span className="text-ink-600">model confidence {r.confidence} (not a measured probability)</span></p>
                {([['Visible evidence', r.visual_observations], ['Possible hazards (interpretation)', r.possible_hazards], ['Signs of damage', r.damage_indicators], ['Possible road blockage (unverified)', r.possible_road_blockages], ['Limitations', r.limitations]] as [string, string[]][]).map(
                  ([t, xs]) => xs.length > 0 && (
                    <div key={t}>
                      <p className="text-sm font-bold">{t}</p>
                      <ul className="list-disc pl-5 text-sm">{xs.map((x) => <li key={x}>{x}</li>)}</ul>
                    </div>
                  )
                )}
                <p className="text-xs text-ink-600">Model: {r.model_provider ?? 'unknown'} {r.model_version ?? ''} · analysed {r.analyzed_at ? new Date(r.analyzed_at).toLocaleString() : 'n/a'} · reporter {a.user_action === 'none' ? 'did not respond to suggestions' : `chose: ${a.user_action}`}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{REVIEW_LABEL[a.review_status]}</span>
                  {(['confirmed', 'rejected', 'needs_more_info'] as ReviewStatus[]).map((s) => (
                    <button key={s} type="button" disabled={busy === p.attachment_id || a.review_status === s} className="btn-ghost btn-sm" onClick={() => void review(p.attachment_id, s)}>
                      <Icon name={s === 'confirmed' ? 'check' : s === 'rejected' ? 'close' : 'info'} size={14} /> {s === 'confirmed' ? 'Confirm' : s === 'rejected' ? 'Reject' : 'Needs more info'}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}
    </section>
  )
}
