'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { listAttachments, patchAttachment } from '@/lib/offline/store'
import { subscribe } from '@/lib/offline/events'
import type { LocalAnalysis, LocalAttachment } from '@/lib/offline/types'
import { getIdentity } from '@/lib/offline/identity'
import { combineAnalyses } from '@/lib/photoAnalysis/combine'
import { INCIDENT_TYPES, type IncidentType } from '@/lib/photoAnalysis/schema'
import { DANGER_FOR_INCIDENT, WAITING_TEXT, applySuggestions, defaultPick, defaultText, previewAnalysis, type Applied, type FormFields, type PhotoSuggestion, type Picked } from '@/lib/photoAnalysis/client'

const inFlight = new Set<string>() // photo ids being analysed right now (stops duplicate calls)

const SEVERITY_TEXT = { not_determined: 'Cannot be determined from the photo', low: 'Low (needs review)', moderate: 'Moderate (needs review)', high: 'Higher (needs review)' } as const

export function analysisLine(a: LocalAttachment): string {
  if (!a.analysis_consent) return 'AI analysis is off for this photo.'
  const s = a.analysis
  if (!s) return 'Analysis will start shortly…'
  if (s.status === 'waiting') return 'Analysis: Waiting for internet connection.'
  if (s.status === 'processing') return 'Analysis: in progress…'
  if (s.status === 'completed') return s.choice === 'ignored' ? 'Analysis ignored.' : 'Analysis ready. Review the suggestions below.'
  if (s.status === 'not_configured') return 'Analysis is not available on this server. You can still send your report.'
  return 'Analysis unavailable. You can retry, or just describe the situation yourself.'
}

// Runs the analysis for photos that have consent and no result yet. Never blocks the form or submission.
export function usePhotoAnalysisRunner(reportId: string) {
  const [items, setItems] = useState<LocalAttachment[]>([])
  const load = useCallback(async () => {
    try {
      setItems(await listAttachments(reportId))
    } catch {
      /* IndexedDB unavailable: the form shows its own warning */
    }
  }, [reportId])
  useEffect(() => {
    void load()
    return subscribe(() => void load())
  }, [load])

  const run = useCallback(async (att: LocalAttachment, force = false) => {
    if (!att.blob || !att.analysis_consent || inFlight.has(att.id)) return
    inFlight.add(att.id)
    try {
      const online = typeof navigator === 'undefined' ? true : navigator.onLine
      if (!online) {
        await patchAttachment(att.id, { analysis: { status: 'waiting', result: null, reason: WAITING_TEXT, at: null, choice: 'none', server_checked: false } })
        return
      }
      await patchAttachment(att.id, { analysis: { status: 'processing', result: null, reason: null, at: null, choice: 'none', server_checked: false } })
      const token = (await getIdentity().catch(() => null))?.token ?? null
      const out = await previewAnalysis(att.blob, { token, force })
      await patchAttachment(att.id, { analysis: out })
    } finally {
      inFlight.delete(att.id)
    }
  }, [])

  // Start automatically for new photos, and again when the connection returns.
  useEffect(() => {
    for (const a of items) {
      const st = a.analysis?.status
      if (a.blob && a.analysis_consent && (!a.analysis || st === 'waiting')) void run(a)
    }
  }, [items, run])
  useEffect(() => {
    const onOnline = () => void load().then(() => undefined)
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [load])
  useEffect(() => {
    const t = setInterval(() => {
      if (navigator.onLine) for (const a of items) if (a.blob && a.analysis_consent && a.analysis?.status === 'waiting') void run(a)
    }, 15_000)
    return () => clearInterval(t)
  }, [items, run])

  return { items, run }
}

function Thumb({ att }: { att: LocalAttachment }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!att.blob) return setUrl(null)
    const u = URL.createObjectURL(att.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [att.blob])
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : null
}

const AiBadge = () => <span className="rounded-full bg-sand-200 px-2 py-0.5 text-xs font-bold text-ink-700">AI suggestion</span>

function Bullets({ title, items, note }: { title: string; items: string[]; note?: string }) {
  if (!items.length) return null
  return (
    <div>
      <p className="text-sm font-bold">{title}</p>
      {note && <p className="text-xs text-ink-600">{note}</p>}
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  )
}

export default function PhotoAnalysisPanel({ reportId, fields, onApply, consent }: { reportId: string; fields: FormFields; onApply: (a: Applied) => void; consent: boolean }) {
  const { items, run } = usePhotoAnalysisRunner(reportId)
  const analysed = useMemo(() => items.filter((a) => a.analysis_consent || a.analysis), [items])
  const label = (a: LocalAttachment) => `Photo ${items.findIndex((x) => x.id === a.id) + 1}`
  const done: PhotoSuggestion[] = useMemo(
    () => items.filter((a) => a.analysis?.status === 'completed' && a.analysis.result && a.analysis.choice !== 'ignored').map((a) => ({ attachment_id: a.id, label: `Photo ${items.findIndex((x) => x.id === a.id) + 1}`, result: a.analysis!.result! })),
    [items]
  )

  const [picked, setPicked] = useState<Picked>({ types: {}, text: {}, urgency: true })
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})
  const seen = useRef(new Set<string>())
  useEffect(() => {
    // initialise choices for newly arrived results only; never reset what the reporter already changed
    const fresh = done.filter((d) => !seen.current.has(d.attachment_id + d.result.analyzed_at))
    if (!fresh.length) return
    const def = defaultPick(fresh)
    for (const f of fresh) seen.current.add(f.attachment_id + f.result.analyzed_at)
    setPicked((p) => ({ ...p, types: { ...p.types, ...def.types }, text: { ...p.text, ...def.text } }))
    setInclude((i) => ({ ...i, ...Object.fromEntries(fresh.map((f) => [f.attachment_id, true])) }))
  }, [done])

  const combined = useMemo(() => (done.length > 1 ? combineAnalyses(done) : null), [done])
  if (!consent && !analysed.length) return null
  if (!items.length) return null

  const chosen = done.filter((d) => include[d.attachment_id] !== false)
  const setChoice = (a: LocalAttachment, choice: LocalAnalysis['choice']) => a.analysis && patchAttachment(a.id, { analysis: { ...a.analysis, choice } })

  const use = () => {
    const applied = applySuggestions(fields, chosen, picked)
    onApply(applied)
    const edited = chosen.some((c) => (picked.text[c.attachment_id] ?? '') !== defaultText(c.result))
    for (const c of chosen) {
      const a = items.find((x) => x.id === c.attachment_id)
      if (a) void setChoice(a, edited ? 'edited' : 'used')
    }
  }

  return (
    <section className="clay-inset space-y-4 p-4" aria-labelledby="ai-photo-title" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="ai-photo-title" className="font-display text-lg font-semibold">AI Photo Analysis</h3>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">Unverified suggestions</span>
      </div>
      <p className="text-sm text-ink-700">
        A computer vision model looked at your photo(s). It can be wrong, and a photo may be old, edited, or from somewhere else. Nothing here is sent anywhere until you send the report, and a responder will check it. You can ignore it and describe the situation yourself.
      </p>

      {analysed.map((a) => {
        const s = a.analysis
        const r = s?.result
        const ignored = s?.choice === 'ignored'
        return (
          <div key={a.id} className="space-y-2.5 rounded-2xl border border-sand-300 bg-white/60 p-3">
            <div className="flex items-center gap-2">
              <Thumb att={a} />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{label(a)} <span className="font-normal text-ink-600">· {a.name}</span></p>
                <p className="text-sm text-ink-700" role="status">{analysisLine(a)}</p>
              </div>
            </div>

            {s?.status === 'completed' && r && !ignored && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-bold">Possible incident detected <AiBadge /></p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {r.detected_incident_types.map((t: IncidentType) => {
                      const mappable = t in DANGER_FOR_INCIDENT
                      const on = (picked.types[a.id] ?? []).includes(t)
                      return (
                        <li key={t}>
                          <label className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${on ? 'border-ink-700 bg-sand-100 font-semibold' : 'border-sand-300'}`}>
                            {mappable && (
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => setPicked((p) => ({ ...p, types: { ...p.types, [a.id]: e.target.checked ? [...(p.types[a.id] ?? []), t] : (p.types[a.id] ?? []).filter((x) => x !== t) } }))}
                              />
                            )}
                            {INCIDENT_TYPES[t]}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                <Bullets title="Visible evidence" items={r.visual_observations} />
                <Bullets title="Possible hazards" items={r.possible_hazards} note="Interpretations, not confirmed." />
                <Bullets title="Signs of damage" items={r.damage_indicators} />
                <Bullets title="Possible road blockage (unverified)" items={r.possible_road_blockages} note="A responder must check this before any road is treated as blocked." />

                <div>
                  <label className="text-sm font-bold" htmlFor={`ai-text-${a.id}`}>Suggested title and description</label>
                  {editing[a.id] ? (
                    <textarea
                      id={`ai-text-${a.id}`}
                      className="input mt-1"
                      rows={4}
                      maxLength={700}
                      value={picked.text[a.id] ?? ''}
                      onChange={(e) => setPicked((p) => ({ ...p, text: { ...p.text, [a.id]: e.target.value } }))}
                    />
                  ) : (
                    <p id={`ai-text-${a.id}`} className="mt-1 whitespace-pre-line text-sm">{picked.text[a.id] || <em>(none)</em>}</p>
                  )}
                </div>
                <p className="text-sm"><span className="font-bold">Suggested urgency:</span> {SEVERITY_TEXT[r.suggested_severity]}. <span className="text-ink-600">The model&apos;s own confidence: {r.confidence}. This is a rough label, not a measured probability.</span></p>
                <Bullets title="Limitations" items={r.limitations} />

                <div className="flex flex-wrap items-center gap-2">
                  {done.length > 1 && (
                    <label className="mr-2 inline-flex items-center gap-1.5 text-sm font-semibold">
                      <input type="checkbox" checked={include[a.id] !== false} onChange={(e) => setInclude((i) => ({ ...i, [a.id]: e.target.checked }))} /> Include this photo
                    </label>
                  )}
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing((e) => ({ ...e, [a.id]: !e[a.id] }))}>
                    <Icon name="edit" size={15} /> {editing[a.id] ? 'Done editing' : 'Edit Suggestions'}
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(s?.status === 'failed' || s?.status === 'completed' || s?.status === 'not_configured') && a.blob && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void run(a, true)}>
                  <Icon name="refresh" size={15} /> Analyze Again
                </button>
              )}
              {s?.status === 'completed' && !ignored && (
                <button type="button" className="btn-ghost btn-sm" onClick={() => void setChoice(a, 'ignored')}>
                  <Icon name="close" size={15} /> Ignore Analysis
                </button>
              )}
              {ignored && <button type="button" className="btn-ghost btn-sm" onClick={() => void setChoice(a, 'none')}>Show analysis again</button>}
            </div>
            {s?.status === 'failed' && s.reason && <p className="text-sm text-ink-700">{s.reason}</p>}
          </div>
        )
      })}

      {combined && (
        <div className="space-y-2 rounded-2xl border border-sand-300 bg-white/60 p-3">
          <p className="font-bold">Across your {combined.analyzed_count} analysed photos</p>
          {combined.notes.map((n) => <p key={n} className="text-sm text-ink-700">{n}</p>)}
          {!!combined.conflicts.length && (
            <div role="note" className="rounded-xl border-2 border-amber-500 bg-amber-100 p-2.5 text-sm text-ink-900">
              <p className="font-bold">The photos may disagree</p>
              <ul className="list-disc pl-5">{combined.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          )}
          {!!combined.hazards.length && (
            <ul className="list-disc pl-5 text-sm">{combined.hazards.map((h) => <li key={h.text}>{h.text} <span className="text-ink-600">({h.photos.join(', ')})</span></li>)}</ul>
          )}
        </div>
      )}

      {!!done.length && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary btn-sm" disabled={!chosen.length} onClick={use}>
            <Icon name="check" size={16} /> Use Suggestions
          </button>
          <p className="text-xs text-ink-600">Adds to your answers. It never replaces text you already typed.</p>
        </div>
      )}
    </section>
  )
}
