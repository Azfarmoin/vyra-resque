'use client'
// Map side panel (responders and administrators): pick a saved satellite analysis to overlay on the live map.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatTime } from '@/lib/client'
import { satApi, SatApiError } from '@/lib/satellite/client'
import { CLASS_COLORS, CLASS_LABELS, REVIEW_LABELS, type AnalysisView } from '@/lib/satellite/types'

export interface SatSelection { analysis: AnalysisView; url: string | null; opacity: number }

export default function SatelliteMapPanel({ selection, onSelect, onClose }: { selection: SatSelection | null; onSelect: (s: SatSelection | null) => void; onClose: () => void }) {
  const [items, setItems] = useState<AnalysisView[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { satApi.list({ limit: 50 }).then((r) => setItems(r.analyses.filter((a) => a.status === 'completed' && a.hasImages && a.overlayBounds))).catch((e) => setError(e instanceof SatApiError ? e.message : 'Could not load satellite analyses.')) }, [])
  useEffect(() => () => { if (selection?.url) URL.revokeObjectURL(selection.url) }, [selection?.url])

  async function pick(id: string) {
    const a = items?.find((x) => x.id === id) ?? null
    if (selection?.url) URL.revokeObjectURL(selection.url)
    if (!a) return onSelect(null)
    onSelect({ analysis: a, url: null, opacity: selection?.opacity ?? 0.8 })
    const url = await satApi.imageUrl(a.id, 'change')
    onSelect({ analysis: a, url, opacity: selection?.opacity ?? 0.8 })
  }
  const a = selection?.analysis
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2"><h2 className="text-xl font-semibold">Satellite change layer</h2><button type="button" className="btn-ghost btn-sm" onClick={onClose}>Close</button></div>
      <p className="rounded-xl border-2 border-amber-300 bg-amber-50 p-2.5 text-xs font-semibold" role="note">Advisory only. Detected change is not proof of a disaster or of a current emergency, and does not confirm any report or change any road, team or priority.</p>
      {error && <p role="alert" className="text-sm font-semibold text-critical-700">{error}</p>}
      {items && items.length === 0 && <p className="text-sm font-semibold">No saved analyses with an overlay yet.</p>}
      {items && items.length > 0 && (
        <>
          <label className="label" htmlFor="sat-pick">Analysis to show</label>
          <select id="sat-pick" className="input" value={a?.id ?? ''} onChange={(e) => pick(e.target.value)}>
            <option value="">None (hide)</option>
            {items.map((x) => <option key={x.id} value={x.id}>{x.beforeRange.start || x.before?.acquiredAt.slice(0, 10)} → {x.afterRange.start || x.after?.acquiredAt.slice(0, 10)} · {REVIEW_LABELS[x.reviewState]}{x.synthetic ? ' · DEMO' : ''}</option>)}
          </select>
        </>
      )}
      {a && (
        <div className="space-y-2 text-sm">
          {a.synthetic && <p role="alert" className="rounded-lg bg-critical-100 p-2 font-bold text-critical-700">DEMONSTRATION: synthetic data, not the real world.</p>}
          <p><b>{REVIEW_LABELS[a.reviewState]}</b>{a.reviewState === 'needs_review' && ' · nobody has reviewed this finding yet'} · imagery quality {a.quality?.rating}</p>
          <p className="text-ink-700">{a.before?.platform} {formatTime(a.before?.acquiredAt ?? '')} → {a.after?.platform} {formatTime(a.after?.acquiredAt ?? '')}</p>
          <label className="label" htmlFor="sat-op">Overlay opacity</label>
          <input id="sat-op" type="range" min={0.2} max={1} step={0.05} value={selection.opacity} onChange={(e) => onSelect({ ...selection, opacity: Number(e.target.value) })} className="w-full" />
          <ul className="space-y-0.5">{[3, 4, 5, 6, 7, 0].map((c) => <li key={c}><span className="mr-2 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: CLASS_COLORS[c] }} />{CLASS_LABELS[c]}</li>)}</ul>
          <Link href={`/satellite?id=${a.id}`} className="btn-ghost btn-sm w-full">Open full analysis</Link>
        </div>
      )}
      <Link href="/satellite" className="btn-dark btn-sm w-full">Run a new satellite analysis</Link>
    </div>
  )
}
