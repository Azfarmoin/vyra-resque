'use client'
// One saved analysis: what was compared, how, how trustworthy it is, the before/after viewer, human review and links.
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/ui/Icon'
import { formatTime } from '@/lib/client'
import { satApi, SatApiError } from '@/lib/satellite/client'
import { ADVISORY, CLASS_COLORS, CLASS_LABELS, LINK_TARGET_LABELS, REVIEW_LABELS, REVIEW_STATES, type AnalysisView, type ReviewState, type SceneMeta } from '@/lib/satellite/types'
import type { Mode } from './CompareViewer'
import LinkPanel from './LinkPanel'
import type { LinkTarget } from '@/lib/satellite/types'

const Viewer = dynamic(() => import('./CompareViewer'), { ssr: false, loading: () => <div className="flex h-[340px] items-center justify-center rounded-2xl bg-sand-200 font-semibold">Loading viewer...</div> })
const RATING: Record<string, string> = { good: 'bg-success-100 text-success-700', fair: 'bg-amber-100 text-amber-800', poor: 'bg-critical-100 text-critical-700', unusable: 'bg-critical-100 text-critical-700' }
const STATE_STYLE: Record<ReviewState, string> = { needs_review: 'bg-amber-100 text-amber-800', confirmed_by_reviewer: 'bg-success-100 text-success-700', not_disaster_related: 'bg-sand-200 text-ink-700', inconclusive: 'bg-sand-200 text-ink-700' }
export const StateBadge = ({ state }: { state: ReviewState }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATE_STYLE[state]}`}>{REVIEW_LABELS[state]}</span>

function SceneCard({ title, s }: { title: string; s: SceneMeta | null }) {
  if (!s) return <div className="rounded-xl bg-sand-100 p-3 text-sm"><b>{title}</b>: not available (the run failed before this scene was read).</div>
  return (
    <div className="rounded-xl bg-sand-100 p-3 text-sm">
      <p className="font-bold">{title}{s.synthetic && <span className="ml-2 rounded bg-critical-100 px-1.5 text-xs text-critical-700">SYNTHETIC</span>}</p>
      <dl className="mt-1 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5">
        <dt className="font-semibold text-ink-600">Scene ID</dt><dd className="break-all">{s.id}</dd>
        <dt className="font-semibold text-ink-600">Acquired</dt><dd>{formatTime(s.acquiredAt)} ({s.acquiredAt.slice(0, 10)} UTC)</dd>
        <dt className="font-semibold text-ink-600">Source</dt><dd>{s.provider} · {s.platform}{s.declaredByUser && ' (declared by uploader)'}</dd>
        <dt className="font-semibold text-ink-600">Resolution</dt><dd>{s.resolutionM} m</dd>
        <dt className="font-semibold text-ink-600">Cloud cover</dt><dd>{s.cloudCover == null ? 'not applicable / not provided' : `${Math.round(s.cloudCover)}% (scene)`}</dd>
        {s.orbitDirection && <><dt className="font-semibold text-ink-600">Orbit</dt><dd>{s.orbitDirection}, relative orbit {s.relativeOrbit ?? '?'}</dd></>}
        <dt className="font-semibold text-ink-600">Licence</dt><dd>{s.license}</dd>
        <dt className="font-semibold text-ink-600">Credit</dt><dd>{s.attribution}</dd>
      </dl>
      <details className="mt-1"><summary className="cursor-pointer font-semibold">Original metadata as received</summary><pre className="mt-1 max-h-48 overflow-auto rounded bg-white p-2 text-xs">{JSON.stringify(s.original, null, 2)}</pre></details>
    </div>
  )
}

export default function AnalysisDetail({ analysis: a, onChanged, presetLink }: { analysis: AnalysisView; onChanged: (a: AnalysisView) => void; presetLink?: { type: LinkTarget; id: string } | null }) {
  const [urls, setUrls] = useState<{ before: string | null; after: string | null; change: string | null }>({ before: null, after: null, change: null })
  const [mode, setMode] = useState<Mode>('swipe')
  const [pos, setPos] = useState(50)
  const [showChange, setShowChange] = useState(false)
  const [state, setState] = useState<ReviewState>(a.reviewState)
  const [note, setNote] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    const made: string[] = []
    setUrls({ before: null, after: null, change: null })
    if (a.hasImages) Promise.all((['before', 'after', 'change'] as const).map((k) => satApi.imageUrl(a.id, k))).then(([before, after, change]) => { [before, after, change].forEach((u) => u && made.push(u)); if (alive) setUrls({ before, after, change }) })
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)) }
  }, [a.id, a.hasImages])
  useEffect(() => { setState(a.reviewState); setNote(''); setAck(false); setMsg(null) }, [a.id, a.reviewState])

  const cannotConfirm = a.status !== 'completed' ? 'A failed analysis cannot be confirmed.' : a.synthetic ? 'Demonstration results are synthetic and can never be confirmed.' : a.quality?.rating === 'unusable' ? 'This analysis is rated unusable. Mark it Inconclusive instead.' : ''
  async function save() {
    setBusy(true); setMsg(null)
    try { const r = await satApi.review(a.id, { state, note, acknowledgedLimitations: ack }); onChanged(r.analysis); setMsg({ ok: true, text: 'Review saved to the history. No incident, road, zone, team or priority was changed.' }); setNote(''); setAck(false) }
    catch (e) { setMsg({ ok: false, text: e instanceof SatApiError ? e.message : 'Could not save the review.' }) }
    finally { setBusy(false) }
  }
  const s = a.stats, changeRows = s?.classes.filter((c) => c.code >= 3 && c.pixels > 0) ?? []

  return (
    <div className="space-y-4">
      {a.synthetic && <p role="alert" className="rounded-xl bg-critical-100 p-3 text-sm font-bold text-critical-700">DEMONSTRATION: these images and results are synthetic. They do not show the real world and cannot be confirmed or used as evidence.</p>}
      <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm font-semibold" role="note">{ADVISORY}</p>

      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={a.reviewState} />
        {a.status === 'failed' ? <span className="rounded-full bg-critical-100 px-2.5 py-0.5 text-xs font-bold text-critical-700">Failed</span> : a.quality && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${RATING[a.quality.rating]}`}>Imagery quality: {a.quality.rating}</span>}
        <span className="text-sm text-ink-600">Run {formatTime(a.createdAt)} by {a.createdByName || 'a responder'} · {a.processingMs != null ? `${(a.processingMs / 1000).toFixed(1)} s` : ''}</span>
      </div>
      {a.status === 'failed' && <p role="alert" className="rounded-xl bg-critical-100 p-3 text-sm font-semibold text-critical-700">This run failed and produced no results: {a.error}</p>}

      <div className="grid gap-3 md:grid-cols-2"><SceneCard title="Before" s={a.before} /><SceneCard title="After" s={a.after} /></div>
      <p className="text-sm"><b>Method:</b> {a.method ?? 'not run'} · <b>Parameters:</b> <code className="text-xs">{JSON.stringify(a.parameters)}</code> · <b>Area:</b> {a.aoi.areaKm2.toFixed(1)} km²{s && <> · <b>Analysis pixel:</b> {s.cellSizeM} m</>}</p>

      {a.quality && (
        <section>
          <h3 className="text-lg font-semibold">Quality checks</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {a.quality.checks.map((c, i) => <li key={i} className={`rounded-lg px-2.5 py-1.5 ${c.severity === 'blocking' ? 'bg-critical-100 font-bold text-critical-700' : c.severity === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-sand-100 text-ink-700'}`}><b className="uppercase">{c.severity}</b> · {c.message}</li>)}
          </ul>
        </section>
      )}

      {s && a.status === 'completed' && (
        <section>
          <h3 className="text-lg font-semibold">What was detected (candidate changes only)</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{a.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
          {changeRows.length > 0 && (
            <table className="mt-2 w-full text-sm"><tbody>
              {changeRows.map((c) => <tr key={c.code} className="border-t border-sand-200"><td className="py-1 pr-2"><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: CLASS_COLORS[c.code] }} />{CLASS_LABELS[c.code]}</td><td className="text-right font-semibold">{c.areaKm2} km²</td></tr>)}
              <tr className="border-t border-sand-200"><td className="py-1 pr-2">Water area before → after (usable pixels)</td><td className="text-right font-semibold">{s.waterAreaBeforeKm2} → {s.waterAreaAfterKm2} km²</td></tr>
              <tr className="border-t border-sand-200"><td className="py-1 pr-2">Usable on both dates</td><td className="text-right font-semibold">{Math.round(s.validFraction * 100)}%</td></tr>
            </tbody></table>
          )}
          <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">Known limitations of this method</summary><ul className="mt-1 list-disc pl-5">{a.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></details>
        </section>
      )}

      {a.hasImages && a.overlayBounds && (
        <section>
          <h3 className="mb-2 text-lg font-semibold">Compare the two dates</h3>
          <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Viewing mode">
            {([['side', 'Side by side'], ['swipe', 'Swipe'], ['opacity', 'Opacity overlay']] as const).map(([m, l]) => <button key={m} type="button" className={mode === m ? 'btn-dark btn-sm' : 'btn-ghost btn-sm'} aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</button>)}
            <label className="ml-2 flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={showChange} onChange={(e) => setShowChange(e.target.checked)} /> Show detected change</label>
          </div>
          {mode !== 'side' && <label className="mb-2 flex items-center gap-2 text-sm font-semibold">{mode === 'swipe' ? 'Swipe position' : 'After image opacity'}<input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="flex-1" /></label>}
          <Viewer mode={mode} bounds={a.overlayBounds} before={urls.before} after={urls.after} change={urls.change} showChange={showChange} position={pos} beforeLabel={a.before?.acquiredAt.slice(0, 10) ?? ''} afterLabel={a.after?.acquiredAt.slice(0, 10) ?? ''} />
          <p className="mt-1 text-xs text-ink-600">Images are shown at analysis resolution ({s?.cellSizeM} m per pixel), not at the satellite's full resolution. Grey on the change layer means no usable data, which is not the same as no change.</p>
        </section>
      )}

      {a.status === 'completed' && (
        <section className="clay-inset p-4">
          <h3 className="text-lg font-semibold">Review</h3>
          <p className="mt-1 text-sm text-ink-700">A review records a person&apos;s judgement about this satellite finding. <b>Confirmed by Reviewer</b> does not confirm an incident, close a road, dispatch a team or change any priority. Those stay manual decisions.</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Review state">
            {REVIEW_STATES.map((st) => (
              <label key={st} className="chip"><input type="radio" name={`rs-${a.id}`} checked={state === st} disabled={st === 'confirmed_by_reviewer' && !!cannotConfirm} onChange={() => setState(st)} /><span>{REVIEW_LABELS[st]}</span></label>
            ))}
          </div>
          {cannotConfirm && <p className="mt-1 text-xs font-semibold text-critical-700">{cannotConfirm}</p>}
          <label className="label mt-3" htmlFor={`note-${a.id}`}>Note {state === 'confirmed_by_reviewer' ? '(required: what did you check?)' : '(optional)'}</label>
          <textarea id={`note-${a.id}`} className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          {state === 'confirmed_by_reviewer' && <label className="mt-2 flex items-start gap-2 text-sm font-semibold"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand a satellite finding is not proof of a disaster, and I checked it against other evidence.</label>}
          <button type="button" className="btn-primary mt-3" disabled={busy || state === a.reviewState && !note} onClick={save}><Icon name="check" size={18} /> {busy ? 'Saving...' : 'Save review'}</button>
          {msg && <p role="status" className={`mt-2 text-sm font-semibold ${msg.ok ? 'text-success-700' : 'text-critical-700'}`}>{msg.text}</p>}
          {a.reviews.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">Review history ({a.reviews.length})</summary><ul className="mt-1 space-y-1">{[...a.reviews].reverse().map((r) => <li key={r.id} className="rounded-lg bg-white p-2"><StateBadge state={r.state} /> {r.reviewedByName} · {formatTime(r.createdAt)}{r.note && <p className="mt-0.5">{r.note}</p>}</li>)}</ul></details>}
        </section>
      )}

      {a.status === 'completed' && (
        <section className="clay-inset p-4">
          <h3 className="text-lg font-semibold">Linked records</h3>
          <p className="mt-1 text-sm text-ink-700">Linking attaches this finding as advisory evidence. It never edits the record it is linked to.</p>
          {a.links.length > 0 && <ul className="mt-2 space-y-1 text-sm">{a.links.map((l) => <li key={l.id} className="rounded-lg bg-white p-2"><b>{LINK_TARGET_LABELS[l.targetType]}</b> · {l.targetType === 'report' ? <Link className="font-bold underline" href={`/dashboard?id=${l.targetId}`}>{l.targetId.slice(0, 8)}</Link> : l.targetType === 'zone' ? <Link className="font-bold underline" href={`/admin/zones?id=${l.targetId}`}>{l.targetId.slice(0, 8)}</Link> : l.targetId} · by {l.linkedByName} {formatTime(l.createdAt)}{l.note && <p>{l.note}</p>}</li>)}</ul>}
          <LinkPanel analysisId={a.id} presetType={presetLink?.type} presetId={presetLink?.id} onLinked={() => satApi.get(a.id).then((r) => onChanged(r.analysis))} />
        </section>
      )}
    </div>
  )
}
